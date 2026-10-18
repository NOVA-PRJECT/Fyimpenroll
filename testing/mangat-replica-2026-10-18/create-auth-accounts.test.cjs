'use strict';

// Tests use an in-memory Admin/Data API double. No network or production keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPlan, readEnvironment, provision, writeCheckpoint, main, SEED_ID, PROJECT_URL, INITIAL_PASSWORD } = require('./create-auth-accounts.cjs');

function fixture() {
  const plan = loadPlan();
  const db = { campuses: [structuredClone(plan.campus)], departments: structuredClone(plan.departments), faculty: [] };
  const users = [];
  const writes = [];
  const calls = [];
  const failures = {};
  const client = {
    from(table) {
      assert.ok(['campuses', 'departments', 'faculty'].includes(table), `Unexpected table: ${table}`);
      const filters = [];
      let single = false;
      let inserted;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        maybeSingle() { single = true; return query; },
        insert(value) { assert.equal(table, 'faculty'); inserted = structuredClone(value); return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            calls.push({ table, insert: Boolean(inserted) });
            if (inserted) {
              writes.push({ table, row: inserted });
              if (failures.profile) { failures.profile = false; return { data: null, error: { code: '23503', message: 'secret-must-not-appear' } }; }
              assert.ok(!db.faculty.some(p => p.id === inserted.id || p.email === inserted.email));
              db.faculty.push(inserted);
              if (failures.profileAfterCommit) { failures.profileAfterCommit = false; throw new Error('secret-must-not-appear'); }
              return { data: null, error: null };
            }
            const rows = db[table].filter(row => filters.every(filter => filter(row)));
            return { data: structuredClone(single ? rows[0] || null : rows), error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
    auth: { admin: {
      async listUsers({ page, perPage }) {
        calls.push({ auth: 'listUsers', page });
        return { data: { users: structuredClone(users.slice((page - 1) * perPage, page * perPage)) }, error: null };
      },
      async createUser(payload) {
        writes.push({ auth: 'createUser', payload: structuredClone(payload) });
        assert.ok(!users.some(u => u.email === payload.email));
        const metadata = Object.fromEntries(Object.entries(payload.app_metadata).filter(([, value]) => value !== null));
        const user = { id: `auth-${users.length + 1}`, email: payload.email, email_confirmed_at: '2026-10-18T00:00:00Z', app_metadata: structuredClone(metadata) };
        users.push(user);
        if (failures.authAfterCommit) { failures.authAfterCommit = false; throw new Error('secret-must-not-appear'); }
        return { data: { user: structuredClone(user) }, error: null };
      },
      async getUserById(id) {
        calls.push({ auth: 'getUserById', id });
        return { data: { user: structuredClone(users.find(u => u.id === id)) }, error: null };
      },
      // No updateUserById/deleteUser/signIn methods: using any would fail a test.
    } },
  };
  const checkpoints = [];
  const run = (options = {}) => provision({ client, plan, apply: true, checkpoint: state => checkpoints.push(state), ...options });
  return { plan, db, users, writes, calls, failures, client, checkpoints, run };
}

test('default offline preview requires no secret and never initializes a client', async () => {
  const result = await main({ argv: [], env: {}, log: () => {}, clientFactory: () => assert.fail('Unexpected network client') });
  assert.equal(result.live_requests, 0);
  assert.equal(result.writes_attempted, false);
  assert.equal(result.planned_accounts.length, 10);
  assert.equal(result.planned_accounts.filter(a => a.role === 'hod').length, 8);
  assert.ok(!result.planned_accounts.some(a => ['student', 'teacher'].includes(a.role)));
});

test('live modes require the correct project and a server key without echoing values', async () => {
  assert.throws(() => readEnvironment({}), /Set SUPABASE_URL/);
  assert.throws(() => readEnvironment({ SUPABASE_URL: 'https://elsewhere.test', SUPABASE_SECRET_KEY: 'sb_secret_DO_NOT_PRINT' }), error => !error.message.includes('DO_NOT_PRINT') && /approved replica project/.test(error.message));
  assert.throws(() => readEnvironment({ SUPABASE_URL: PROJECT_URL, SUPABASE_SECRET_KEY: 'sb_publishable_DO_NOT_PRINT' }), /server secret/);
  assert.equal(readEnvironment({ SUPABASE_URL: PROJECT_URL, SUPABASE_SECRET_KEY: 'sb_secret_fake' }).secret, 'sb_secret_fake');
  const legacy = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  assert.equal(readEnvironment({ SUPABASE_URL: PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY: legacy }).secret, legacy);
  await assert.rejects(main({ argv: ['--aply'], env: {}, log: () => {} }), /Use one of/);
});

test('--check passes the environment key only to the server client and writes no output files', async () => {
  const f = fixture();
  const secret = 'sb_secret_ONLY_FOR_CLIENT';
  const logs = [];
  const result = await main({
    argv: ['--check'], env: { SUPABASE_URL: PROJECT_URL, SUPABASE_SECRET_KEY: secret },
    log: value => logs.push(value),
    clientFactory: (url, key, options) => {
      assert.equal(url, PROJECT_URL);
      assert.equal(key, secret);
      assert.equal(options.auth.persistSession, false);
      assert.equal(options.auth.autoRefreshToken, false);
      return f.client;
    },
  });
  assert.equal(result.status, 'PREFLIGHT_PASSED');
  assert.equal(f.writes.length, 0);
  assert.ok(!logs.join('').includes(secret));
});

test('a missing campus or a department belonging to production blocks every write', async () => {
  for (const change of [f => { f.db.campuses = []; }, f => { f.db.departments[7].campus_id = 'real-campus'; }]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.run(), /campus|departments/);
    assert.equal(f.writes.length, 0);
    assert.equal(f.checkpoints.length, 0);
  }
});

test('read-only preflight checks all ten accounts and performs no mutations', async () => {
  const f = fixture();
  const result = await f.run({ apply: false });
  assert.equal(result.auth_to_create, 10);
  assert.equal(result.profiles_to_create, 10);
  assert.equal(f.writes.length, 0);
  assert.equal(f.checkpoints.length, 0);
});

test('a late-page foreign Auth email or existing faculty conflict stops the entire batch', async () => {
  const f = fixture();
  for (let index = 0; index < 205; index++) f.users.push({ id: `real-${index}`, email: `real-${index}@example.test` });
  f.users.push({ id: 'foreign-account', email: f.plan.accounts[9].email, app_metadata: { role: 'hod', campus_id: 'real-campus' } });
  await assert.rejects(f.run(), /outside this exact seed plan/);
  assert.equal(f.calls.filter(c => c.auth === 'listUsers').length, 2);
  assert.equal(f.writes.length, 0);
  const g = fixture();
  g.db.faculty.push({ ...g.plan.accounts[9], id: 'existing-profile' });
  await assert.rejects(g.run(), /without a matching seeded Auth/);
  assert.equal(g.writes.length, 0);
});

test('creates ten confirmed Auth users with correct claims and matching faculty; rerun is write-free', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 'CREATED_VERIFIED');
  assert.equal(result.auth_created_this_run, 10);
  assert.equal(f.db.faculty.length, 10);
  for (const write of f.writes.filter(w => w.auth)) {
    const account = f.plan.accounts.find(a => a.email === write.payload.email);
    assert.equal(write.payload.password, INITIAL_PASSWORD);
    assert.equal(write.payload.email_confirm, true);
    assert.deepEqual(write.payload.app_metadata, {
      role: account.role, campus_id: account.campus_id, department_id: account.department_id,
      test_seed_id: SEED_ID, test_plan_sha256: f.plan.hash,
    });
    assert.ok(!Object.hasOwn(write.payload.user_metadata, 'role'));
  }
  const priorWrites = f.writes.length;
  const second = await f.run();
  assert.equal(second.auth_created_this_run, 0);
  assert.equal(f.writes.length, priorWrites);
  assert.equal(f.checkpoints.at(-1).accounts.filter(a => a.stage === 'VERIFIED').length, 10);
});

test('omitted null department claims are accepted for campus staff but missing HOD assignment blocks a rerun', async () => {
  const f = fixture();
  await f.run();
  assert.ok(!Object.hasOwn(f.users[0].app_metadata, 'department_id'));
  assert.ok(!Object.hasOwn(f.users[1].app_metadata, 'department_id'));
  delete f.users[2].app_metadata.department_id;
  const priorWrites = f.writes.length;
  await assert.rejects(f.run(), /outside this exact seed plan/);
  assert.equal(f.writes.length, priorWrites);
});

test('a faculty failure records the Auth ID, sanitizes the error, then resumes without password resets', async () => {
  const f = fixture();
  f.failures.profile = true;
  await assert.rejects(f.run(), error => /23503/.test(error.message) && !error.message.includes('secret-must-not-appear'));
  assert.equal(f.users.length, 1);
  assert.equal(f.db.faculty.length, 0);
  assert.equal(f.checkpoints.at(-1).status, 'PARTIAL_OR_UNCERTAIN');
  assert.equal(f.checkpoints.at(-1).accounts[0].auth_user_id, f.users[0].id);
  await f.run();
  assert.equal(f.users.length, 10);
  assert.equal(f.writes.filter(w => w.auth === 'createUser').length, 10);
});

test('lost responses after Auth or faculty commit recover using the server seed marker', async () => {
  for (const failure of ['authAfterCommit', 'profileAfterCommit']) {
    const f = fixture();
    f.failures[failure] = true;
    await assert.rejects(f.run(), /network\/SDK error/);
    assert.equal(f.checkpoints.at(-1).status, 'PARTIAL_OR_UNCERTAIN');
    await f.run();
    assert.equal(f.users.length, 10);
    assert.equal(f.db.faculty.length, 10);
    assert.equal(f.writes.filter(w => w.auth === 'createUser').length, 10);
  }
});

test('a seeded profile moved outside the test campus is rejected without repairs', async () => {
  const f = fixture();
  await f.run();
  f.db.faculty[9].campus_id = 'real-campus';
  const before = f.writes.length;
  await assert.rejects(f.run(), /profile does not match/);
  assert.equal(f.writes.length, before);
});

test('unwritable checkpoints prevent first Auth mutation', async () => {
  const f = fixture();
  await assert.rejects(f.run({ checkpoint: () => { throw new Error('Disk unavailable'); } }), /Disk unavailable/);
  assert.equal(f.writes.length, 0);
});

test('manifest and credential files show real per-account stages, without service keys', async () => {
  const f = fixture();
  const tempRoot = path.resolve(__dirname, '../../scratch/auth-script-tests');
  fs.mkdirSync(tempRoot, { recursive: true });
  const folder = fs.mkdtempSync(path.join(tempRoot, 'mangat-auth-test-'));
  try {
    await f.run({ checkpoint: state => writeCheckpoint(folder, state, f.plan) });
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'auth-creation-state.json'), 'utf8'));
    const credentials = JSON.parse(fs.readFileSync(path.join(folder, 'credentials.json'), 'utf8'));
    assert.equal(manifest.status, 'CREATED_VERIFIED');
    assert.ok(!JSON.stringify(manifest).includes(INITIAL_PASSWORD));
    assert.equal(credentials.accounts.length, 10);
    assert.ok(credentials.accounts.every(a => a.stage === 'VERIFIED' && a.password === INITIAL_PASSWORD));
    assert.match(fs.readFileSync(path.join(folder, 'AUTH_CREDENTIALS.md'), 'utf8'), /CREATED_VERIFIED/);
    // A report for another campus must never be replaced by a subsequent run.
    credentials.campus.id = 'another-campus';
    fs.writeFileSync(path.join(folder, 'credentials.json'), JSON.stringify(credentials));
    await assert.rejects(writeCheckpoint(folder, manifest, f.plan), /another account plan/);
  } finally {
    // Verify the exact mkdtemp target stays under this test's workspace directory.
    assert.ok(path.resolve(folder).startsWith(tempRoot + path.sep));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
