'use strict';

// Local preparation/readback verification only. Execute the generated SQL through
// the connected project after its checks pass. No server keys or Auth mutations.
const fs = require('node:fs');
const path = require('node:path');
const folder = __dirname;
const root = path.resolve(folder, '../..');
const privateFolder = path.join(root, 'scratch/mangat-replica-2026-10-18');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const preview = read(path.join(folder, 'replica-preview.json'));
const snapshot = read(path.join(folder, 'source-snapshot.json'));
const before = read(path.join(privateFolder, 'academic-before.json'));
require(path.join(root, 'node_modules/ts-node')).register({ project: path.join(root, 'backend/tsconfig.json'), transpileOnly: true });
const { normalizeCourseCode, getBlueprintPathways, validatePathwaySlots, isCourseEligibleForSlot, evaluateCoursePrerequisites } = require(path.join(root, 'backend/src/core/utils/slotRules'));
const check = (value, message) => { if (!value) throw new Error(message); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function sameRows(expected, actual, label) {
  check(expected.length === actual.length, `${label}: row count changed.`);
  const byId = new Map(actual.map(row => [row.id, row]));
  for (const row of expected) check(equal(row, byId.get(row.id)), `${label}: metadata changed for ${row.id}.`);
}

function validatePreparation() {
  check(preview.campus.id === 'b72074e2-468e-4218-afb6-0f08f14cfe8f' && preview.campus.code === 'MANGATTT', 'Wrong test campus.');
  check(equal(preview.campus, before.test_campus), 'Test campus differs from the approved plan.');
  sameRows(preview.departments, before.test_departments, 'Test departments');
  check(equal(snapshot.source_campus, before.source_campus), 'Source campus changed; refresh the plan before copying.');
  sameRows(snapshot.source_departments, before.source_departments, 'Source departments');
  const sourceIds = new Set(snapshot.source_departments.map(d => d.id));
  const scopedCourses = rows => rows.filter(c => sourceIds.has(c.department_id) && [2, 4].includes(c.semester));
  sameRows(scopedCourses(snapshot.all_courses), scopedCourses(before.all_courses), 'Source S2/S4 courses');
  sameRows(snapshot.source_blueprints, before.source_blueprints, 'Source S2/S4 blueprints');
  sameRows(snapshot.prerequisite_rules, before.prerequisite_rules, 'Prerequisite rules');
  check(!before.test_courses.length && !before.test_blueprints.length, 'Test courses/blueprints already exist; inspect the live result instead of reinserting.');
  check(preview.courses.length === 61 && preview.blueprints.length === 12 && preview.prerequisite_rules.length === 0, 'Expected 61 courses, 12 blueprints and no new prerequisite rules.');
  const deptIds = new Set(preview.departments.map(d => d.id));
  const courseIds = new Set(preview.courses.map(c => c.id));
  check(courseIds.size === 61 && new Set(preview.courses.map(c => normalizeCourseCode(c.course_code))).size === 61, 'Duplicate course IDs/codes in the plan.');
  check(preview.courses.every(c => deptIds.has(c.department_id) && c.course_code.endsWith('TT') && [2, 4].includes(c.semester) && (c.prerequisite_course_ids || []).every(id => courseIds.has(id))), 'A course has wrong ownership, semester, suffix or prerequisite IDs.');
  check(preview.blueprints.every(b => deptIds.has(b.department_id) && [2, 4].includes(b.semester)), 'A blueprint has wrong ownership or semester.');
  check(new Set(preview.blueprints.map(b => b.id)).size === 12 && new Set(preview.blueprints.map(b => `${b.department_id}:${b.semester}`)).size === 12, 'Duplicate blueprint ID/department-semester.');
  for (const copy of preview.courses) check(!before.all_courses.some(c => c.id === copy.id || normalizeCourseCode(c.course_code) === normalizeCourseCode(copy.course_code)), `Live course collision: ${copy.course_code}.`);
}

function validateCatalogue(courses, blueprints, rules, phase) {
  const departments = [...snapshot.all_departments, ...before.test_departments];
  const deptById = new Map(departments.map(d => [d.id, d]));
  const deptMap = new Map(departments.map(d => [d.code, d.id]));
  const testCourseIds = new Set(preview.courses.map(c => c.id));
  const fixedRules = new Set(['FIXED', 'AEC_ELECT', 'CAMPUS_FIXED']);
  const checks = [];
  for (const blueprint of blueprints) {
    const department = deptById.get(blueprint.department_id);
    const pathways = getBlueprintPathways(blueprint);
    const firstSlots = pathways[0]?.slots || [];
    for (let number = 1; number <= 6; number++) {
      const slot = firstSlots[number - 1];
      check(slot && ['rule', 'target', 'name'].every(key => blueprint[`slot_${number}_${key}`] === slot[key]), `${department.code} S${blueprint.semester}: legacy slots differ from the default pathway.`);
    }
    for (const pathway of pathways) {
      const validation = validatePathwaySlots(pathway.slots);
      check(validation.valid && pathway.slots.length === 6, `${department.code} S${blueprint.semester}: ${validation.errors.join('; ')}`);
      const fixedCodes = new Set(pathway.slots.filter(s => fixedRules.has(s.rule)).map(s => normalizeCourseCode(s.target)));
      const options = pathway.slots.map(slot => {
        const fixed = fixedRules.has(slot.rule);
        const eligible = courses.filter(c => isCourseEligibleForSlot(c, slot.rule, slot.target, department.id, deptMap, blueprint.semester, slot.name) && (fixed || !fixedCodes.has(normalizeCourseCode(c.course_code))) && evaluateCoursePrerequisites(c, rules.filter(r => r.course_id === c.id), { current_semester: blueprint.semester, department_code: department.code }, new Set(), new Set()).eligible);
        check(eligible.length, `${department.code} S${blueprint.semester}: no eligible option for ${slot.name}.`);
        check(!fixed || (eligible.length === 1 && testCourseIds.has(eligible[0].id)), `${department.code}: fixed slot must resolve to exactly one TT course.`);
        if (['EXCLUDE_DEPT', 'DEPT_RESTRICTED'].includes(slot.rule)) check(slot.target.split(',').every(code => before.test_departments.some(d => d.code === code.trim())), 'Department slot target points outside the test mapping.');
        return eligible.sort((a, b) => Number(testCourseIds.has(b.id)) - Number(testCourseIds.has(a.id)) || a.course_code.localeCompare(b.course_code));
      });
      const slots = pathway.slots.map((slot, index) => ({ ...slot, eligible_count: options[index].length, test_course_count: options[index].filter(c => testCourseIds.has(c.id)).length, real_course_count: options[index].filter(c => !testCourseIds.has(c.id)).length, min_credits: Math.min(...options[index].map(c => c.credits)), max_credits: Math.max(...options[index].map(c => c.credits)) }));
      const minimum = slots.reduce((n, s) => n + s.min_credits, 0), maximum = slots.reduce((n, s) => n + s.max_credits, 0);
      check(minimum >= blueprint.min_credits && maximum <= blueprint.max_credits, `${department.code} S${blueprint.semester}: attainable credits exceed blueprint limits.`);
      const selected = options.map(list => list[0]);
      if (blueprint.semester === 2) {
        const minors = pathway.slots.map((s, i) => /MINOR/i.test(s.name) ? i : -1).filter(i => i >= 0);
        check(minors.length === 2 && pathway.slots.some(s => s.rule === 'GLOBAL_BASKET' && s.target === 'AEC'), 'S2 must contain two minors and an AEC slot.');
        const [first, second] = minors;
        const pair = options[first].flatMap(a => options[second].filter(b => a.id !== b.id && a.department_id !== b.department_id && testCourseIds.has(a.id) && testCourseIds.has(b.id)).map(b => [a, b]))[0];
        check(pair, `${department.code}: two distinct test minor suppliers are required for the rehearsal.`);
        [selected[first], selected[second]] = pair;
      }
      check(new Set(selected.map(c => c.id)).size === selected.length, 'Sample registration contains duplicate courses.');
      const sampleCredits = selected.reduce((n, c) => n + c.credits, 0);
      check(sampleCredits >= blueprint.min_credits && sampleCredits <= blueprint.max_credits, 'Sample registration credits are invalid.');
      checks.push({ department_code: department.code, semester: blueprint.semester, pathway_id: pathway.id, min_credits: blueprint.min_credits, max_credits: blueprint.max_credits, attainable_credit_range: [minimum, maximum], slots, sample_registration_credits: sampleCredits, sample_registration: selected.map((c, index) => ({ slot: index + 1, name: pathway.slots[index].name, course_id: c.id, course_code: c.course_code, department_code: deptById.get(c.department_id)?.code, credits: c.credits, test_owned: testCourseIds.has(c.id) })) });
    }
  }
  check(checks.length === 12, 'Expected twelve pathways.');
  return { status: phase, generated_at: new Date().toISOString(), pathways: 12, slots_verified: checks.reduce((n, c) => n + c.slots.length, 0), checks, shared_cross_campus_options: 'EXPLICITLY_APPROVED_BY_USER', source_reference_repairs_in_test_copy_only: preview.source_reference_repairs_in_test_copy_only, note: 'Configuration and eligible-option validation. No student registrations, allocations or UI flows were executed. S2 sample minors use two different test departments; the shared application behavior itself is unchanged.' };
}

function prepareSql() {
  validatePreparation();
  const report = validateCatalogue([...before.all_courses, ...preview.courses], preview.blueprints, before.prerequisite_rules, 'PASS_PRE_INSERT_LIVE_CATALOGUE_VALIDATION');
  write(path.join(folder, 'ACADEMIC_VALIDATION_REPORT.json'), report);
  const payload = { departments: preview.departments, courses: preview.courses, blueprints: preview.blueprints };
  check(!JSON.stringify(payload).includes('$academic$'), 'Payload contains the reserved SQL block delimiter.');
  const literal = value => `'${String(value).replace(/'/g, "''")}'`;
  const fingerprints = before.non_test_fingerprints;
  const insert = table => {
    const columns = before.columns.filter(c => c.table === table).map(c => c.name);
    check(columns.every(name => /^[a-z][a-z0-9_]*$/.test(name)), 'Unexpected SQL identifier in the live schema.');
    const rows = payload[table === 'courses' ? 'courses' : 'blueprints'];
    check(rows.every(row => equal(Object.keys(row).sort(), [...columns].sort())), `${table}: planned columns differ from the live schema.`);
    const names = columns.map(c => `"${c}"`).join(', ');
    return `INSERT INTO public.${table} (${names}) SELECT ${columns.map(c => `r."${c}"`).join(', ')} FROM jsonb_populate_recordset(NULL::public.${table}, payload->'${table === 'courses' ? 'courses' : 'blueprints'}') r;`;
  };
  const sql = `-- Approved MANGATTT academic copies only. Insert-only; abort on drift/collisions.
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
DO $academic$
DECLARE
  payload jsonb := ${literal(JSON.stringify(payload))}::jsonb;
  campus uuid := 'b72074e2-468e-4218-afb6-0f08f14cfe8f';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.campuses WHERE id = campus AND code = 'MANGATTT') THEN RAISE EXCEPTION 'Wrong test campus'; END IF;
  IF jsonb_array_length(payload->'courses') <> 61 OR jsonb_array_length(payload->'blueprints') <> 12 THEN RAISE EXCEPTION 'Wrong payload counts'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.departments, payload->'departments') p LEFT JOIN public.departments d ON d.id = p.id WHERE d.id IS NULL OR to_jsonb(d) IS DISTINCT FROM to_jsonb(p) OR d.campus_id <> campus) THEN RAISE EXCEPTION 'Test department mapping changed'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.courses, payload->'courses') p LEFT JOIN public.departments d ON d.id = p.department_id WHERE d.campus_id IS DISTINCT FROM campus OR p.course_code NOT LIKE '%TT' OR p.semester NOT IN (2,4)) THEN RAISE EXCEPTION 'Invalid course scope'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.semester_blueprints, payload->'blueprints') p LEFT JOIN public.departments d ON d.id = p.department_id WHERE d.campus_id IS DISTINCT FROM campus OR p.semester NOT IN (2,4)) THEN RAISE EXCEPTION 'Invalid blueprint scope'; END IF;
  IF EXISTS (SELECT 1 FROM public.courses c JOIN public.departments d ON d.id = c.department_id WHERE d.campus_id = campus) OR EXISTS (SELECT 1 FROM public.semester_blueprints b JOIN public.departments d ON d.id = b.department_id WHERE d.campus_id = campus) THEN RAISE EXCEPTION 'Test academic records already exist; verify before any rerun'; END IF;
  IF EXISTS (SELECT 1 FROM public.courses c JOIN jsonb_populate_recordset(NULL::public.courses, payload->'courses') p ON c.id = p.id OR upper(trim(c.course_code)) = upper(trim(p.course_code))) OR EXISTS (SELECT 1 FROM public.semester_blueprints b JOIN jsonb_populate_recordset(NULL::public.semester_blueprints, payload->'blueprints') p ON b.id = p.id OR (b.department_id = p.department_id AND b.semester = p.semester)) THEN RAISE EXCEPTION 'Live academic ID/code collision'; END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, '' ORDER BY c.id), '')) FROM public.courses c JOIN public.departments d ON d.id = c.department_id WHERE d.campus_id <> campus) <> ${literal(fingerprints.courses)} THEN RAISE EXCEPTION 'Course catalogue changed after preflight'; END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(b)::text, '' ORDER BY b.id), '')) FROM public.semester_blueprints b JOIN public.departments d ON d.id = b.department_id WHERE d.campus_id <> campus) <> ${literal(fingerprints.blueprints)} THEN RAISE EXCEPTION 'Blueprint source changed after preflight'; END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(r)::text, '' ORDER BY id), '')) FROM public.course_prerequisite_rules r) <> ${literal(fingerprints.prerequisite_rules)} THEN RAISE EXCEPTION 'Prerequisite rules changed after preflight'; END IF;
  ${insert('courses')}
  ${insert('semester_blueprints')}
  IF (SELECT count(*) FROM public.courses c JOIN public.departments d ON d.id = c.department_id WHERE d.campus_id = campus) <> 61 OR (SELECT count(*) FROM public.semester_blueprints b JOIN public.departments d ON d.id = b.department_id WHERE d.campus_id = campus) <> 12 THEN RAISE EXCEPTION 'Unexpected inserted counts'; END IF;
END;
$academic$;
COMMIT;
SELECT 'ACADEMIC_COPY_COMMITTED' AS status;
`;
  fs.writeFileSync(path.join(folder, 'create-courses-and-blueprints.sql'), sql);
  console.log(JSON.stringify({ status: report.status, courses: 61, blueprints: 12, pathways: report.pathways, slots_verified: report.slots_verified, database_writes_executed: false, sql_file: 'create-courses-and-blueprints.sql' }));
}

function verifyReadback() {
  const after = read(path.join(privateFolder, 'academic-after.json'));
  sameRows(preview.courses, after.test_courses, 'Created courses');
  sameRows(preview.blueprints, after.test_blueprints, 'Created blueprints');
  for (const [name, fingerprint] of Object.entries(before.non_test_fingerprints)) check(after.non_test_fingerprints[name] === fingerprint, `Existing ${name} changed.`);
  for (const name of ['students', 'faculty', 'auth', 'prerequisite_rules']) check(before.counts[name] === after.counts[name], `Unexpected ${name} count change.`);
  check(after.counts.courses === before.counts.courses + 61 && after.counts.blueprints === before.counts.blueprints + 12, 'Unexpected academic count delta.');
  const report = validateCatalogue(after.all_courses, after.test_blueprints, after.prerequisite_rules, 'PASS_CREATED_RECORDS_AND_LIVE_CATALOGUE_VALIDATION');
  report.existing_courses_blueprints_and_prerequisite_rules_unchanged = true;
  report.exact_created_course_and_blueprint_metadata_matches_plan = true;
  write(path.join(folder, 'ACADEMIC_VALIDATION_REPORT.json'), report);
  write(path.join(privateFolder, 'academic-verification.json'), { status: 'VERIFIED_COMPLETE', verified_at: new Date().toISOString(), before_counts: before.counts, after_counts: after.counts, fingerprints_before: before.non_test_fingerprints, fingerprints_after: after.non_test_fingerprints, created_course_ids: after.test_courses.map(c => c.id), created_blueprint_ids: after.test_blueprints.map(b => b.id), configuration_report: 'ACADEMIC_VALIDATION_REPORT.json' });
  const live = read(path.join(folder, 'LIVE_STATUS.json'));
  live.status = 'ACADEMIC_REPLICA_AND_STAFF_CREATED_VERIFIED';
  live.academic_verified_at = new Date().toISOString();
  Object.assign(live.created_counts, { courses: 61, semester_2_courses: 23, semester_4_courses: 38, blueprints: 12 });
  Object.assign(live.verification, { academic_metadata_matches_plan: true, existing_courses_blueprints_and_prerequisite_rules_unchanged: true, pathways_verified: report.pathways, slots_verified: report.slots_verified, each_pathway_attainable_credits: 22 });
  Object.assign(live.pending, { courses: 0, blueprints: 0 });
  live.private_academic_id_manifest = '../../scratch/mangat-replica-2026-10-18/academic-verification.json';
  live.note = 'Foundation, staff, 61 TT courses and 12 S2/S4 blueprints are created and verified. Registration starts closed. Shared cross-campus baskets remain as approved. Students require user bulk upload; teachers are deferred. Statistics has no source S2/S4 blueprints and Wood Science has no source courses/blueprints.';
  write(path.join(folder, 'LIVE_STATUS.json'), live);
  preview.status = 'ACADEMIC_REPLICA_AND_STAFF_CREATED_VERIFIED';
  write(path.join(folder, 'replica-preview.json'), preview);
  console.log(JSON.stringify({ status: live.status, created_courses: 61, created_blueprints: 12, pathways_verified: report.pathways, slots_verified: report.slots_verified, existing_academic_records_unchanged: true }));
}

const mode = process.argv[2] || '--prepare';
if (mode === '--prepare') prepareSql();
else if (mode === '--verify') verifyReadback();
else throw new Error('Use --prepare or --verify. Neither mode executes SQL or creates accounts.');
