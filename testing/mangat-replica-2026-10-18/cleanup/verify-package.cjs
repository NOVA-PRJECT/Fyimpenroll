#!/usr/bin/env node
'use strict';
// Offline package validation only. No environment variables, network calls or DB mutations.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = __dirname;
const project = 'lhnjlwtdphugjaluzrsp';
const campus = 'b72074e2-468e-4218-afb6-0f08f14cfe8f';
const read = name => JSON.parse(fs.readFileSync(path.resolve(root, name), 'utf8'));
const manifest = read('CLEANUP_MANIFEST.json');
const backup = read('BACKUP_STATUS.json');
const snapshotPath = manifest.private_snapshot;
const snapshot = read(snapshotPath);
const schemaPath = snapshotPath.replace('fixture-snapshot.json', 'schema-and-guards.json');
const schema = read(schemaPath);
assert.equal(manifest.project_ref, project);
assert.equal(manifest.campus.id, campus);
assert.equal(manifest.campus.code, 'MANGATTT');
const executed = manifest.status === 'EXECUTED_COMPLETE_VERIFIED';
assert.ok(executed || manifest.status === 'PREPARED_NOT_EXECUTED');
assert.equal(manifest.authorization.production_deletion_authorized, executed);
assert.equal(manifest.authorization.backup_verified, false);
assert.equal(backup.status, executed ? 'NOT_TAKEN_USER_WAIVED' : 'NOT_VERIFIED_NO_DELETION');
assert.equal(backup.local_fixture_snapshot.is_full_recoverable_database_backup, false);
const tableNames = schema.schema.physical_tables.filter(t => t.kind === 'r').map(t => t.name).sort();
assert.deepEqual(Object.keys(manifest.tables).sort(), tableNames);
let rowCount = 0;
for (const name of tableNames) {
  const entry = manifest.tables[name], saved = snapshot.tables[name];
  const pk = schema.schema.physical_tables.find(t => t.name === name).pk;
  assert.equal(entry.count, saved.rows.length, name);
  assert.equal(saved.count, saved.rows.length, name);
  assert.equal(entry.fingerprint, saved.fingerprint, name);
  const actualKeys = saved.rows.map(row => Object.fromEntries(pk.map(key => [key, row[key]])));
  assert.deepEqual(entry.primary_keys, actualKeys, name);
  assert.equal(new Set(actualKeys.map(key => JSON.stringify(key))).size, entry.count, name);
  assert.deepEqual(manifest.preserve.public_tables[name], snapshot.preserved[name], name);
  rowCount += entry.count;
}
assert.equal(rowCount, 921);
assert.equal(rowCount, manifest.public_row_count);
const students = snapshot.tables.students.rows;
const faculty = snapshot.tables.faculty.rows;
const departments = new Set(snapshot.tables.departments.rows.map(d => d.id));
assert.equal(departments.size, 8);
for (const row of [...students, ...faculty]) {
  assert.equal(row.campus_id, campus);
  if (row.department_id) assert.ok(departments.has(row.department_id));
}
const profiles = new Map([...students.map(row => [row.id, { ...row, role: 'student' }]), ...faculty.map(row => [row.id, row])]);
assert.equal(profiles.size, 151);
const authIds = new Set();
for (const account of snapshot.auth_accounts) {
  const profile = profiles.get(account.id);
  assert.ok(profile, 'Auth account must have an owned profile');
  assert.equal(account.app_metadata.campus_id, campus);
  assert.equal(account.app_metadata.role, profile.role);
  assert.equal(account.app_metadata.department_id ?? null, profile.department_id ?? null);
  assert.ok(account.email.endsWith('.mangattt.20261018@example.test'));
  assert.ok(!('encrypted_password' in account));
  authIds.add(account.id);
}
assert.equal(authIds.size, 151);
assert.equal(manifest.auth.count, 151);
assert.deepEqual(manifest.auth.accounts.map(a => a.id).sort(), [...authIds].sort());
assert.equal(snapshot.tables.campuses.rows[0].id, campus);
assert.equal(snapshot.tables.campuses.rows[0].code, 'MANGATTT');
assert.ok(snapshot.tables.courses.rows.every(c => departments.has(c.department_id) && c.course_code.endsWith('TT')));
const selectedCourses = new Set(snapshot.tables.courses.rows.map(c => c.id));
for (const shared of manifest.preserve.shared_courses) assert.ok(!selectedCourses.has(shared.id));
assert.ok(!selectedCourses.has('998462b9-bfb7-470e-bed1-319c1fe182de'));
for (const references of Object.values(manifest.boundary_checks)) assert.equal(references.length, 0);
assert.equal(snapshot.tables.time_slots.count, 0);
assert.equal(snapshot.preserved.time_slots.count, 30);
assert.equal(snapshot.non_test_auth.count, 258);
const published = snapshot.tables.timetable_entries.rows.filter(r => r.status === 'published' && r.semester === 4);
assert.equal(published.length, 110);
if (executed) {
  const final = read('CLEANUP_VERIFICATION.json'), authReport = read('AUTH_DELETION_REPORT.json');
  assert.equal(final.status, 'COMPLETE_VERIFIED');
  for (const field of ['remaining_test_campus','remaining_test_auth_ids','remaining_test_auth_markers','remaining_test_auth_sessions','remaining_test_refresh_tokens','remaining_test_identities','remaining_test_mfa']) assert.equal(final[field], 0, field);
  assert.deepEqual(final.public_tables, snapshot.preserved);
  assert.deepEqual(final.preserved_auth, snapshot.non_test_auth);
  assert.equal(final.published_guard.enabled, 'O');
  assert.equal(final.public_rows_deleted, 921);
  assert.equal(final.auth_users_deleted, 151);
  assert.equal(authReport.status, 'COMPLETE_VERIFIED');
  assert.equal(authReport.expected_removed_auth_users, 151);
  assert.equal(authReport.remaining_reviewed_auth_users, 0);
  assert.equal(manifest.authorization.backup_requirement_waived_by_user, true);
}
const files = [
  ...fs.readdirSync(root).filter(f => f !== 'CHECKSUMS.json' && fs.statSync(path.join(root, f)).isFile()),
  snapshotPath, schemaPath,
].sort();
const checksum = file => createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex');
const hashes = Object.fromEntries(files.map(file => [file, checksum(file)]));
if (process.argv.includes('--seal')) {
  fs.writeFileSync(path.join(root, 'CHECKSUMS.json'), JSON.stringify({ algorithm: 'SHA-256', sealed_at: new Date().toISOString(), files: hashes }, null, 2) + '\n');
} else {
  assert.deepEqual(read('CHECKSUMS.json').files, hashes, 'Package changed after sealing');
}
console.log(JSON.stringify({
  status: executed ? 'CLEANUP_COMPLETE_AND_EVIDENCE_VERIFIED' : 'PACKAGE_VERIFIED_CLEANUP_BLOCKED_PENDING_BACKUP_AND_APPROVAL',
  public_rows: rowCount, auth_accounts: authIds.size, preserved_auth_accounts: snapshot.non_test_auth.count,
  published_s4_periods: published.length, checksummed_files: files.length,
  production_changes: executed,
}, null, 2));
