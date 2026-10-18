'use strict';

// Administrative test fixtures only. Auth is created with the server Admin API;
// course deliveries are inserted without changing catalogue ownership or enrolment.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readEnvironment } = require('./create-auth-accounts.cjs');
const ROOT = path.resolve(__dirname, '../..');
const PRIVATE = path.join(ROOT, 'scratch/mangat-replica-2026-10-18');
const CAMPUS = 'b72074e2-468e-4218-afb6-0f08f14cfe8f';
const YEAR = '2026-27';
const SEED = 'mangat-teachers-2026-10-18';
const PILOT_ID = 'cae5274b-7876-4826-bc5a-c8fcaf970d68';
const PILOT_EMAIL = 'teacher.ecott.01.mangattt.20261018@example.test';
const PILOT_COURSE = '02d890c4-fdd8-4d15-b6e0-2f78a0beb7e0';
const SHARED_HINDI = '998462b9-bfb7-470e-bed1-319c1fe182de';
const PASSWORD = 'Password123!';
const MAX_HOURS = 12;
const PROFILE = 'id,full_name,email,role,campus_id,department_id';
const PLAN_FILE = path.join(__dirname, 'TEACHER_STAFFING_PLAN.json');
const STATE_FILE = path.join(PRIVATE, 'teacher-creation-state.json');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
async function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(file + '.tmp', content, { mode: 0o600 });
  for (let attempt = 0; ; attempt++) {
    try { await fs.promises.rename(file + '.tmp', file); break; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 3) throw e;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
async function request(label, action) {
  let r;
  try { r = await action(); } catch { throw new Error(`${label}: network/SDK error; inspect the checkpoint before retrying.`); }
  if (r.error) throw new Error(`${label}: provider code ${String(r.error.code || r.error.status || 'unknown').replace(/[^\w-]/g, '').slice(0, 50)}.`);
  return r.data;
}
async function rows(client, table, configure = q => q) {
  const result = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const page = await request(`Read ${table}`, () => configure(client.from(table).select('*')).order('id').range(offset, offset + 499));
    result.push(...page);
    if (page.length < 500) return result;
  }
  throw new Error(`Pagination limit: ${table}`);
}
function previewScope() {
  const p = read(path.join(__dirname, 'replica-preview.json'));
  return { campus: p.campus, departments: p.departments };
}
async function snapshot(client) {
  const result = await Promise.all([
    rows(client, 'campuses', q => q.eq('id', CAMPUS)),
    rows(client, 'departments', q => q.eq('campus_id', CAMPUS)),
    rows(client, 'campus_settings', q => q.eq('campus_id', CAMPUS)),
    rows(client, 'students', q => q.eq('campus_id', CAMPUS)),
    rows(client, 'student_registrations', q => q.eq('campus_id', CAMPUS).eq('academic_year', YEAR).in('semester', [2, 4])),
    rows(client, 'faculty'),
    rows(client, 'teacher_course_assignments'),
    rows(client, 'timetable_entries', q => q.eq('campus_id', CAMPUS)),
  ]);
  const [campuses, departments, settings, students, registrations, faculty, assignments, timetable] = result;
  const courseIds = [...new Set(registrations.flatMap(r => Array.from({ length: 8 }, (_, i) => r[`slot_${i + 1}_course_id`]).filter(Boolean)))];
  const courses = courseIds.length ? await rows(client, 'courses', q => q.in('id', courseIds)) : [];
  return { campus: campuses[0], departments, settings: settings[0], students, registrations, faculty, assignments, timetable, courses };
}
function assertScope(s) {
  const expected = previewScope();
  check(s.campus?.id === CAMPUS && s.campus.code === 'MANGATTT' && s.campus.name === expected.campus.name, 'Unexpected campus.');
  check(s.departments.length === 8 && expected.departments.every(d => s.departments.some(x => ['id', 'code', 'name', 'campus_id'].every(k => d[k] === x[k]))), 'Test department ownership changed.');
  check(s.settings?.academic_year === YEAR && s.settings.deadline && new Date(s.settings.deadline) < new Date(), 'Expected the closed 2026-27 test registration window.');
  check(!s.timetable.length, 'Timetable already exists; staffing seed is closed.');
  check(s.students.length === 120 && s.registrations.length === 120 && new Set(s.registrations.map(r => r.student_id)).size === 120, 'Expected 120 distinct test students and registrations.');
  for (const r of s.registrations) {
    const student = s.students.find(x => x.id === r.student_id);
    check(student?.campus_id === CAMPUS && student.cap_application_number?.startsWith('TTMANGAT20261018-') && s.departments.some(d => d.id === student.department_id), 'Student outside the test manifest.');
    check(r.campus_id === CAMPUS && r.academic_year === YEAR && [2, 4].includes(r.semester) && r.total_credits === 22, 'Unexpected registration identity or credits.');
  }
  check(s.courses.length === 58, 'Enrolled course count changed; review the plan before writing.');
  for (const c of s.courses) {
    check([2, 4].includes(c.semester), 'Wrong course semester.');
    check(s.departments.some(d => d.id === c.department_id) && c.course_code.endsWith('TT') || c.id === SHARED_HINDI && c.course_code === 'KU02AECHIN103' && c.semester === 2 && c.category === 'AEC', 'Unapproved external course.');
  }
}
function basis(s) {
  return { campus: s.campus, departments: s.departments, settings: s.settings, students: s.students, registrations: s.registrations, courses: s.courses };
}
function parallelComponents(inputs) {
  const parents = new Map();
  const find = x => { if (!parents.has(x)) parents.set(x, x); if (parents.get(x) !== x) parents.set(x, find(parents.get(x))); return parents.get(x); };
  for (const input of inputs) for (const group of input.parallelGroups) {
    for (const id of group.courseIds.slice(1)) parents.set(find(id), find(group.courseIds[0]));
  }
  for (const input of inputs) for (const c of input.courses) find(c.courseId);
  return new Map([...parents.keys()].map(id => [id, find(id)]));
}
function allocateTeachers(courses, departments, components, pilotAssignment) {
  const eco = departments.find(d => d.code === 'ECOTT');
  check(eco, 'Test ECOTT department missing.');
  const pilotCourse = courses.find(c => c.id === PILOT_COURSE);
  check(pilotCourse && pilotAssignment?.teacher_id === PILOT_ID && pilotAssignment.course_id === PILOT_COURSE && pilotAssignment.campus_id === CAMPUS && pilotAssignment.semester === 2 && pilotAssignment.academic_year === YEAR, 'Pilot assignment changed.');
  const teachers = [{ full_name: 'TT ECOTT Teacher 01', email: PILOT_EMAIL, role: 'teacher', campus_id: CAMPUS, department_id: eco.id, department_code: eco.code, existing_id: PILOT_ID, weekly_hours: 0, course_ids: [] }];
  const assignments = [];
  function place(course, teacher, existing) {
    const hours = course.theory_hours_per_week + course.practical_hours_per_week;
    check(Number.isInteger(hours) && hours > 0 && hours <= MAX_HOURS, 'Invalid course contact hours.');
    teacher.course_ids.push(course.id); teacher.weekly_hours += hours;
    assignments.push({ id: existing?.id || crypto.randomUUID(), course_id: course.id, course_code: course.course_code, semester: course.semester, academic_year: YEAR, campus_id: CAMPUS, teacher_email: teacher.email, teacher_department_id: teacher.department_id, shared_delivery: course.id === SHARED_HINDI, existing: !!existing, expected_students: course.expected_students });
  }
  place(pilotCourse, teachers[0], pilotAssignment);
  const pending = courses.filter(c => c.id !== PILOT_COURSE).sort((a, b) => (b.theory_hours_per_week + b.practical_hours_per_week) - (a.theory_hours_per_week + a.practical_hours_per_week) || a.course_code.localeCompare(b.course_code));
  for (const course of pending) {
    const department = course.id === SHARED_HINDI ? eco : departments.find(d => d.id === course.department_id);
    check(department?.campus_id === CAMPUS, 'Teacher would be created outside the test campus.');
    const hours = course.theory_hours_per_week + course.practical_hours_per_week;
    let teacher = teachers.filter(t => t.department_id === department.id && t.weekly_hours + hours <= MAX_HOURS && t.course_ids.every(id => components.get(id) !== components.get(course.id))).sort((a, b) => a.weekly_hours - b.weekly_hours || a.email.localeCompare(b.email))[0];
    if (!teacher) {
      const serial = String(teachers.filter(t => t.department_id === department.id).length + 1).padStart(2, '0');
      teacher = { full_name: `TT ${department.code} Teacher ${serial}`, email: `teacher.${department.code.toLowerCase()}.${serial}.mangattt.20261018@example.test`, role: 'teacher', campus_id: CAMPUS, department_id: department.id, department_code: department.code, existing_id: null, weekly_hours: 0, course_ids: [] };
      teachers.push(teacher);
    }
    place(course, teacher);
  }
  return { teachers, assignments };
}
function validatePlan(plan, s) {
  const { sha256, ...body } = plan;
  check(hash(body) === sha256 && plan.seed_id === SEED && plan.campus_id === CAMPUS && plan.academic_year === YEAR, 'Plan identity/hash invalid.');
  assertScope(s);
  check(hash(basis(s)) === plan.basis_sha256, 'Campus, courses, settings, students or registrations changed after planning.');
  check(plan.assignments.length === 58 && new Set(plan.assignments.map(a => a.course_id)).size === 58, 'Plan must cover all 58 enrolled papers exactly once.');
  check(new Set(plan.teachers.map(t => t.email)).size === plan.teachers.length, 'Duplicate teacher emails.');
  for (const teacher of plan.teachers) {
    check(teacher.role === 'teacher' && teacher.campus_id === CAMPUS && s.departments.some(d => d.id === teacher.department_id && d.code === teacher.department_code), 'Teacher ownership invalid.');
    check(/^teacher\.[a-z]+\.\d{2}\.mangattt\.20261018@example\.test$/.test(teacher.email) && teacher.weekly_hours <= MAX_HOURS, 'Teacher identity/workload invalid.');
  }
  for (const a of plan.assignments) {
    const c = s.courses.find(c => c.id === a.course_id);
    const t = plan.teachers.find(t => t.email === a.teacher_email);
    check(c && t && a.campus_id === CAMPUS && a.academic_year === YEAR && a.semester === c.semester && t.course_ids.includes(c.id) && a.teacher_department_id === t.department_id, 'Assignment identity invalid.');
    check(c.department_id === t.department_id || c.id === SHARED_HINDI && t.department_code === 'ECOTT' && a.shared_delivery, 'Assignment crosses an unapproved department.');
  }
}
function assertAuth(user, teacher, plan) {
  const m = user?.app_metadata;
  check(user?.email === teacher.email && user.email_confirmed_at && m?.role === 'teacher' && m.campus_id === CAMPUS && m.department_id === teacher.department_id, `Auth identity mismatch: ${teacher.email}`);
  if (teacher.existing_id) check(user.id === PILOT_ID && teacher.existing_id === PILOT_ID, 'Only the verified pilot can be adopted.');
  else check(m.test_seed_id === SEED && m.test_plan_sha256 === plan.sha256, `Auth collision outside this plan: ${teacher.email}`);
}
function assertProfile(profile, teacher, id) {
  check(profile?.id === id && ['full_name', 'email', 'role', 'campus_id', 'department_id'].every(k => profile[k] === teacher[k]), `Faculty mismatch: ${teacher.email}`);
}
async function authPreflight(client, plan, s) {
  const wanted = new Set(plan.teachers.map(t => t.email)); const users = new Map();
  let complete = false;
  for (let page = 1; page <= 1000; page++) {
    const data = await request('List Auth', () => client.auth.admin.listUsers({ page, perPage: 200 }));
    for (const u of data.users) if (wanted.has(u.email)) { check(!users.has(u.email), 'Duplicate Auth listing.'); users.set(u.email, u); }
    if (data.users.length < 200) { complete = true; break; }
  }
  check(complete, 'Auth pagination incomplete.');
  const entries = plan.teachers.map(teacher => {
    const user = users.get(teacher.email);
    const profiles = s.faculty.filter(f => f.email === teacher.email || user && f.id === user.id);
    check(profiles.length <= 1 && (!profiles.length || user), `Faculty/Auth collision: ${teacher.email}`);
    if (user) assertAuth(user, teacher, plan);
    if (profiles[0]) assertProfile(profiles[0], teacher, user.id);
    check(!teacher.existing_id || user && profiles[0], 'Verified pilot is missing.');
    return { teacher, user, profile: profiles[0] };
  });
  for (const f of s.faculty.filter(f => f.campus_id === CAMPUS && f.role === 'teacher')) check(wanted.has(f.email), 'An unplanned teacher was added; review before proceeding.');
  for (const existing of s.assignments.filter(a => a.campus_id === CAMPUS && a.academic_year === YEAR && [2, 4].includes(a.semester))) {
    const planned = plan.assignments.find(a => a.id === existing.id);
    const owner = entries.find(e => e.teacher.email === planned?.teacher_email);
    check(planned && owner?.user?.id === existing.teacher_id && ['course_id', 'campus_id', 'academic_year', 'semester'].every(k => planned[k] === existing[k]), 'Existing test assignment conflicts with the saved plan; no rows will be overwritten.');
  }
  return entries;
}
function backendModules() {
  require(path.join(ROOT, 'node_modules/ts-node')).register({ project: path.join(ROOT, 'backend/tsconfig.json'), transpileOnly: true });
  return {
    loadGenerationInput: require(path.join(ROOT, 'backend/src/modules/timetable/solver/loader')).loadGenerationInput,
    FacultyService: require(path.join(ROOT, 'backend/src/modules/faculty/faculty.service')).FacultyService,
  };
}
async function credentials(state) {
  const header = ['# Test teacher credentials', '', `Status: ${state.status}. Initial passwords only; existing users are never reset.`, '', 'New teachers must change the initial password and accept the current policy through the app. The existing pilot uses its changed password.', '', '| Department | Name | Email | Initial password | Weekly hours | Course codes |', '|---|---|---|---|---:|---|'];
  for (const t of state.accounts) header.push(`| ${t.department_code} | ${t.full_name} | ${t.email} | ${t.existing_id ? 'Use changed pilot password' : PASSWORD} | ${t.weekly_hours} | ${t.course_codes.join(', ')} |`);
  await write(path.join(PRIVATE, 'TEACHER_CREDENTIALS.md'), header.join('\n') + '\n');
  await write(path.join(PRIVATE, 'teacher-credentials.json'), { ...state, accounts: state.accounts.map(t => ({ ...t, initial_password: t.existing_id ? null : PASSWORD })) });
}
async function verify(client, plan, { FacultyService, loadGenerationInput }) {
  const s = await snapshot(client); validatePlan(plan, s);
  const entries = await authPreflight(client, plan, s);
  check(entries.every(e => e.user && e.profile), 'Some teacher pairs are incomplete.');
  const checks = [];
  const faculty = new FacultyService({ admin: client }, { error: () => {} });
  async function verifyEntry(entry) {
    const t = entry.teacher;
    if (!t.existing_id && !entry.user.last_sign_in_at) check(entry.user.app_metadata.must_change_password === true && !entry.user.app_metadata.accepted_policy_version, 'A new teacher first-login or consent gate was bypassed.');
    const user = { userId: entry.user.id, role: 'teacher', email: t.email, campus_id: CAMPUS, department_id: t.department_id };
    const list = await faculty.getCourses(user);
    check(list.courses.length === t.course_ids.length && list.courses.every(c => c.campus_id === CAMPUS && c.academic_year === YEAR && t.course_ids.includes(c.id)), `Teacher course view mismatch: ${t.email}`);
    for (const course of list.courses) {
      const a = plan.assignments.find(a => a.course_id === course.id);
      check(course.delivery_id === a.id && course.semester === a.semester && course.enrolled_count === a.expected_students, 'Delivery identity/enrolment mismatch.');
      const roster = await faculty.getClassRoster(course.id, user, course.delivery_id);
      const rosterRows = Array.isArray(roster) ? roster : roster.students;
      check(Array.isArray(rosterRows) && rosterRows.length === a.expected_students, `Roster mismatch: ${a.course_code}`);
      checks.push({ course_code: a.course_code, semester: a.semester, teacher_id: entry.user.id, teacher_email: t.email, delivery_id: a.id, expected_students: a.expected_students, roster_students: rosterRows.length });
    }
    console.log(`Service roster checks passed: ${t.email}`);
  }
  for (let offset = 0; offset < entries.length; offset += 3) {
    const results = await Promise.allSettled(entries.slice(offset, offset + 3).map(verifyEntry));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
  for (const semester of [2, 4]) {
    const input = await loadGenerationInput(client, YEAR, semester, CAMPUS);
    check(input.courses.every(c => c.teacherId && plan.assignments.some(a => a.course_id === c.courseId && a.semester === semester && entries.some(e => e.teacher.email === a.teacher_email && e.user.id === c.teacherId))), 'Timetable loader has missing or wrong teachers.');
    for (const g of input.parallelGroups) {
      const ids = g.courseIds.map(id => input.courses.find(c => c.courseId === id)?.teacherId).filter(Boolean);
      check(new Set(ids).size === ids.length, 'A mandatory parallel group shares a teacher.');
    }
  }
  check(checks.length === 58, 'Expected 58 verified course rosters.');
  const report = { status: 'CREATED_ASSIGNED_SERVICE_READBACK_VERIFIED', verified_at: new Date().toISOString(), campus_id: CAMPUS, academic_year: YEAR, plan_sha256: plan.sha256, teacher_accounts: entries.length, new_teacher_accounts: entries.filter(e => !e.teacher.existing_id).length, course_assignments: 58, semester_2_assignments: checks.filter(c => c.semester === 2).length, semester_4_assignments: checks.filter(c => c.semester === 4).length, max_weekly_teacher_hours: Math.max(...plan.teachers.map(t => t.weekly_hours)), department_counts: Object.fromEntries(s.departments.map(d => [d.code, entries.filter(e => e.teacher.department_id === d.id).length])), checks: { auth_and_faculty_ownership: true, all_58_enrolled_courses_assigned: true, all_58_service_rosters_match: true, timetable_loader_teacher_coverage: true, mandatory_parallel_groups_have_distinct_teachers: true, timetable_entries_created: 0, new_teacher_login_and_consent_tested: false }, courses: checks, note: 'Administrative fixture provisioning through the Supabase Admin/Data APIs. Course/roster and loader checks call the current backend services; this does not bypass first-login restrictions or assert UI/login passes for the new teachers. Shared Hindi is a visiting delivery hosted only at MANGATTT, with its teacher owned by test ECOTT.' };
  await write(path.join(__dirname, 'TEACHER_STAFFING_VERIFICATION.json'), report);
  return report;
}
async function main() {
  const mode = process.argv[2] || '--prepare'; check(process.argv.length <= 3 && ['--prepare', '--check', '--apply', '--verify'].includes(mode), 'Use --prepare, --check, --apply or --verify.');
  const env = readEnvironment();
  const client = require('@supabase/supabase-js').createClient(env.url, env.secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const modules = backendModules();
  const s = await snapshot(client); assertScope(s);
  if (mode === '--prepare' && !fs.existsSync(PLAN_FILE)) {
    const inputs = [];
    for (const sem of [2, 4]) inputs.push(await modules.loadGenerationInput(client, YEAR, sem, CAMPUS));
    const courses = s.courses.map(c => ({ ...c, expected_students: s.registrations.filter(r => r.semester === c.semester && Array.from({ length: 8 }, (_, i) => r[`slot_${i + 1}_course_id`]).includes(c.id)).length }));
    const allocation = allocateTeachers(courses, s.departments, parallelComponents(inputs), s.assignments.find(a => a.teacher_id === PILOT_ID && a.course_id === PILOT_COURSE && a.campus_id === CAMPUS && a.academic_year === YEAR && a.semester === 2));
    const body = { seed_id: SEED, created_at: new Date().toISOString(), campus_id: CAMPUS, academic_year: YEAR, max_weekly_hours: MAX_HOURS, basis_sha256: hash(basis(s)), ...allocation, existing_assignments: s.assignments };
    await write(PLAN_FILE, { ...body, sha256: hash(body) });
  }
  check(fs.existsSync(PLAN_FILE), 'Run --prepare first.');
  const plan = read(PLAN_FILE); validatePlan(plan, s);
  const entries = await authPreflight(client, plan, s);
  if (['--prepare', '--check'].includes(mode)) {
    const summary = { status: 'PREFLIGHT_PASSED', teachers: entries.length, auth_to_create: entries.filter(e => !e.user).length, profiles_to_create: entries.filter(e => !e.profile).length, assignments_to_create: plan.assignments.filter(a => !s.assignments.some(x => x.id === a.id)).length, department_counts: Object.fromEntries(s.departments.map(d => [d.code, entries.filter(e => e.teacher.department_id === d.id).length])), writes_attempted: false };
    console.log(JSON.stringify(summary)); return;
  }
  if (mode === '--apply') {
    const state = { status: 'APPLYING', seed_id: SEED, plan_sha256: plan.sha256, started_at: new Date().toISOString(), accounts: entries.map(e => ({ ...e.teacher, auth_user_id: e.user?.id || null, stage: e.profile ? 'EXISTING_PAIR' : 'PENDING', course_codes: plan.assignments.filter(a => a.teacher_email === e.teacher.email).map(a => a.course_code) })) };
    const save = async () => { state.updated_at = new Date().toISOString(); await write(STATE_FILE, state); await credentials(state); };
    await save();
    try {
      for (const [index, e] of entries.entries()) {
        const record = state.accounts[index];
        if (!e.user) {
          record.stage = 'AUTH_CREATE_PENDING'; await save();
          const data = await request(`Create ${e.teacher.email}`, () => client.auth.admin.createUser({ email: e.teacher.email, password: PASSWORD, email_confirm: true, app_metadata: { role: 'teacher', campus_id: CAMPUS, department_id: e.teacher.department_id, must_change_password: true, test_seed_id: SEED, test_plan_sha256: plan.sha256 }, user_metadata: { full_name: e.teacher.full_name } }));
          check(data?.user?.id, 'Auth returned no user; inspect checkpoint and resume.');
          e.user = data.user; record.auth_user_id = e.user.id; record.stage = 'AUTH_CREATED_PROFILE_PENDING'; await save();
          assertAuth(e.user, e.teacher, plan);
        }
        if (!e.profile) {
          record.stage = 'FACULTY_INSERT_PENDING'; await save();
          const profile = Object.fromEntries(['full_name', 'email', 'role', 'campus_id', 'department_id'].map(k => [k, e.teacher[k]]));
          await request(`Create faculty ${e.teacher.email}`, () => client.from('faculty').insert({ id: e.user.id, ...profile }));
        }
        const p = await request('Read saved faculty', () => client.from('faculty').select(PROFILE).eq('id', e.user.id).single());
        assertProfile(p, e.teacher, e.user.id); record.stage = 'PAIR_VERIFIED'; await save();
        console.log(`Teacher verified: ${e.teacher.email}`);
      }
      const current = await snapshot(client); validatePlan(plan, current); await authPreflight(client, plan, current);
      for (const old of plan.existing_assignments) check(current.assignments.some(a => a.id === old.id && hash(a) === hash(old)), 'An existing assignment changed during provisioning.');
      const pending = plan.assignments.filter(a => !current.assignments.some(x => x.id === a.id)).map(a => ({ id: a.id, teacher_id: entries.find(e => e.teacher.email === a.teacher_email).user.id, course_id: a.course_id, campus_id: CAMPUS, academic_year: YEAR, semester: a.semester, assigned_by: null }));
      state.stage = 'ASSIGNMENT_INSERT_PENDING'; await save();
      if (pending.length) await request('Insert test-campus course deliveries', () => client.from('teacher_course_assignments').insert(pending));
      state.stage = 'ASSIGNMENTS_CREATED'; await save();
      const report = await verify(client, plan, modules);
      state.status = report.status; state.stage = 'VERIFIED'; await save();
      console.log(JSON.stringify({ status: report.status, teachers: report.teacher_accounts, new_teachers: report.new_teacher_accounts, assignments: report.course_assignments, max_weekly_hours: report.max_weekly_teacher_hours }));
    } catch (e) { state.status = 'PARTIAL_OR_UNCERTAIN'; state.error = e.message; await save(); throw e; }
  } else {
    const report = await verify(client, plan, modules);
    console.log(JSON.stringify({ status: report.status, teachers: report.teacher_accounts, assignments: report.course_assignments }));
  }
}
if (require.main === module) main().catch(e => { console.error(`Stopped: ${e.message}`); process.exitCode = 1; });
module.exports = { allocateTeachers, parallelComponents, assertAuth, assertProfile, hash, CAMPUS, PILOT_ID, PILOT_COURSE, SHARED_HINDI, MAX_HOURS };
