// Generates a private LOCAL draft of initial credentials. No network/Auth calls.
const fs = require('node:fs');
const path = require('node:path');
const folder = __dirname;
const root = path.resolve(folder, '../..');
const accountPlan = JSON.parse(fs.readFileSync(path.join(folder, 'accounts-plan.json'), 'utf8'));
const preview = JSON.parse(fs.readFileSync(path.join(folder, 'replica-preview.json'), 'utf8'));
const privateFolder = path.join(root, 'scratch', 'mangat-replica-2026-10-18');
const jsonPath = path.join(privateFolder, 'credentials.json');
const markdownPath = path.join(privateFolder, 'AUTH_CREDENTIALS.md');
const passwordPolicy = JSON.parse(fs.readFileSync(path.join(privateFolder, 'password-policy.json'), 'utf8'));
if (passwordPolicy.mode !== 'shared_initial_password' || typeof passwordPolicy.initial_password !== 'string' || passwordPolicy.initial_password.length < 8) throw new Error('Expected the locally configured user-requested initial password.');
const accounts = accountPlan.accounts;
if (accounts.length !== 10 || new Set(accounts.map(account => account.email)).size !== 10 || accounts.some(account => account.campus_id !== preview.campus.id || !['campus_director', 'hod', 'teaching_staff'].includes(account.role)) || preview.student_creation?.mode !== 'USER_BULK_UPLOAD_ONLY' || preview.teacher_creation?.mode !== 'DEFERRED_BY_USER') throw new Error('Expected ten director/HOD/teaching-staff accounts; students and teachers are excluded.');
fs.mkdirSync(privateFolder, { recursive: true });
let credentials;
if (fs.existsSync(jsonPath)) {
  credentials = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const expected = accounts.map(account => account.email).sort();
  if (credentials.campus.id !== preview.campus.id) throw new Error('Existing credentials belong to another campus; do not overwrite them.');
  if (credentials.status !== 'DRAFT_NOT_CREATED' || credentials.live_auth_writes_executed) throw new Error('This local draft generator must not change credentials for created accounts.');
  const plannedEmails = new Set(expected);
  const excluded = credentials.accounts.filter(account => !plannedEmails.has(account.email));
  if (excluded.some(account => !['student', 'teacher'].includes(account.role))) throw new Error('Unexpected account removal outside the student/teacher exclusions; do not alter this draft.');
  credentials.accounts = credentials.accounts.filter(account => plannedEmails.has(account.email));
  const actual = credentials.accounts.map(account => account.email).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Existing staff credentials differ from the account plan.');
} else {
  credentials = {
    status: 'DRAFT_NOT_CREATED',
    generated_at: new Date().toISOString(),
    live_auth_writes_executed: false,
    campus: { id: preview.campus.id, code: preview.campus.code, name: preview.campus.name },
    source_snapshot_sha256: preview.source_snapshot_sha256,
    note: 'Director/HOD/teaching-staff draft. Students will be created through user bulk upload and teachers are deferred. No accounts have been created by this workflow.',
    accounts: accounts.map(account => ({ ...account, password: passwordPolicy.initial_password })),
  };
}
if (credentials.status !== 'DRAFT_NOT_CREATED' || credentials.live_auth_writes_executed) throw new Error('This local draft generator must not change credentials for created accounts.');
credentials.accounts = credentials.accounts.map(account => ({ ...account, password: passwordPolicy.initial_password }));
credentials.note = 'Director/HOD/teaching-staff draft with the user-requested shared initial password. Students are excluded for user bulk upload and teachers are deferred. No accounts have been created by this workflow.';
credentials.student_creation = 'EXCLUDED_USER_BULK_UPLOAD_ONLY';
credentials.teacher_creation = 'EXCLUDED_DEFERRED_BY_USER';
credentials.password_policy = passwordPolicy.mode;
credentials.updated_at = new Date().toISOString();
fs.writeFileSync(jsonPath, JSON.stringify(credentials, null, 2) + '\n');
const departmentName = id => preview.departments.find(department => department.id === id)?.code || 'Campus-wide';
const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const lines = [
  '# Draft Auth credentials — Test KUC Mangattuparamba TT', '',
  '**DRAFT — ACCOUNTS NOT CREATED BY THIS WORKFLOW.** These email/password pairs are prepared locally for the proposed test setup. They will become usable only after account creation is explicitly approved and completed.', '',
  `Campus: ${preview.campus.name} (${preview.campus.code}).`,
  `Generated: ${credentials.generated_at}. Total: ${credentials.accounts.length} planned logins: one director, eight HODs and one teaching-staff account. Students are excluded for user bulk upload; teachers are deferred.`, '',
  `All planned staff accounts use the user-requested initial password: \`${passwordPolicy.initial_password}\`. There is no new superadmin account; the existing superadmin is outside this plan.`, '',
];
for (const [heading, role] of [['Campus director', 'campus_director'], ['Teaching staff', 'teaching_staff'], ['HODs', 'hod']]) {
  lines.push(`## ${heading}`, '', '| Name | Department | Login email | Initial password |', '|---|---|---|---|');
  for (const account of credentials.accounts.filter(account => account.role === role)) lines.push(`| ${[account.full_name, departmentName(account.department_id), account.email, account.password].map(escape).join(' | ')} |`);
  lines.push('');
}
fs.writeFileSync(markdownPath, lines.join('\n'));
console.log(JSON.stringify({ status: credentials.status, account_count: credentials.accounts.length, all_accounts_use_requested_initial_password: credentials.accounts.every(account => account.password === passwordPolicy.initial_password), live_auth_writes_executed: credentials.live_auth_writes_executed, markdown_file: path.relative(root, markdownPath), machine_readable_file: path.relative(root, jsonPath) }, null, 2));
