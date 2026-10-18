const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./delete-linked-auth.cjs');
const template = require('./CLEANUP_MANIFEST.json');
const authorization = require('./EXECUTION_AUTHORIZATION.json');
function fixture() {
  const manifest = structuredClone(template);
  const users = manifest.auth.accounts.map(t => ({ id: t.id, email: t.email, app_metadata: { role: t.role, campus_id: t.campus_id, department_id: t.department_id } }));
  for (let i = 0; i < 258; i++) users.push({ id: 'protected-' + i, email: 'real-' + i + '@example.invalid', app_metadata: { role: 'student', campus_id: 'real-campus' } });
  const calls = [], state = {}, profiles = [];
  const client = {
    from(table) { const query = { select() { return this; }, eq() { return this; }, in() { return this; }, async limit() { return { data: profiles.filter(p => p.table === table), error: null }; } }; return query; },
    auth: { admin: {
      async listUsers() { return { data: { users: structuredClone(users) }, error: null }; },
      async deleteUser(id) { calls.push(id); const index = users.findIndex(u => u.id === id); assert.ok(index >= 0); users.splice(index, 1); return { error: null }; },
    } },
  };
  const options = { client, manifest, authorization, state, persist: async s => Object.assign(state, structuredClone(s)) };
  return { options, users, calls, state, profiles };
}
test('read-only check never deletes accounts', async () => {
  const f = fixture(), result = await run(f.options);
  assert.equal(result.pending, 151); assert.equal(f.calls.length, 0);
});
test('removes only reviewed users and verifies all protected users', async () => {
  const f = fixture(), result = await run({ ...f.options, apply: true });
  assert.equal(result.remaining_reviewed_auth_users, 0); assert.equal(f.calls.length, 151);
  assert.ok(f.calls.every(id => template.auth.accounts.some(t => t.id === id)));
  assert.equal(f.users.length, 258); assert.equal(f.state.status, 'COMPLETE_VERIFIED');
});
test('a changed campus on any target prevents every deletion', async () => {
  const f = fixture(); f.users[70].app_metadata.campus_id = 'real-campus';
  await assert.rejects(run({ ...f.options, apply: true }), /ownership changed/);
  assert.equal(f.calls.length, 0);
});
test('remaining public profiles prevent Auth deletion', async () => {
  const f = fixture(); f.profiles.push({ table: 'faculty', id: template.auth.accounts[0].id });
  await assert.rejects(run({ ...f.options, apply: true }), /Public cleanup has not completed/);
  assert.equal(f.calls.length, 0);
});
test('partial failure is checkpointed and can resume only reviewed IDs', async () => {
  const f = fixture(); const original = f.options.client.auth.admin.deleteUser; let failed = false;
  f.options.client.auth.admin.deleteUser = async id => { if (!failed) { failed = true; return { error: { status: 500 } }; } return original(id); };
  await assert.rejects(run({ ...f.options, apply: true }), /checkpoint saved/i);
  assert.equal(f.state.status, 'PARTIAL_FAILURE'); assert.equal(f.state.deleted_ids.length, 2);
  const result = await run({ ...f.options, apply: true });
  assert.equal(result.status, 'COMPLETE_VERIFIED'); assert.equal(f.users.length, 258);
});
test('missing users are safe to resume without deleting substitutes', async () => {
  const f = fixture(); f.users.splice(0, 3);
  const result = await run({ ...f.options, apply: true });
  assert.equal(result.deleted_this_run, 148); assert.equal(f.users.length, 258);
});

