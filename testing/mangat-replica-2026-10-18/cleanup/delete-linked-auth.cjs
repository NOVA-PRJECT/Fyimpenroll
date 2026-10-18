#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const CAMPUS = 'b72074e2-468e-4218-afb6-0f08f14cfe8f';
const PROJECT = 'lhnjlwtdphugjaluzrsp';
const URL = 'https://' + PROJECT + '.supabase.co';
const check = (value, message) => { if (!value) throw new Error(message); };
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function fingerprint(users) {
  return createHash('sha256').update(JSON.stringify(users.map(u => ({ id: u.id, email: u.email, app_metadata: u.app_metadata }))
    .sort((a, b) => a.id.localeCompare(b.id)).map(stable))).digest('hex');
}
async function listUsers(client) {
  const users = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    check(!error && Array.isArray(data?.users), 'Unable to read Auth inventory.');
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  throw new Error('Auth inventory pagination exceeded its safety bound.');
}
async function run({ client, manifest, authorization, apply = false, state = {}, persist = async () => {}, log = () => {} }) {
  check(manifest.project_ref === PROJECT && manifest.campus.id === CAMPUS && manifest.campus.code === 'MANGATTT', 'Wrong cleanup project/campus.');
  check(authorization.status === 'AUTHORIZED_FOR_EXECUTION_WITHOUT_FULL_BACKUP' && authorization.campus_id === CAMPUS &&
    authorization.project_ref === PROJECT && authorization.auth_users === 151, 'Missing explicit cleanup authorization.');
  const targets = manifest.auth.accounts;
  check(targets.length === 151 && new Set(targets.map(t => t.id)).size === 151, 'Expected exactly 151 reviewed Auth IDs.');
  check(targets.every(t => t.campus_id === CAMPUS && t.email.endsWith('.mangattt.20261018@example.test')), 'Unowned Auth target.');
  for (const table of ['campuses', 'students', 'faculty', 'departments']) {
    const field = table === 'campuses' ? 'id' : 'campus_id';
    const { data, error } = await client.from(table).select('id').eq(field, CAMPUS).limit(1);
    check(!error && Array.isArray(data) && data.length === 0, 'Public cleanup has not completed: ' + table);
  }
  for (let start = 0; start < targets.length; start += 50) {
    const ids = targets.slice(start, start + 50).map(t => t.id);
    for (const table of ['students', 'faculty', 'admins']) {
      const { data, error } = await client.from(table).select('id').in('id', ids).limit(1);
      check(!error && Array.isArray(data) && data.length === 0, 'A target still has a portal profile.');
    }
  }
  const all = await listUsers(client), ids = new Set(targets.map(t => t.id)), byId = new Map(all.map(u => [u.id, u]));
  const others = all.filter(u => !ids.has(u.id));
  check(others.length === manifest.preserve.auth.count, 'Non-test Auth count changed; review before proceeding.');
  for (const target of targets) {
    const user = byId.get(target.id);
    if (!user) continue; // Resumable after an uncertain, already-committed deletion.
    check(user.email === target.email && user.app_metadata?.campus_id === CAMPUS &&
      user.app_metadata?.role === target.role &&
      (user.app_metadata?.department_id ?? null) === (target.department_id ?? null), 'Auth ownership changed; no further deletions allowed.');
  }
  const preservedHash = fingerprint(others);
  if (state.preserved_auth_sha256) check(state.preserved_auth_sha256 === preservedHash, 'Preserved Auth changed since the checkpoint.');
  if (!apply) return { status: 'READ_ONLY_CHECK_PASSED', pending: targets.filter(t => byId.has(t.id)).length, preserved_auth_users: others.length };
  state = { ...state, status: 'RUNNING', project_ref: PROJECT, campus_id: CAMPUS, expected_auth_users: 151,
    preserved_auth_count: others.length, preserved_auth_sha256: preservedHash, deleted_ids: state.deleted_ids || [] };
  await persist(state);
  const pending = targets.filter(t => byId.has(t.id));
  for (let offset = 0; offset < pending.length; offset += 3) {
    const batch = pending.slice(offset, offset + 3);
    const results = await Promise.allSettled(batch.map(async target => {
      const { error } = await client.auth.admin.deleteUser(target.id, false);
      check(!error, 'Auth deletion failed for a reviewed ID.');
      return target.id;
    }));
    const failed = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (!state.deleted_ids.includes(result.value)) state.deleted_ids.push(result.value);
      } else failed.push(batch[index].id);
    });
    state.updated_at = new Date().toISOString();
    state.failed_ids = failed;
    state.status = failed.length ? 'PARTIAL_FAILURE' : 'RUNNING';
    await persist(state);
    if (failed.length) throw new Error('Some reviewed Auth deletions failed. Checkpoint saved; do not broaden the scope.');
    if ((offset + batch.length) % 15 === 0 || offset + batch.length === pending.length) log('Deleted ' + (offset + batch.length) + '/' + pending.length + ' pending test Auth users.');
  }
  const after = await listUsers(client);
  check(after.every(u => !ids.has(u.id)), 'Reviewed Auth users remain.');
  const kept = after.filter(u => !ids.has(u.id));
  check(kept.length === others.length && fingerprint(kept) === preservedHash, 'Non-test Auth metadata changed during cleanup; investigate.');
  state.status = 'COMPLETE_VERIFIED';
  state.completed_at = new Date().toISOString();
  state.remaining_reviewed_auth_users = 0;
  state.preserved_auth_verified = true;
  await persist(state);
  return { status: state.status, expected_removed_auth_users: 151, deleted_this_run: pending.length,
    remaining_reviewed_auth_users: 0, preserved_auth_users: kept.length, preserved_auth_metadata_unchanged: true };
}
async function main() {
  const argv = process.argv.slice(2);
  check(argv.length === 1 && ['--check', '--apply'].includes(argv[0]), 'Use --check or --apply.');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'CLEANUP_MANIFEST.json'), 'utf8'));
  const authorization = JSON.parse(fs.readFileSync(path.join(__dirname, 'EXECUTION_AUTHORIZATION.json'), 'utf8'));
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  check(url === URL && key, 'Expected project server credentials are not configured.');
  const client = require('@supabase/supabase-js').createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
  });
  const checkpoint = path.resolve(__dirname, '../../../scratch/mangat-replica-2026-10-18/cleanup/auth-deletion-state.json');
  const state = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, 'utf8')) : {};
  const persist = async next => {
    fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
    fs.writeFileSync(checkpoint + '.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { await fs.promises.rename(checkpoint + '.tmp', checkpoint); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  };
  const report = await run({ client, manifest, authorization, apply: argv[0] === '--apply', state, persist, log: console.log });
  console.log(JSON.stringify(report, null, 2));
  if (argv[0] === '--apply') fs.writeFileSync(path.join(__dirname, 'AUTH_DELETION_REPORT.json'), JSON.stringify(report, null, 2) + '\n');
}
module.exports = { run };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

