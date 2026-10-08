#!/usr/bin/env python3
"""
OR-Tools CP-SAT Timetable Solver for FYIMP (Plan 06)
Complies with F15, F33, F34, F35, F36, F37, F39, F40, F41, F42, F71, D03, D04, D05.
"""

import sys
import json
import time
from typing import Dict, List, Any, Tuple, Set
from ortools.sat.python import cp_model


def solve_timetable(input_data: Dict[str, Any]) -> Dict[str, Any]:
    academic_year = input_data.get("academic_year", "")
    semester = int(input_data.get("semester", 1))
    campus_id = input_data.get("campus_id", "")
    courses_data = input_data.get("courses", [])
    parallel_groups_data = input_data.get("parallel_groups", [])
    teacher_reservations = input_data.get("teacher_reservations", [])
    constraints = input_data.get("constraints", {})
    config = input_data.get("config", {})

    max_seconds = float(config.get("max_time_in_seconds", 30))
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

    # Parse semester-specific JSON constraints
    sem_constraints = constraints.get("semester_constraints", {}).get(str(semester), {})
    sem_hard = sem_constraints.get("hard_constraints", [])

    model = cp_model.CpModel()

    # Data structures for courses
    # Course ID -> Course dict
    courses_by_id: Dict[str, Dict[str, Any]] = {c["courseId"]: c for c in courses_data}

    # Session definitions per course:
    # A session has a type ('theory' or 'lab_block' or 'lab_single'), index, duration
    # We create boolean indicator variables: X[(course_id, session_id, day, period)] == 1 if session is active at (day, period)
    # For a lab_block starting at (d, p), it is active at (d, p) and (d, p+1).

    course_sessions: Dict[str, List[Dict[str, Any]]] = {}

    for c in courses_data:
        cid = c["courseId"]
        t_hours = int(c.get("theoryHours", 0))
        p_hours = int(c.get("practicalHours", 0))
        category = (c.get("category") or "").upper().strip()

        sessions = []

        # D04 Check: Semester 3 VAC restriction with > 2 hours
        if semester == 3 and category == "VAC" and (t_hours + p_hours) > 2:
            diagnostics.append(
                f"Course {c.get('courseCode')} (VAC) has {t_hours + p_hours} contact hours, "
                f"which exceeds the Semester 3 Monday P5+P6 (2-hour) limit (Observation D04)."
            )

        # Semester 1 MDC rule: "MDC courses (3 theory hours) must be split into a 2-hour continuous session on one day and a 1-hour session on another day"
        is_sem1_mdc = (semester == 1 and category == "MDC" and t_hours == 3 and p_hours == 0)

        if is_sem1_mdc:
            # 1 2-hour block + 1 1-hour block
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

            # Practical sessions: 2-hour consecutive lab blocks
            lab_blocks_count = p_hours // 2
            for i in range(lab_blocks_count):
                sessions.append({
                    "id": f"lab_{i+1}",
                    "type": "lab_block_2h",
                    "duration": 2,
                    "is_lab": True,
                })

            # Observation D03: Odd practical hour (e.g. practicalHours == 1)
            if p_hours % 2 != 0:
                diagnostics.append(
                    f"Course {c.get('courseCode')} has practical_hours={p_hours} (odd number, Observation D03). "
                    f"Scheduling single 1-hour practical period."
                )
                sessions.append({
                    "id": f"lab_odd",
                    "type": "lab_single",
                    "duration": 1,
                    "is_lab": True,
                })

        course_sessions[cid] = sessions

    # Decision Variables:
    # For each course c and session s:
    # If duration == 1:
    #   V[(c, s_id, d, p)] is BoolVar indicating placement at (d, p)
    # If duration == 2:
    #   Start[(c, s_id, d, p)] is BoolVar for start at (d, p) where p in LAB_START_PERIODS
    #   Occupies (d, p) and (d, p+1)

    # Indicator of whether course c has ANY session at slot (d, p)
    # active_vars[(c, d, p)] = list of BoolVars
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
                    # Enforce domain restrictions upfront
                    # Semester 1 AEC restriction: "strictly on Tuesdays (2) and/or Wednesdays (3) during afternoon (P4, P5, P6)"
                    if semester == 1 and category == "AEC":
                        if d not in [2, 3] or p not in [4, 5, 6]:
                            continue

                    v = model.NewBoolVar(f"x_{cid}_{sid}_d{d}_p{p}")
                    start_dict[(d, p)] = v
                    active_vars[(cid, d, p)].append(v)

                # Exactly one slot must be selected
                if start_dict:
                    model.AddExactlyOne(list(start_dict.values()))
                else:
                    diagnostics.append(f"Domain for course {cid} session {sid} is empty under constraints.")

            elif dur == 2:
                # 2-hour continuous block
                for d in DAYS:
                    for p in LAB_START_PERIODS:
                        # Semester 1 AEC restriction for 2-hour blocks if any
                        if semester == 1 and category == "AEC":
                            if d not in [2, 3] or p not in [4, 5]:
                                continue

                        # Semester 3 VAC restriction: "strictly on Mondays (1) during Periods 5 and 6 (P5+P6)"
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

            session_start_vars[(cid, sid)] = start_dict

    # ──────────────── Hard Constraints ────────────────

    # 1. No course can have > 1 session in the same slot
    for (cid, d, p), var_list in active_vars.items():
        if len(var_list) > 1:
            model.Add(sum(var_list) <= 1)

    # 2. Theory spread: no two theory sessions of same course on same day (if theoryHours <= 5)
    for cid, sessions in course_sessions.items():
        th_sessions = [s for s in sessions if not s["is_lab"] and s["duration"] == 1]
        if len(th_sessions) <= 5 and len(th_sessions) > 1:
            for d in DAYS:
                day_th_vars = []
                for s in th_sessions:
                    for p in PERIODS:
                        if (d, p) in session_start_vars[(cid, s["id"])]:
                            day_th_vars.append(session_start_vars[(cid, s["id"])][(d, p)])
                if day_th_vars:
                    model.Add(sum(day_th_vars) <= 1)

    # Semester 1 MDC spread: 2h block and 1h block on DIFFERENT days
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
    # Map student -> set of courseIds
    student_courses: Dict[str, Set[str]] = {}
    for c in courses_data:
        cid = c["courseId"]
        for s_id in c.get("studentIds", []):
            if s_id not in student_courses:
                student_courses[s_id] = set()
            student_courses[s_id].add(cid)

    # To keep model concise, find pairs of conflicting courses
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
            base_sessions = course_sessions[base_cid]

            for other_cid in grp_cids[1:]:
                other_sessions = course_sessions[other_cid]
                # Compare session by session if they share the same structure
                if len(base_sessions) == len(other_sessions):
                    for idx in range(len(base_sessions)):
                        b_sid = base_sessions[idx]["id"]
                        o_sid = other_sessions[idx]["id"]
                        b_dict = session_start_vars.get((base_cid, b_sid), {})
                        o_dict = session_start_vars.get((other_cid, o_sid), {})

                        for slot_key in b_dict:
                            if slot_key in o_dict:
                                model.Add(b_dict[slot_key] == o_dict[slot_key])

    # ──────────────── Soft Constraints / Objective ────────────────
    # Minimize penalties:
    # 1. Period 6 usage penalty (Extended Period Policy)
    # 2. Single-dept morning preference (P1-P3) / Cross-dept afternoon preference (P4-P5)
    objective_terms = []

    for cid, sessions in course_sessions.items():
        c_meta = courses_by_id[cid]
        is_cross_dept = c_meta.get("isCrossDept", False)

        for s in sessions:
            sid = s["id"]
            start_dict = session_start_vars[(cid, sid)]

            for (d, p), var in start_dict.items():
                # Period 6 penalty (weight 10)
                if p == 6 or (s["duration"] == 2 and p == 5):
                    objective_terms.append(var * 10)

                # Department preference
                if not is_cross_dept and p in [4, 5]:
                    # Single dept preferred in morning (penalty for afternoon)
                    objective_terms.append(var * 2)
                elif is_cross_dept and p in [1, 2, 3]:
                    # Cross dept preferred in afternoon (penalty for morning)
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
                        # Emits both periods of the block
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
            "total_courses": len(courses_data),
            "total_sessions_assigned": len(assignments),
        },
    }


def main():
    try:
        # Read JSON from stdin or file path arg
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
