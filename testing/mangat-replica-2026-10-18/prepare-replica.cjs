// Builds local preview files only. No network or database writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const folder = __dirname;
if (fs.existsSync(path.join(folder, 'LIVE_STATUS.json'))) throw new Error('This test campus has a saved live execution record. Preserve its IDs and status; do not regenerate the pre-creation preview. See LIVE_STATUS.json for the executed scope and pending course/blueprint work.');
const repo = path.resolve(folder, '../..');
require(path.join(repo, 'node_modules/ts-node')).register({ project: path.join(repo, 'backend/tsconfig.json'), transpileOnly: true });
const { normalizeCourseCode, getBlueprintPathways, validatePathwaySlots, isCourseEligibleForSlot, evaluateCoursePrerequisites } = require(path.join(repo, 'backend/src/core/utils/slotRules'));
const source = JSON.parse(fs.readFileSync(path.join(folder, 'source-snapshot.json'), 'utf8'));
const sourceDepartmentIds = new Set(source.source_departments.map(department => department.id));
const sourceCourses = source.all_courses.filter(course => sourceDepartmentIds.has(course.department_id) && [2, 4].includes(course.semester));
const fingerprint = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
const previewPath = path.join(folder, 'replica-preview.json');
const previous = fs.existsSync(previewPath) ? JSON.parse(fs.readFileSync(previewPath, 'utf8')) : null;
if (previous && previous.source_snapshot_sha256 !== fingerprint) throw new Error('The saved preview belongs to a different source snapshot. Review the change before regenerating IDs.');
const stableId = (group, sourceId) => previous?.id_maps?.[group]?.[sourceId] || crypto.randomUUID();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(source.source_campus.id === '5b5289d5-17eb-43ba-832e-19883e9eaada' && source.source_campus.code === 'MANGAT', 'Unexpected source campus.');
assert(source.source_departments.length === 8 && sourceCourses.length === 61 && source.source_blueprints.length === 12, 'Source scope differs from the reviewed configuration.');
const campusId = stableId('campuses', source.source_campus.id);
const settingsId = stableId('settings', source.source_settings.id);
const departmentMap = new Map(source.source_departments.map(department => [department.id, { ...department, id: stableId('departments', department.id), name: `Test ${department.name} TT`, code: `${department.code}TT`, campus_id: campusId }]));
const codeMap = new Map(source.source_departments.map(department => [department.code, departmentMap.get(department.id).code]));
const courseIdMap = new Map(sourceCourses.map(course => [course.id, stableId('courses', course.id)]));
const courseMap = new Map(sourceCourses.map(course => [course.id, {
  ...course, id: courseIdMap.get(course.id), course_code: `${course.course_code.trim()}TT`,
  department_id: departmentMap.get(course.department_id).id,
  prerequisite_course_ids: (course.prerequisite_course_ids || []).map(id => { assert(courseIdMap.has(id), `Prerequisite outside S2/S4 copy scope for ${course.course_code}.`); return courseIdMap.get(id); }),
}]));
const fixes = [];
const compactCode = code => normalizeCourseCode(code).replace(/\s/g, '');
function fixedCourse(target, semester) {
  const exact = sourceCourses.filter(course => course.semester === semester && [target.trim(), normalizeCourseCode(target)].includes(course.course_code));
  if (exact.length === 1) return exact[0];
  const matches = sourceCourses.filter(course => course.semester === semester && compactCode(course.course_code) === compactCode(target));
  assert(matches.length === 1, `Cannot resolve source fixed course ${target} for Semester ${semester}.`);
  fixes.push({ semester, source_blueprint_target: target, source_stored_course_code: matches[0].course_code, test_target: courseMap.get(matches[0].id).course_code, reason: 'Source target does not exactly match the stored code. Map the copied slot to its actual TT record; do not edit the source.' });
  return matches[0];
}
function remapTarget(slot, semester) {
  if (['FIXED', 'AEC_ELECT', 'CAMPUS_FIXED'].includes(slot.rule)) return courseMap.get(fixedCourse(slot.target, semester).id).course_code;
  if (['DEPT_RESTRICTED', 'EXCLUDE_DEPT'].includes(slot.rule)) return slot.target.split(',').map(code => { const mapped = codeMap.get(code.trim().toUpperCase()); assert(mapped, `Unmapped department in source target ${slot.target}.`); return mapped; }).join(',');
  if (slot.rule === 'POOL_RESTRICTED') return 'POOLED';
  return slot.target;
}
const blueprints = source.source_blueprints.map(blueprint => {
  const { department_code, ...original } = blueprint;
  const pathways = getBlueprintPathways(blueprint).map((pathway, pathwayIndex) => ({ ...pathway, id: `tt-${department_code.toLowerCase()}-s${blueprint.semester}-${pathwayIndex + 1}`, name: pathway.name, slots: pathway.slots.map((slot, index) => ({ ...slot, slot: index + 1, target: remapTarget(slot, blueprint.semester) })) }));
  const copy = { ...original, id: stableId('blueprints', blueprint.id), department_id: departmentMap.get(blueprint.department_id).id, pathways };
  for (let number = 1; number <= 6; number++) {
    const slot = pathways[0]?.slots[number - 1];
    copy[`slot_${number}_rule`] = slot?.rule || null;
    copy[`slot_${number}_target`] = slot?.target || null;
    copy[`slot_${number}_name`] = slot?.name || null;
  }
  return copy;
});
const rules = source.prerequisite_rules.filter(rule => courseIdMap.has(rule.course_id)).map(rule => {
  const copy = { ...rule, id: stableId('prerequisite_rules', rule.id), course_id: courseIdMap.get(rule.course_id) };
  if (rule.rule === 'DEPARTMENT') copy.target = rule.target.split(',').map(code => { assert(codeMap.has(code.trim()), 'Unmapped prerequisite department.'); return codeMap.get(code.trim()); }).join(',');
  if (rule.rule === 'COMPLETED_COURSE') copy.target = courseMap.get(fixedCourse(rule.target, sourceCourses.find(course => course.id === rule.course_id).semester).id).course_code;
  return copy;
});
assert(source.all_campuses.every(campus => campus.code !== 'MANGATTT' && campus.name !== 'Test KUC Mangattuparamba TT'), 'The proposed test campus already exists.');
assert([...departmentMap.values()].every(department => !source.all_departments.some(original => original.code === department.code || original.name === department.name)), 'Test department name/code collision.');
assert([...courseMap.values()].every(course => course.course_code.length <= 30 && !source.all_courses.some(original => original.course_code === course.course_code)), 'Test course code length/collision failure.');
const testDepartments = [...departmentMap.values()];
const testCourses = [...courseMap.values()];
const allDepartments = [...source.all_departments, ...testDepartments];
const allCourses = [...source.all_courses, ...testCourses];
const allRules = [...source.prerequisite_rules, ...rules];
const testDepartmentIds = new Set(testDepartments.map(department => department.id));
const testCourseIds = new Set(testCourses.map(course => course.id));
const liveDeptMap = new Map(allDepartments.map(department => [department.code, department.id]));
const checks = [];
for (const blueprint of blueprints) {
  const department = testDepartments.find(department => department.id === blueprint.department_id);
  for (const pathway of blueprint.pathways) {
    const validation = validatePathwaySlots(pathway.slots);
    assert(validation.valid, `${department.code} S${blueprint.semester}: ${validation.errors.join('; ')}`);
    const fixedCodes = new Set(pathway.slots.filter(slot => ['FIXED', 'AEC_ELECT', 'CAMPUS_FIXED'].includes(slot.rule)).map(slot => normalizeCourseCode(slot.target)));
    const slots = pathway.slots.map(slot => {
      const fixed = ['FIXED', 'AEC_ELECT', 'CAMPUS_FIXED'].includes(slot.rule);
      const eligible = allCourses.filter(course => isCourseEligibleForSlot(course, slot.rule, slot.target, department.id, liveDeptMap, blueprint.semester, slot.name) && (fixed || !fixedCodes.has(normalizeCourseCode(course.course_code))));
      const allowed = eligible.filter(course => evaluateCoursePrerequisites(course, allRules.filter(rule => rule.course_id === course.id), { current_semester: blueprint.semester, department_code: department.code }, new Set(), new Set()).eligible);
      assert(allowed.length > 0, `${department.code} S${blueprint.semester} ${slot.name} has no eligible course after prerequisites.`);
      assert(!fixed || (allowed.length === 1 && testCourseIds.has(allowed[0].id)), 'A copied fixed slot does not resolve to its test-owned course.');
      return { slot: slot.slot, name: slot.name, rule: slot.rule, target: slot.target, eligible_count: allowed.length, test_course_count: allowed.filter(course => testCourseIds.has(course.id)).length, real_course_count: allowed.filter(course => !testCourseIds.has(course.id)).length, prerequisite_blocked_count: eligible.length - allowed.length, min_credits: Math.min(...allowed.map(course => course.credits)), max_credits: Math.max(...allowed.map(course => course.credits)) };
    });
    const min = slots.reduce((sum, slot) => sum + slot.min_credits, 0), max = slots.reduce((sum, slot) => sum + slot.max_credits, 0);
    assert(min >= blueprint.min_credits && max <= blueprint.max_credits, `${department.code} S${blueprint.semester} has options outside source credit limits.`);
    checks.push({ department_code: department.code, semester: blueprint.semester, pathway_id: pathway.id, source_min_credits: blueprint.min_credits, source_max_credits: blueprint.max_credits, attainable_credit_range: [min, max], slots });
  }
}
const ready = source.source_departments.filter(department => [2, 4].every(semester => source.source_blueprints.some(blueprint => blueprint.department_id === department.id && blueprint.semester === semester)));
assert(ready.length === 6, 'Expected six departments with complete S2/S4 blueprints.');
const accounts = [];
function account(role, name, local, department = null, details = {}) { accounts.push({ role, full_name: name, email: `${local}.mangattt.20261018@example.test`, campus_id: campusId, department_id: department?.id || null, ...details }); }
account('campus_director', 'TT Mangat Campus Director', 'director');
account('teaching_staff', 'TT Mangat Teaching Staff', 'teaching-staff');
for (const department of testDepartments) {
  account('hod', `TT ${department.code} HOD`, `hod.${department.code.toLowerCase()}`, department);
}
assert(accounts.length === 10 && new Set(accounts.map(account => account.email)).size === 10 && accounts.every(account => ['campus_director', 'hod', 'teaching_staff'].includes(account.role)), 'Expected ten director/HOD/teaching-staff accounts. Student and teacher creation are excluded.');
const copiedCampus = { ...source.source_campus, id: campusId, name: 'Test KUC Mangattuparamba TT', code: 'MANGATTT' };
const copiedSettings = { ...source.source_settings, id: settingsId, campus_id: campusId, deadline: null, last_promoted_at: null };
const preview = {
  status: 'PREPARED_AWAITING_LIVE_WRITE_CONFIRMATION', database_writes_executed: false,
  shared_cross_campus_behavior: 'EXPLICITLY_APPROVED_BY_USER', source_snapshot_sha256: fingerprint, source_inspected_at: source.inspected_at,
  id_maps: { campuses: { [source.source_campus.id]: campusId }, settings: { [source.source_settings.id]: settingsId }, departments: Object.fromEntries([...departmentMap].map(([id, department]) => [id, department.id])), courses: Object.fromEntries(courseIdMap), blueprints: Object.fromEntries(source.source_blueprints.map((blueprint, index) => [blueprint.id, blueprints[index].id])), prerequisite_rules: Object.fromEntries(source.prerequisite_rules.filter(rule => courseIdMap.has(rule.course_id)).map((rule, index) => [rule.id, rules[index].id])) },
  campus: copiedCampus, campus_settings: copiedSettings, departments: testDepartments, courses: testCourses, blueprints, prerequisite_rules: rules,
  source_reference_repairs_in_test_copy_only: fixes,
  student_creation: { mode: 'USER_BULK_UPLOAD_ONLY', create_student_profiles: false, create_student_auth_accounts: false, ready_department_codes: ready.map(department => departmentMap.get(department.id).code) },
  teacher_creation: { mode: 'DEFERRED_BY_USER', create_teacher_profiles: false, create_teacher_auth_accounts: false },
  counts: { campuses: 1, departments: testDepartments.length, courses: testCourses.length, semester_2_courses: testCourses.filter(course => course.semester === 2).length, semester_4_courses: testCourses.filter(course => course.semester === 4).length, blueprints: blueprints.length, students: accounts.filter(account => account.role === 'student').length, teachers: accounts.filter(account => account.role === 'teacher').length, staff: accounts.filter(account => account.role !== 'student').length, auth_accounts: accounts.length },
};
assert(preview.courses.every(course => testDepartmentIds.has(course.department_id)) && preview.blueprints.every(blueprint => testDepartmentIds.has(blueprint.department_id)), 'Copied records are owned by a real department.');
const report = { status: 'PASS_LOCAL_CONFIGURATION_WITH_APPROVED_SHARED_POOLS', live_database_writes_executed: false, checks, source_fixed_reference_repairs: fixes, incomplete_source_departments: source.source_departments.filter(department => !ready.some(readyDepartment => readyDepartment.id === department.id)).map(department => ({ code: department.code, name: department.name, courses: sourceCourses.filter(course => course.department_id === department.id).length, blueprints: source.source_blueprints.filter(blueprint => blueprint.department_id === department.id).length })), all_copied_course_and_blueprint_owners_are_test_departments: true, test_registration_starts_closed: true, shared_real_course_options_are_expected: true, note: 'Local catalogue/rule validation only. No login, live registration, allocation, timetable or attendance flow has been executed.' };
for (const [name, value] of [['replica-preview.json', preview], ['VALIDATION_REPORT.json', report], ['accounts-plan.json', { status: preview.status, student_creation: 'EXCLUDED_USER_BULK_UPLOAD_ONLY', teacher_creation: 'EXCLUDED_DEFERRED_BY_USER', passwords: 'The user requested a shared initial password for all test staff accounts, configured in ignored scratch/mangat-replica-2026-10-18/password-policy.json. Run prepare-credentials.cjs and reuse credentials.json during approved creation; no passwords are stored in this account plan.', accounts }]]) fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n');
const blueprintFolder = path.join(folder, 'blueprints'); fs.mkdirSync(blueprintFolder, { recursive: true });
for (const blueprint of blueprints) { const department = testDepartments.find(department => department.id === blueprint.department_id); fs.writeFileSync(path.join(blueprintFolder, `${department.code}-S${blueprint.semester}.json`), JSON.stringify(blueprint, null, 2) + '\n'); }
const doc = [
  '# KUC Mangattuparamba replica — pending confirmation', '',
  '**No live database changes have been made.** This package previews a new test campus from the saved source campus, inspected on 18 October 2026. The old deleted test campus and deleted fixture folder are not restored.', '',
  `Source: ${source.source_campus.name} (${source.source_campus.code}), ${source.source_campus.id}.`,
  '**Proposed new campus:** Test KUC Mangattuparamba TT (`MANGATTT`). All proposed UUIDs are new. Course codes retain the source code plus the `TT` suffix; embedded source spacing is retained.', '',
  '## Draft login credentials', '',
  'Run `node testing/mangat-replica-2026-10-18/prepare-credentials.cjs` to prepare or reopen the user-requested shared initial password without making Auth changes. Its value is configured in ignored `scratch/mangat-replica-2026-10-18/password-policy.json`. [All draft login credentials](../../scratch/mangat-replica-2026-10-18/AUTH_CREDENTIALS.md) are kept locally under ignored scratch/. The accounts are not active until their creation is approved and verified.', '',
  '## Auth creation script', '',
  '[Auth setup instructions](AUTH_SETUP.md) explain the server-only `create-auth-accounts.cjs` script. It reads the Supabase URL and secret/service-role key from `process.env`, defaults to an offline preview, supports read-only `--check`, and requires `--apply` for live writes. It creates only the ten planned staff accounts, initially `Password123!`, and matching faculty profiles. The planned test campus and its eight departments must exist first. The script has been tested locally; no live creation has been executed.', '',
  '## Exact proposed scope', '', '| Item | New records |', '|---|---:|',
  ...Object.entries(preview.counts).map(([name, count]) => `| ${name} | ${count} |`), '',
  'The setup creates only ten staff Auth users: one director, eight HODs and one teaching-staff account. **No student or teacher Auth accounts/profiles will be created by this setup. Students will be added by the user through bulk upload, and teacher creation is deferred.** All planned staff names/emails are synthetic; no source users, passwords or sessions are copied.', '',
  '| Source department | Test department | S2 courses | S4 courses | Copied blueprints |', '|---|---|---:|---:|---|',
  ...source.source_departments.map(original => { const target = departmentMap.get(original.id); return `| ${original.code} | ${target.code} | ${sourceCourses.filter(course => course.department_id === original.id && course.semester === 2).length} | ${sourceCourses.filter(course => course.department_id === original.id && course.semester === 4).length} | ${source.source_blueprints.filter(blueprint => blueprint.department_id === original.id).map(blueprint => 'S' + blueprint.semester).join(', ') || 'None saved'} |`; }), '',
  'After the test HOD accounts are created, upload students through the matching test HOD for each department. The rehearsal target remains 15–28 students per ready department across S2/S4; for example, 20 total with ten in each semester. Use 2026 admission for S2 and 2025 admission for S4. These are upload targets only, not accounts to seed. Statistics remains a course supplier because its S2/S4 blueprints are absent. Wood Science is mirrored as an empty department; no missing courses or blueprints are invented.', '',
  '## Copy and reset rules', '',
  '- Copy all 61 campus-owned S2/S4 courses with their stored titles, semester, category, credits, contact hours, capacities, tags and academic level. Assign them only to new test departments.',
  '- Copy the twelve saved pathway blueprints, including slot order, names, rules and source credit limits: S2 20–22; S4 0–22. Rewrite fixed course targets and department targets to their test counterparts; synchronize the six legacy slot columns with the copied default pathway.',
  '- Copy campus geofence/times and academic settings. Set the new deadline to null (registration initially closed) and last_promoted_at to null. The test director opens the test registration window through the normal flow.',
  '- Create only the ten director/HOD/teaching-staff Auth users and matching faculty profiles with server-controlled app_metadata. Reuse the locally prepared draft password in ignored scratch/ during approved creation. Students are excluded for user bulk upload. Teacher profiles and teacher Auth accounts are deferred.',
  '- Copy no registrations, preferences, allocations, attendance, timetables, assignment history, audit history or promotion state from the source.', '',
  '## Test-only reference repairs', '',
  ...fixes.map(fix => `- S${fix.semester} source slot target \`${fix.source_blueprint_target}\` does not match stored code \`${fix.source_stored_course_code}\`. The copied target will be \`${fix.test_target}\`. The original course and blueprint remain unchanged.`), '',
  '## Shared behavior explicitly approved', '',
  'GLOBAL_BASKET and EXCLUDE_DEPT keep their existing cross-campus behavior. TT suffixes identify copies for review/cleanup; they do not isolate option lists. Test students can see/select real courses, and real students can see test courses. Allocating test students to real courses can consume shared capacity. Shared language papers are used from the existing global catalogue and are not duplicated into invented language departments.', '',
  'The existing Malayalam AEC course KU02AECMAL101 is restricted to HIN/MAL by its source prerequisite rule. That restriction is preserved, so the six test cohorts use the eligible Hindi option for the basic S2 rehearsal. Do not silently loosen the real course rule.', '',
  'S2 EXCLUDE_DEPT rules ensure that minors exclude the specified home test department; they do not themselves enforce that Minor 1 and Minor 2 have different supplier departments. During the rehearsal, choose two distinct suppliers and record a defect if the agreed negative case is accepted.', '',
  '## Validation and execution', '',
  `All ${checks.length} copied pathways passed the current backend slot and prerequisite helpers against the expected combined real+test catalogue. Every slot has an eligible option, fixed slots resolve to TT copies, and all attainable course combinations total 22 credits within the copied limits. This is configuration validation only.`, '',
  'After confirmation: re-read and fingerprint the source; verify collision-free names, codes and UUIDs; create only the proposed test academic records in one short transaction; create the ten director/HOD/teaching-staff Auth users and faculty profiles with checkpoints; verify every copy and the unchanged source. Leave student creation to user bulk upload and defer teacher creation. Save an exact created-ID manifest for later scoped cleanup.', '',
  'Campus insertion initializes campus_settings through a live trigger; update only the new settings row rather than inserting a second one. Live foreign keys do not generally cascade campus deletion: future cleanup must remove dependents before parents.', '',
  'Files: source-snapshot.json (read-only source data), replica-preview.json (complete proposed academic records and ID maps), blueprints/ (twelve copied blueprints), accounts-plan.json (synthetic account plan without passwords), VALIDATION_REPORT.json (per-slot eligibility and cross-campus option counts).', '',
];
fs.writeFileSync(path.join(folder, 'README.md'), doc.join('\n'));
console.log(JSON.stringify({ status: preview.status, shared_behavior: preview.shared_cross_campus_behavior, counts: preview.counts, local_validation: report.status, fixed_reference_repairs: fixes, database_writes_executed: false }, null, 2));
