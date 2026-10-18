#!/usr/bin/env node
'use strict';

// Node-only Admin API script. No keys are embedded or written to the output files.
// Default: offline preview. --check: read-only live checks. --apply: create accounts.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const SEED_ID = 'mangat-replica-2026-10-18';
const PROJECT_URL = 'https://lhnjlwtdphugjaluzrsp.supabase.co';
const CAMPUS_ID = 'b72074e2-468e-4218-afb6-0f08f14cfe8f';
const DEPARTMENT_CODES = ['ECOTT', 'EVSTT', 'ITTT', 'MATTT', 'PESTT', 'SBSTT', 'STATT', 'SWTTT'];
const INITIAL_PASSWORD = 'Password123!'; // Explicitly requested test-account password.
const PROFILE_FIELDS = 'id,full_name,email,role,campus_id,department_id';
const PRIVATE_FOLDER = path.resolve(__dirname, '../../scratch', SEED_ID);

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPlan(folder = __dirname) {
  const read = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
  const preview = read('replica-preview.json');
  const accountPlan = read('accounts-plan.json');
  const { campus, departments } = preview;
  ensure(campus.id === CAMPUS_ID && campus.code === 'MANGATTT' && campus.name === 'Test KUC Mangattuparamba TT', 'Unexpected campus: this script is restricted to the planned test campus.');
  ensure(departments.length === 8 && new Set(departments.map(d => d.id)).size === 8, 'Expected eight distinct test departments.');
  ensure(JSON.stringify(departments.map(d => d.code).sort()) === JSON.stringify(DEPARTMENT_CODES), 'Unexpected test department codes.');
  ensure(departments.every(d => d.campus_id === campus.id && d.name.startsWith('Test ') && d.name.endsWith(' TT')), 'Every department must belong to the test campus.');
  ensure(accountPlan.student_creation === 'EXCLUDED_USER_BULK_UPLOAD_ONLY' && accountPlan.teacher_creation === 'EXCLUDED_DEFERRED_BY_USER', 'Students and teachers must remain excluded.');
  const accounts = accountPlan.accounts.map(a => Object.fromEntries(['full_name', 'email', 'role', 'campus_id', 'department_id'].map(k => [k, a[k]])));
  const expected = [
    { role: 'campus_director', email: 'director.mangattt.20261018@example.test', department_id: null },
    { role: 'teaching_staff', email: 'teaching-staff.mangattt.20261018@example.test', department_id: null },
    ...departments.map(d => ({ role: 'hod', email: `hod.${d.code.toLowerCase()}.mangattt.20261018@example.test`, department_id: d.id })),
  ];
  ensure(accounts.length === 10 && new Set(accounts.map(a => a.email)).size === 10, 'Expected exactly ten unique staff accounts.');
  for (const target of expected) {
    const account = accounts.find(a => a.email === target.email);
    ensure(account && account.role === target.role && account.department_id === target.department_id && account.campus_id === campus.id && account.full_name?.startsWith('TT '), `Invalid or missing planned staff account: ${target.email}`);
  }
  const plan = { campus, departments, accounts, source_snapshot_sha256: preview.source_snapshot_sha256 };
  plan.hash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  return plan;
}

function readEnvironment(env = process.env) {
  const url = env.SUPABASE_URL?.trim();
  const secret = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  ensure(url && secret, 'Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the server environment.');
  ensure(url === PROJECT_URL || url === `${PROJECT_URL}/`, 'SUPABASE_URL does not match the approved replica project.');
  let serviceRole = false;
  try { serviceRole = JSON.parse(Buffer.from(secret.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch { /* Modern secret keys are not JWTs. */ }
  ensure(secret.startsWith('sb_secret_') || serviceRole, 'Use a server secret/service-role key, not a publishable or anon key.');
  return { url: PROJECT_URL, secret };
}

// Do not print raw SDK/network errors: they may contain request details or credentials.
async function request(operation, action) {
  let result;
  try { result = await action(); } catch { throw new Error(`${operation} failed (network/SDK error).`); }
  if (result.error) {
    const code = String(result.error.code || result.error.status || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    throw new Error(`${operation} failed (code ${code}).`);
  }
  return result.data;
}

function assertAuth(user, account, plan) {
  const metadata = user.app_metadata || {};
  // Auth removes null metadata keys. Missing department means no assignment only
  // for the campus-wide roles; a HOD must still have the exact planned UUID.
  ensure(user.email?.toLowerCase() === account.email && metadata.role === account.role && metadata.campus_id === account.campus_id && (metadata.department_id ?? null) === account.department_id && metadata.test_seed_id === SEED_ID && metadata.test_plan_sha256 === plan.hash, `Existing Auth account is outside this exact seed plan: ${account.email}. No account will be adopted or overwritten.`);
  ensure(user.email_confirmed_at, `Email is not confirmed for ${account.email}. Review this account manually.`);
}

function assertProfile(profile, account, authId) {
  ensure(profile.id === authId && ['full_name', 'email', 'role', 'campus_id', 'department_id'].every(k => profile[k] === account[k]), `Faculty profile does not match the planned test account: ${account.email}. No profile will be overwritten.`);
}

async function preflight(client, plan) {
  const campus = await request('Read test campus', () => client.from('campuses').select('id,code,name').eq('id', plan.campus.id).maybeSingle());
  ensure(campus && ['id', 'code', 'name'].every(k => campus[k] === plan.campus[k]), 'The planned MANGATTT campus does not exist or does not match. Create the approved academic replica first; no Auth writes have started.');
  const departments = await request('Read test departments', () => client.from('departments').select('id,code,name,campus_id').in('id', plan.departments.map(d => d.id)));
  ensure(departments.length === 8 && plan.departments.every(expected => departments.some(actual => ['id', 'code', 'name', 'campus_id'].every(k => actual[k] === expected[k]))), 'The eight planned test departments must exist under MANGATTT before creating Auth accounts.');

  const emails = new Set(plan.accounts.map(a => a.email));
  const authByEmail = new Map();
  let finished = false;
  for (let page = 1; page <= 1000; page++) {
    const data = await request('List Auth users', () => client.auth.admin.listUsers({ page, perPage: 200 }));
    for (const user of data.users) {
      const email = user.email?.toLowerCase();
      if (emails.has(email)) {
        ensure(!authByEmail.has(email), `Duplicate Auth listing for ${email}; stop and review pagination.`);
        authByEmail.set(email, user);
      }
    }
    if (data.users.length < 200) { finished = true; break; }
  }
  ensure(finished, 'Auth pagination exceeded its limit; no writes have started.');
  const authIds = [...authByEmail.values()].map(u => u.id);
  const profileSets = await Promise.all([
    request('Read campus staff', () => client.from('faculty').select(PROFILE_FIELDS).eq('campus_id', plan.campus.id)),
    request('Check planned staff emails', () => client.from('faculty').select(PROFILE_FIELDS).in('email', [...emails])),
    authIds.length ? request('Check existing Auth profile ownership', () => client.from('faculty').select(PROFILE_FIELDS).in('id', authIds)) : Promise.resolve([]),
  ]);
  const profiles = [...new Map(profileSets.flat().map(p => [p.id, p])).values()];
  for (const profile of profileSets[0]) {
    if (profile.role === 'teaching_staff' || profile.role === 'campus_director' || profile.role === 'hod') {
      ensure(plan.accounts.some(a => a.email === profile.email && a.role === profile.role && a.department_id === profile.department_id), `Another ${profile.role} already occupies this test campus/department. Review before creating more staff.`);
    }
  }
  return plan.accounts.map(account => {
    const user = authByEmail.get(account.email);
    const matching = profiles.filter(p => p.email?.toLowerCase() === account.email || (user && p.id === user.id));
    ensure(matching.length <= 1, `Conflicting faculty profiles for ${account.email}.`);
    if (user) assertAuth(user, account, plan);
    if (matching.length) {
      ensure(user, `A faculty email already exists without a matching seeded Auth account: ${account.email}.`);
      assertProfile(matching[0], account, user.id);
    }
    return { account, user, profile: matching[0] };
  });
}

async function provision({ client, plan, apply = false, checkpoint = () => {}, log = () => {} }) {
  // All ownership and collision checks complete before the first mutation.
  const entries = await preflight(client, plan);
  if (!apply) return { status: 'PREFLIGHT_PASSED', accounts: entries.length, auth_to_create: entries.filter(e => !e.user).length, profiles_to_create: entries.filter(e => !e.profile).length, writes_attempted: false };
  const state = {
    seed_id: SEED_ID, plan_sha256: plan.hash, campus: { id: plan.campus.id, code: plan.campus.code, name: plan.campus.name },
    status: 'APPLYING', started_at: new Date().toISOString(), writes_attempted: false,
    accounts: entries.map(e => ({ ...e.account, auth_user_id: e.user?.id || null, stage: e.profile ? 'EXISTING_PAIR' : e.user ? 'AUTH_CREATED_PROFILE_PENDING' : 'PENDING' })),
  };
  const save = async () => { state.updated_at = new Date().toISOString(); await checkpoint(structuredClone(state)); };
  let created = 0;
  try {
    await save(); // Ensure a local manifest can be written before changing live data.
    for (let index = 0; index < entries.length; index++) {
      const { account, profile } = entries[index];
      let { user } = entries[index];
      const record = state.accounts[index];
      if (!user) {
        record.stage = 'AUTH_CREATE_PENDING';
        state.writes_attempted = true;
        await save();
        const data = await request(`Create Auth for ${account.email}`, () => client.auth.admin.createUser({
          email: account.email, password: INITIAL_PASSWORD, email_confirm: true,
          app_metadata: { role: account.role, campus_id: account.campus_id, department_id: account.department_id, test_seed_id: SEED_ID, test_plan_sha256: plan.hash },
          user_metadata: { full_name: account.full_name }, // Display only; never used for authorization.
        }));
        ensure(data?.user?.id, `Auth creation returned no user for ${account.email}. Rerun to inspect a potentially committed request.`);
        user = data.user;
        record.auth_user_id = user.id;
        record.stage = 'AUTH_CREATED_PROFILE_PENDING';
        created++;
        await save();
        assertAuth(user, account, plan);
      }
      if (!profile) {
        record.stage = 'FACULTY_INSERT_PENDING';
        state.writes_attempted = true;
        await save();
        await request(`Insert faculty for ${account.email}`, () => client.from('faculty').insert({ id: user.id, ...account }));
      }
      const [authData, savedProfile] = await Promise.all([
        request(`Verify Auth for ${account.email}`, () => client.auth.admin.getUserById(user.id)),
        request(`Verify faculty for ${account.email}`, () => client.from('faculty').select(PROFILE_FIELDS).eq('id', user.id).maybeSingle()),
      ]);
      ensure(authData?.user && savedProfile, `Auth/profile verification failed for ${account.email}.`);
      assertAuth(authData.user, account, plan);
      assertProfile(savedProfile, account, user.id);
      record.stage = 'VERIFIED';
      await save();
      log(`Verified ${account.role}: ${account.email}`);
    }
    state.status = 'CREATED_VERIFIED';
    state.auth_created_this_run = created;
    await save();
    return { status: state.status, verified_accounts: 10, auth_created_this_run: created, existing_auth_accounts: 10 - created, manifest: path.join(PRIVATE_FOLDER, 'auth-creation-state.json') };
  } catch (error) {
    // Auth and faculty creation are separate requests. Preserve known IDs and resume
    // only accounts bearing this exact server-controlled seed marker. Never delete.
    state.status = 'PARTIAL_OR_UNCERTAIN';
    state.error = error.message;
    try { await save(); } catch { /* Preserve the earlier checkpoint if storage has failed. */ }
    throw error;
  }
}

async function writeCheckpoint(folder, state, plan) {
  fs.mkdirSync(folder, { recursive: true });
  const credentialPath = path.join(folder, 'credentials.json');
  let previous = {};
  if (fs.existsSync(credentialPath)) {
    previous = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    ensure(previous.campus?.id === plan.campus.id && previous.accounts?.length === 10 && previous.accounts.every(a => plan.accounts.some(p => p.email === a.email)), 'Private credential file belongs to another account plan; refusing to overwrite it.');
  }
  const atomicJson = async (name, value) => {
    const target = path.join(folder, name);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    // Windows may briefly lock a recently replaced file. Bound retries to 600ms;
    // a persistent filesystem error stops the run before the next live request.
    for (let attempt = 0; ; attempt++) {
      try { await fs.promises.rename(`${target}.tmp`, target); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  };
  await atomicJson('auth-creation-state.json', state);
  const credentials = {
    ...previous, status: state.status, updated_at: state.updated_at, campus: state.campus,
    source_snapshot_sha256: plan.source_snapshot_sha256, auth_write_attempted: state.writes_attempted,
    live_auth_writes_executed: state.accounts.some(a => a.auth_user_id),
    note: 'Initial passwords only. Existing seeded users are never reset. Students are created by user bulk upload; teachers are deferred. See auth-creation-state.json for verified IDs and partial/uncertain requests.',
    accounts: state.accounts.map(a => ({ ...a, password: INITIAL_PASSWORD })),
  };
  await atomicJson('credentials.json', credentials);
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const lines = [
    '# Test campus Auth credentials', '', `Status: **${state.status}**. Updated: ${state.updated_at}.`, '',
    'Only VERIFIED rows have passed both Auth and faculty checks. These are initial passwords; reruns do not reset passwords. A partial/uncertain request may have committed: rerun the same --apply command to resume.', '',
    '| Name | Role | Department | Email | Initial password | Status |', '|---|---|---|---|---|---|',
    ...credentials.accounts.map(a => `| ${[a.full_name, a.role, plan.departments.find(d => d.id === a.department_id)?.code || 'Campus-wide', a.email, a.password, a.stage].map(escape).join(' | ')} |`), '',
  ];
  fs.writeFileSync(path.join(folder, 'AUTH_CREDENTIALS.md'), lines.join('\n'), { mode: 0o600 });
}

async function main({ argv = process.argv.slice(2), env = process.env, log = console.log, clientFactory, privateFolder = PRIVATE_FOLDER } = {}) {
  ensure(argv.length <= 1 && (argv.length === 0 || ['--help', '--dry-run', '--check', '--apply'].includes(argv[0])), 'Use one of --dry-run, --check, --apply or --help.');
  const mode = argv[0] || '--dry-run';
  if (mode === '--help') {
    log('Usage: node [--env-file=backend/.env] testing/mangat-replica-2026-10-18/create-auth-accounts.cjs [--dry-run | --check | --apply]\nDefault --dry-run is offline. --check reads live prerequisites/collisions. Only --apply writes.\nEnvironment: SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.\nCreates 1 campus director, 8 HODs and 1 teaching-staff account, initially Password123!. Students and teachers excluded.\nThe planned test campus and its eight departments must already exist.');
    return;
  }
  const plan = loadPlan();
  if (mode === '--dry-run') {
    const result = { status: 'OFFLINE_DRY_RUN', campus: plan.campus.code, planned_accounts: plan.accounts, live_requests: 0, writes_attempted: false };
    log(JSON.stringify(result, null, 2));
    return result;
  }
  const { url, secret } = readEnvironment(env);
  const factory = clientFactory || require('@supabase/supabase-js').createClient;
  let client;
  try { client = factory(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }); }
  catch { throw new Error('Unable to initialize the server Supabase client. Check environment configuration.'); }
  const result = await provision({ client, plan, apply: mode === '--apply', checkpoint: state => writeCheckpoint(privateFolder, state, plan), log });
  log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    // All network errors are sanitized by request(); never dump an SDK error object.
    console.error(`Stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { loadPlan, readEnvironment, preflight, provision, writeCheckpoint, main, SEED_ID, PROJECT_URL, INITIAL_PASSWORD };
