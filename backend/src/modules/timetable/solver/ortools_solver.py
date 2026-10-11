#!/usr/bin/env python3
"""
OR-Tools CP-SAT Timetable Solver for FYIMP (Follow-up Plan 06)
Complies with R17, R18, R19, R20, R21, R22; F33, F34, F35, F36, F37, F39, F40, F41, F42, F71.
"""

import sys
import json
import time
import hashlib
from typing import Dict, List, Any, Tuple, Set
from ortools.sat.python import cp_model


SUPPORTED_RULE_KINDS = {
    "NO_STUDENT_OVERLAP",
    "NO_TEACHER_OVERLAP",
    "TEACHER_RESERVATIONS",
    "NO_LUNCH_OVERLAP",
    "EXACT_CONTACT_HOURS",
    "LAB_CONSECUTIVE_PAIR",
    "P6_LAST_RESORT",
    "THEORY_SPREAD",
    "DEPARTMENT_TIME_PREFERENCE",
    "DAY_WINDOW",
    "CATEGORY_WINDOW",
    "SESSION_BLOCK",
    "PARALLEL_CATEGORY_SYNC",
    "CAMPUS_TIME_LIMIT",
}

CAMPUS_WIDE_CATEGORIES = {"MDC", "VAC", "SEC", "AEC"}


def build_campus_paper_groups(courses):
    buckets = {}
    for c in courses:
        category = (c.get("category") or "").upper().strip()
        if category not in CAMPUS_WIDE_CATEGORIES:
            continue
        fixed_paper = {"KU01AECENG101": 1, "KU01AECENG102": 2}.get(c.get("courseCode"))
        paper = c.get("campusPaper", fixed_paper or 1)
        if type(paper) is not int or not 1 <= paper <= 8 or (fixed_paper and paper != fixed_paper):
            raise ValueError(f"[Campus Paper Conflict] {c.get('courseCode')} has an inconsistent paper position.")
        buckets.setdefault((category, paper), []).append(c)
    groups = []
    for (category, paper), bucket in sorted(buckets.items()):
        expected = int(bucket[0].get("theoryHours", 0)) + int(bucket[0].get("practicalHours", 0))
        students = set()
        for c in bucket:
            hours = int(c.get("theoryHours", 0)) + int(c.get("practicalHours", 0))
            if hours != expected:
                raise ValueError(f"[Campus Paper Conflict] {category} paper {paper} requires identical total contact hours "
                                 "across departments. Correct the catalogue; this common paper cannot be split.")
            members = set(c.get("studentIds", []))
            if students.intersection(members):
                raise ValueError(f"[Campus Paper Conflict] {category} paper {paper} contains overlapping student "
                                 "enrollments across course options. Correct the selections; this common paper cannot be split.")
            students.update(members)
        if len(bucket) > 1:
            groups.append({"groupId": f"campus:{category}:paper:{paper}", "category": category,
                           "courseIds": [c["courseId"] for c in bucket]})
    return groups


def compute_rule_hash(rules_data: List[Dict[str, Any]], schedule_data: Dict[str, Any]) -> str:
    normalized = json.dumps({"rules": rules_data, "schedule": schedule_data}, sort_keys=True)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def find_overloaded_conflict_group(courses: List[Dict[str, Any]], available_periods: int):
    """Find a sufficient capacity contradiction without an exponential clique search.

    Every pair in the returned group shares a student, so their occupied periods
    must all be distinct even when no single student takes the entire group.
    Greedy searches can miss a contradiction, but never reject a feasible group.
    """
    hours = [int(c.get("theoryHours", 0)) + int(c.get("practicalHours", 0)) for c in courses]
    order = sorted((i for i, h in enumerate(hours) if h > 0),
                   key=lambda i: (-hours[i], courses[i].get("courseCode", ""), courses[i]["courseId"]))
    if sum(hours[i] for i in order) <= available_periods:
        return None
    students = [set(c.get("studentIds", [])) for c in courses]
    neighbors = {i: set() for i in order}
    for offset, i in enumerate(order):
        for j in order[offset + 1:]:
            if not students[i].isdisjoint(students[j]):
                neighbors[i].add(j)
                neighbors[j].add(i)
    for seed in order:
        group, required = [seed], hours[seed]
        candidates = [i for i in order if i in neighbors[seed]]
        while required <= available_periods and candidates:
            chosen = candidates[0]
            group.append(chosen)
            required += hours[chosen]
            candidates = [i for i in candidates[1:] if i in neighbors[chosen]]
        if required > available_periods:
            return {"required": required,
                    "courses": [courses[i].get("courseCode") or courses[i]["courseId"] for i in group]}
    return None


def solve_timetable(input_data: Dict[str, Any]) -> Dict[str, Any]:
    academic_year = input_data.get("academic_year", "")
    semester = int(input_data.get("semester", 1))
    campus_id = input_data.get("campus_id", "")
    courses_data = input_data.get("courses", [])
    parallel_groups_data = input_data.get("parallel_groups", [])
    teacher_reservations = input_data.get("teacher_reservations", [])
    constraints = input_data.get("constraints", {})
    config = input_data.get("config", {})

    max_seconds = float(config.get("max_time_in_seconds", 300))
    num_workers = int(config.get("num_workers", 4))

    diagnostics: List[str] = []

    # Days: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
    DAYS = [1, 2, 3, 4, 5]
    # Periods: 1..6 (Lunch is between 3 and 4)
    PERIODS = [1, 2, 3, 4, 5, 6]
    ALL_SLOTS = [(d, p) for d in DAYS for p in PERIODS]

    # Valid 2-period lab block starting periods (on the same day, never across lunch)
    # Valid lab blocks: (1, 2), (2, 3), (4, 5), (5, 6)
    LAB_START_PERIODS = [1, 2, 4, 5]

    # Parse effective rules from constraints document or input data (R19)
    rules_list: List[Dict[str, Any]] = (
        input_data.get("rules") or
        constraints.get("rules") or
        []
    )
    schedule_config = constraints.get("schedule", {})
    rule_hash = compute_rule_hash(rules_list, schedule_config)

    # Validate rules for unsupported hard rules upfront (R19)
    for r in rules_list:
        kind = r.get("kind", "")
        is_hard = r.get("isHard", True)
        if kind not in SUPPORTED_RULE_KINDS:
            if is_hard:
                return {
                    "status": "MODEL_INVALID",
                    "assignments": [],
                    "diagnostics": [
                        f"Unsupported hard rule kind '{kind}' in rule '{r.get('id', 'unknown')}'. "
                        f"Dynamic text without formal CP-SAT compiler handler cannot be compiled (R19)."
                    ],
                    "stats": {
                        "wall_time_seconds": 0.0,
                        "rule_hash": rule_hash,
                        "total_courses": len(courses_data),
                        "total_sessions_assigned": 0,
                    },
                }
            else:
                diagnostics.append(f"Ignored unsupported soft rule kind '{kind}'.")

    # Check for campus or global time limit rules (R19)
    # E.g. limiting the entire schedule to Friday P6 or disallowing certain days/periods
    campus_allowed_slots: Set[Tuple[int, int]] = set(ALL_SLOTS)
    for r in rules_list:
        if r.get("kind") in ("CAMPUS_TIME_LIMIT", "DAY_WINDOW"):
            scope = r.get("scope", "global")
            if scope in ("global", "campus"):
                params = r.get("parameters", {})
                allowed_days = params.get("days") or params.get("allowed_days")
                allowed_periods = params.get("periods") or params.get("allowed_periods")
                new_allowed: Set[Tuple[int, int]] = set()
                for d, p in campus_allowed_slots:
                    day_ok = (allowed_days is None) or (d in allowed_days)
                    period_ok = (allowed_periods is None) or (p in allowed_periods)
                    if day_ok and period_ok:
                        new_allowed.add((d, p))
                campus_allowed_slots = new_allowed

    # Data structures for courses
    courses_by_id: Dict[str, Dict[str, Any]] = {c["courseId"]: c for c in courses_data}

    # Compile hard category/course windows, including the two fixed campus AEC papers.
    course_allowed_slots = {}
    for c in courses_data:
        allowed = set(campus_allowed_slots)
        for r in rules_list:
            if r.get("kind") != "CATEGORY_WINDOW" or not r.get("isHard", True):
                continue
            if r.get("targetSemester") and r["targetSemester"] != semester:
                continue
            if r.get("targetCategory") and r["targetCategory"].upper().strip() != (c.get("category") or "").upper().strip():
                continue
            if r.get("targetCourseId") and r["targetCourseId"] != c["courseId"]:
                continue
            if r.get("targetDepartmentId") and r["targetDepartmentId"] != c.get("departmentId"):
                continue
            params = r.get("parameters") or {}
            if params.get("courseCodes") and c.get("courseCode") not in params["courseCodes"]:
                continue
            days = params.get("days") or params.get("allowed_days")
            periods = params.get("periods") or params.get("allowed_periods")
            allowed = {(d, p) for d, p in allowed
                       if (days is None or d in days) and (periods is None or p in periods)}
        course_allowed_slots[c["courseId"]] = allowed

    # Preflight data conflict checks (R18 & R21)
    for c in courses_data:
        cid = c["courseId"]
        t_hours = int(c.get("theoryHours", 0))
        p_hours = int(c.get("practicalHours", 0))
        category = (c.get("category") or "").upper().strip()

        if category == "MDC" and (p_hours != 0 or (semester == 1 and t_hours != 3)):
            return {
                "status": "MODEL_INVALID", "assignments": [],
                "diagnostics": [f"Course {c.get('courseCode')} (MDC) has {t_hours} theory and {p_hours} practical hours. "
                                "MDC courses have no practical hours; Semester 1 requires 3 theory hours. "
                                "Correct the course catalogue before generation."],
                "stats": {"wall_time_seconds": 0.0, "rule_hash": rule_hash,
                          "total_courses": len(courses_data), "total_sessions_assigned": 0},
            }

        # R21: Odd practical hours check - strictly prohibited under 2-period lab block rule
        if p_hours % 2 != 0:
            return {
                "status": "MODEL_INVALID",
                "assignments": [],
                "diagnostics": [
                    f"Course {c.get('courseCode')} ({cid}) has practicalHours={p_hours} (odd number). "
                    f"Practical contact hours must be in exact 2-period consecutive blocks (R21). "
                    f"Single-period practical workarounds are unapproved."
                ],
                "stats": {
                    "wall_time_seconds": 0.0,
                    "rule_hash": rule_hash,
                    "total_courses": len(courses_data),
                    "total_sessions_assigned": 0,
                },
            }

        # R18: Semester 3 VAC window check - required contact hours cannot exceed 2-hour window (Mon P5+P6)
        if semester == 3 and category == "VAC" and (t_hours + p_hours) > 2:
            return {
                "status": "MODEL_INVALID",
                "assignments": [],
                "diagnostics": [
                    f"Course {c.get('courseCode')} (VAC) requires {t_hours + p_hours} contact hours, "
                    f"which exceeds the mandatory Semester 3 Monday P5+P6 (2-hour) window (R18). "
                    f"Academic curriculum requires correction before scheduling."
                ],
                "stats": {
                    "wall_time_seconds": 0.0,
                    "rule_hash": rule_hash,
                    "total_courses": len(courses_data),
                    "total_sessions_assigned": 0,
                },
            }

    try:
        campus_groups = build_campus_paper_groups(courses_data)
        department_groups = []
        for group in parallel_groups_data:
            members = [courses_by_id[cid] for cid in group.get("courseIds", []) if cid in courses_by_id]
            campus_members = [c for c in members if (c.get("category") or "").upper().strip() in CAMPUS_WIDE_CATEGORIES]
            if campus_members:
                if len(campus_members) != len(members):
                    raise ValueError("[Campus Paper Conflict] A parallel basket mixes campus papers with department courses.")
                # Campus groups are reconstructed from authoritative paper identities, never caller partitions.
                continue
            department_groups.append(group)
        parallel_groups_data = department_groups + campus_groups
    except ValueError as error:
        return {"status": "MODEL_INVALID", "assignments": [], "diagnostics": [str(error)],
                "stats": {"wall_time_seconds": 0.0, "rule_hash": rule_hash,
                          "total_courses": len(courses_data), "total_sessions_assigned": 0}}

    capacity_conflict = find_overloaded_conflict_group(courses_data, len(campus_allowed_slots))
    if capacity_conflict:
        required = capacity_conflict["required"]
        available = len(campus_allowed_slots)
        return {
            "status": "INFEASIBLE",
            "assignments": [],
            "diagnostics": [
                f"Insufficient weekly timetable capacity: mutually conflicting courses "
                f"{', '.join(capacity_conflict['courses'])} require {required} distinct periods, "
                f"but only {available} periods are allowed. Every pair shares at least one student "
                f"and cannot overlap. Review course registrations and contact hours, or obtain "
                f"approval to increase timetable capacity. Increasing solver time cannot resolve this shortage."
            ],
            "stats": {
                "wall_time_seconds": 0.0,
                "rule_hash": rule_hash,
                "total_courses": len(courses_data),
                "total_sessions_assigned": 0,
                "capacity_required_periods": required,
                "capacity_available_periods": available,
            },
        }

    model = cp_model.CpModel()

    # Session definitions per course
    course_sessions: Dict[str, List[Dict[str, Any]]] = {}

    for c in courses_data:
        cid = c["courseId"]
        t_hours = int(c.get("theoryHours", 0))
        p_hours = int(c.get("practicalHours", 0))
        category = (c.get("category") or "").upper().strip()

        sessions = []

        # Semester 1 MDC rule: "MDC courses (3 theory hours) must be split into a 2-hour continuous session on one day and a 1-hour session on another day"
        is_sem1_mdc = (semester == 1 and category == "MDC" and t_hours == 3 and p_hours == 0)

        if is_sem1_mdc:
            sessions.append({
                "id": "mdc_block_2h",
                "type": "theory_block_2h",
                "duration": 2,
                "is_lab": False,
            })
            sessions.append({
                "id": "mdc_single_1h",
                "type": "theory_single",
                "duration": 1,
                "is_lab": False,
            })
        else:
            # Standard theory sessions (1 hour each)
            for i in range(t_hours):
                sessions.append({
                    "id": f"th_{i+1}",
                    "type": "theory_single",
                    "duration": 1,
                    "is_lab": False,
                })

            # Practical sessions: 2-hour consecutive lab blocks (exact pairs, no odd lab singles)
            lab_blocks_count = p_hours // 2
            for i in range(lab_blocks_count):
                sessions.append({
                    "id": f"lab_{i+1}",
                    "type": "lab_block_2h",
                    "duration": 2,
                    "is_lab": True,
                })

        course_sessions[cid] = sessions

    # Decision Variables:
    # active_vars[(cid, d, p)] = list of BoolVars active at slot (d, p)
    active_vars: Dict[Tuple[str, int, int], List[cp_model.IntVar]] = {}
    for cid in courses_by_id:
        for d, p in ALL_SLOTS:
            active_vars[(cid, d, p)] = []

    # Store placement vars per session for exact constraints & reconstruction
    session_start_vars: Dict[Tuple[str, str], Dict[Tuple[int, int], cp_model.IntVar]] = {}

    for cid, sessions in course_sessions.items():
        c_meta = courses_by_id[cid]
        category = (c_meta.get("category") or "").upper().strip()

        for s in sessions:
            sid = s["id"]
            dur = s["duration"]
            start_dict: Dict[Tuple[int, int], cp_model.IntVar] = {}

            if dur == 1:
                for d, p in ALL_SLOTS:
                    # Enforce campus allowed slots (R19)
                    if (d, p) not in course_allowed_slots[cid]:
                        continue

                    # R17: Semester 1 AEC restriction: strictly on Tuesdays (2) and/or Wednesdays (3) during afternoon (P4, P5, P6)
                    if semester == 1 and category == "AEC":
                        paper_day = {"KU01AECENG101": 2, "KU01AECENG102": 3}.get(c_meta.get("courseCode"))
                        if (paper_day is not None and d != paper_day) or d not in [2, 3] or p not in [4, 5, 6]:
                            continue

                    # R18: Semester 3 VAC restriction: applied to EVERY occupied period, including single-hour theory!
                    if semester == 3 and category == "VAC":
                        if d != 1 or p not in [5, 6]:
                            continue

                    v = model.NewBoolVar(f"x_{cid}_{sid}_d{d}_p{p}")
                    start_dict[(d, p)] = v
                    active_vars[(cid, d, p)].append(v)

                if start_dict:
                    model.AddExactlyOne(list(start_dict.values()))
                else:
                    diagnostics.append(f"Domain for course {cid} session {sid} is empty under constraints.")
                    model.AddBoolOr([])

            elif dur == 2:
                # 2-hour continuous block
                for d in DAYS:
                    for p in LAB_START_PERIODS:
                        # Enforce campus allowed slots (R19)
                        if (d, p) not in course_allowed_slots[cid] or (d, p + 1) not in course_allowed_slots[cid]:
                            continue

                        # Semester 1 AEC restriction for 2-hour blocks if any
                        if semester == 1 and category == "AEC":
                            paper_day = {"KU01AECENG101": 2, "KU01AECENG102": 3}.get(c_meta.get("courseCode"))
                            if (paper_day is not None and d != paper_day) or d not in [2, 3] or p not in [4, 5]:
                                continue

                        # R18: Semester 3 VAC restriction: strictly on Mondays (1) during Periods 5 and 6 (P5+P6)
                        if semester == 3 and category == "VAC":
                            if d != 1 or p != 5:
                                continue

                        v = model.NewBoolVar(f"start_{cid}_{sid}_d{d}_p{p}")
                        start_dict[(d, p)] = v
                        # Occupies both p and p+1
                        active_vars[(cid, d, p)].append(v)
                        active_vars[(cid, d, p + 1)].append(v)

                if start_dict:
                    model.AddExactlyOne(list(start_dict.values()))
                else:
                    diagnostics.append(f"Domain for 2-hour block {cid} session {sid} is empty under constraints.")
                    model.AddBoolOr([])

            session_start_vars[(cid, sid)] = start_dict

    # ──────────────── Hard Constraints ────────────────

    # 1. No course can have > 1 session in the same slot
    for (cid, d, p), var_list in active_vars.items():
        if len(var_list) > 1:
            model.Add(sum(var_list) <= 1)

    # 2. Semester 1 MDC spread (Hard Rule): 2h block and 1h block on DIFFERENT days
    for cid, sessions in course_sessions.items():
        c_meta = courses_by_id[cid]
        if semester == 1 and (c_meta.get("category") or "").upper().strip() == "MDC":
            block_s = next((s for s in sessions if s["id"] == "mdc_block_2h"), None)
            single_s = next((s for s in sessions if s["id"] == "mdc_single_1h"), None)
            if block_s and single_s:
                for d in DAYS:
                    block_d_vars = [
                        v for (day, _), v in session_start_vars[(cid, block_s["id"])].items() if day == d
                    ]
                    single_d_vars = [
                        v for (day, _), v in session_start_vars[(cid, single_s["id"])].items() if day == d
                    ]
                    if block_d_vars and single_d_vars:
                        # Cannot both be on day d
                        model.Add(sum(block_d_vars) + sum(single_d_vars) <= 1)

    # 3. Student Conflict Graph:
    # No student may have two overlapping courses at the same (d, p) slot
    student_courses: Dict[str, Set[str]] = {}
    for c in courses_data:
        cid = c["courseId"]
        for s_id in c.get("studentIds", []):
            if s_id not in student_courses:
                student_courses[s_id] = set()
            student_courses[s_id].add(cid)

    conflict_pairs: Set[Tuple[str, str]] = set()
    for s_id, enrolled_cids in student_courses.items():
        c_list = sorted(list(enrolled_cids))
        for i in range(len(c_list)):
            for j in range(i + 1, len(c_list)):
                conflict_pairs.add((c_list[i], c_list[j]))

    for c1, c2 in conflict_pairs:
        for d, p in ALL_SLOTS:
            c1_active = active_vars.get((c1, d, p), [])
            c2_active = active_vars.get((c2, d, p), [])
            if c1_active and c2_active:
                model.Add(sum(c1_active) + sum(c2_active) <= 1)

    # 4. Shared Teacher Constraints (F37):
    # Teacher cannot teach overlapping courses in this cohort, AND cannot overlap with fixed teacher_reservations
    teacher_courses: Dict[str, List[str]] = {}
    for c in courses_data:
        t_id = c.get("teacherId")
        if t_id:
            if t_id not in teacher_courses:
                teacher_courses[t_id] = []
            teacher_courses[t_id].append(c["courseId"])

    for t_id, c_list in teacher_courses.items():
        if len(c_list) > 1:
            for d, p in ALL_SLOTS:
                t_active = []
                for cid in c_list:
                    t_active.extend(active_vars.get((cid, d, p), []))
                if len(t_active) > 1:
                    model.Add(sum(t_active) <= 1)

    # Fixed reservations from other published campus/semester timetables (F37)
    for res in teacher_reservations:
        t_id = res.get("teacherId")
        r_day = int(res.get("day", 0))
        r_period = int(res.get("period", 0))
        if t_id and (r_day, r_period) in ALL_SLOTS and t_id in teacher_courses:
            for cid in teacher_courses[t_id]:
                c_active = active_vars.get((cid, r_day, r_period), [])
                if c_active:
                    model.Add(sum(c_active) == 0)

    # 5. Parallel Groups / Elective Baskets (F71):
    # Courses in the same parallel group must occupy the exact same time slots!
    for group in parallel_groups_data:
        grp_cids = [cid for cid in group.get("courseIds", []) if cid in courses_by_id]
        if len(grp_cids) >= 2:
            base_cid = grp_cids[0]
            for other_cid in grp_cids[1:]:
                for d, p in ALL_SLOTS:
                    # Compare complete occupancy, including slots absent from either domain.
                    # This also synchronizes different theory/lab session structures of equal total hours.
                    model.Add(sum(active_vars[(base_cid, d, p)]) == sum(active_vars[(other_cid, d, p)]))

    # ──────────────── Soft Constraints / Objective ────────────────
    # Hierarchical / Lexicographic penalty terms:
    # Priority 1: Period 6 Last Resort (Weight: 50)
    # Priority 2: Theory Spread (R17 Soft Penalty: Weight 5 per additional session on same day)
    # Priority 3: Dept Morning / Afternoon Preference (Weight 2)
    # Priority 4: Semester 1 MDC Day Preference (Thursdays 2h, Fridays 1h) (Weight 2)
    objective_terms = []

    # 1. Period 6 Usage Penalty (Extended Period Policy - Weight 50)
    for cid, sessions in course_sessions.items():
        for s in sessions:
            sid = s["id"]
            start_dict = session_start_vars[(cid, sid)]
            for (d, p), var in start_dict.items():
                if p == 6 or (s["duration"] == 2 and p == 5):
                    objective_terms.append(var * 50)

    # 2. Theory Spread Soft Penalty (R17):
    # Penalize scheduling multiple theory sessions of the same course on the same day.
    # For courses with tight windows (e.g., S1 AEC: 3 hours in 2 allowed days), this allows
    # 2 hours on one day without becoming INFEASIBLE, incurring only a small penalty (5).
    for cid, sessions in course_sessions.items():
        c_meta = courses_by_id[cid]
        cat = (c_meta.get("category") or "").upper().strip()
        # MDC in Sem 1 already has its hard 2h/1h separate-day constraint
        if semester == 1 and cat == "MDC":
            continue

        th_sessions = [s for s in sessions if not s["is_lab"] and s["duration"] == 1]
        if len(th_sessions) > 1:
            for d in DAYS:
                day_th_vars = []
                for s in th_sessions:
                    for p in PERIODS:
                        if (d, p) in session_start_vars.get((cid, s["id"]), {}):
                            day_th_vars.append(session_start_vars[(cid, s["id"])][(d, p)])
                if len(day_th_vars) > 1:
                    excess = model.NewIntVar(0, len(day_th_vars), f"excess_th_{cid}_d{d}")
                    model.Add(excess >= sum(day_th_vars) - 1)
                    objective_terms.append(excess * 5)

    # 3. Department Morning/Afternoon Preference (Weight 2)
    for cid, sessions in course_sessions.items():
        c_meta = courses_by_id[cid]
        is_cross_dept = c_meta.get("isCrossDept", False)

        for s in sessions:
            sid = s["id"]
            start_dict = session_start_vars[(cid, sid)]

            for (d, p), var in start_dict.items():
                if not is_cross_dept and p in [4, 5]:
                    # Single dept preferred in morning (penalty for afternoon)
                    objective_terms.append(var * 2)
                elif is_cross_dept and p in [1, 2, 3]:
                    # Cross dept preferred in afternoon (penalty for morning)
                    objective_terms.append(var * 2)

    # 4. Semester 1 MDC Day Preference (Prefer Thu for 2h, Fri for 1h - Weight 2)
    if semester == 1:
        for cid, sessions in course_sessions.items():
            c_meta = courses_by_id[cid]
            if (c_meta.get("category") or "").upper().strip() == "MDC":
                block_s = next((s for s in sessions if s["id"] == "mdc_block_2h"), None)
                single_s = next((s for s in sessions if s["id"] == "mdc_single_1h"), None)
                if block_s:
                    for (d, p), var in session_start_vars[(cid, block_s["id"])].items():
                        if d != 4:  # Not Thursday
                            objective_terms.append(var * 2)
                if single_s:
                    for (d, p), var in session_start_vars[(cid, single_s["id"])].items():
                        if d != 5:  # Not Friday
                            objective_terms.append(var * 2)

    if objective_terms:
        model.Minimize(sum(objective_terms))

    # ──────────────── Solve ────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_seconds
    solver.parameters.num_workers = num_workers
    solver.parameters.random_seed = int(config.get("random_seed", 42))

    start_time = time.time()
    status = solver.Solve(model)
    elapsed = time.time() - start_time

    status_str = "UNKNOWN"
    if status == cp_model.OPTIMAL:
        status_str = "OPTIMAL"
    elif status == cp_model.FEASIBLE:
        status_str = "FEASIBLE"
    elif status == cp_model.INFEASIBLE:
        status_str = "INFEASIBLE"
        diagnostics.append("CP-SAT proved the timetable constraints are mathematically INFEASIBLE.")
    elif status == cp_model.MODEL_INVALID:
        status_str = "MODEL_INVALID"
        diagnostics.append("CP-SAT returned MODEL_INVALID: input or variable configuration error.")
    else:
        status_str = "UNKNOWN"
        diagnostics.append("Solver search timed out or returned UNKNOWN without finding a solution.")

    assignments: List[Dict[str, Any]] = []

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for cid, sessions in course_sessions.items():
            c_meta = courses_by_id[cid]
            dept_id = c_meta.get("departmentId", "")

            for s in sessions:
                sid = s["id"]
                dur = s["duration"]
                is_lab = s["is_lab"]
                start_dict = session_start_vars[(cid, sid)]

                chosen_slot = None
                for slot, var in start_dict.items():
                    if solver.Value(var) == 1:
                        chosen_slot = slot
                        break

                if chosen_slot:
                    d, p = chosen_slot
                    if dur == 1:
                        assignments.append({
                            "courseId": cid,
                            "departmentId": dept_id,
                            "day": d,
                            "period": p,
                            "sessionType": "practical" if is_lab else "theory",
                            "isLabBlock": False,
                        })
                    elif dur == 2:
                        assignments.append({
                            "courseId": cid,
                            "departmentId": dept_id,
                            "day": d,
                            "period": p,
                            "sessionType": "practical" if is_lab else "theory",
                            "isLabBlock": True,
                        })
                        assignments.append({
                            "courseId": cid,
                            "departmentId": dept_id,
                            "day": d,
                            "period": p + 1,
                            "sessionType": "practical" if is_lab else "theory",
                            "isLabBlock": True,
                        })

    return {
        "status": status_str,
        "assignments": assignments,
        "diagnostics": diagnostics,
        "stats": {
            "wall_time_seconds": round(elapsed, 3),
            "branches": solver.NumBranches(),
            "conflicts": solver.NumConflicts(),
            "objective_value": solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
            "rule_hash": rule_hash,
            "total_courses": len(courses_data),
            "total_sessions_assigned": len(assignments),
        },
    }


def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1] != "-":
            with open(sys.argv[1], "r", encoding="utf-8") as f:
                input_data = json.load(f)
        else:
            input_data = json.load(sys.stdin)

        result = solve_timetable(input_data)
        json.dump(result, sys.stdout, indent=2)
        sys.exit(0)
    except Exception as e:
        error_res = {
            "status": "MODEL_INVALID",
            "assignments": [],
            "diagnostics": [f"Exception in solver execution: {str(e)}"],
            "stats": {"wall_time_seconds": 0.0},
        }
        json.dump(error_res, sys.stdout, indent=2)
        sys.stderr.write(f"Solver Error: {str(e)}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
