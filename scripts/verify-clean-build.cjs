const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'fyimp-release-clean-'))
const excluded = new Set(['node_modules', '.next', 'dist', '.git', '.env', '.env.local', 'storage', '.turbo'])
for (const name of ['package.json', 'package-lock.json', 'frontend', 'backend', 'mobile', 'contracts', 'scripts']) {
  fs.cpSync(path.join(root, name), path.join(clean, name), { recursive: true, filter: source => {
    const base = path.basename(source)
    return !excluded.has(base) && !base.startsWith('.env') && !base.endsWith('.log') && !base.endsWith('.tsbuildinfo')
  } })
}
const env = { ...process.env }
delete env.NODE_PATH
// No secrets are copied into the clean checkout. Build-time public placeholders
// only; provider verification is a separate staging check.
env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'build-only-placeholder'
console.log('Clean workspace:', clean)
const commands = process.argv.includes('--deploy') ? [
  'npm ci --workspace=backend --include-workspace-root --include=dev',
  'npm run build:backend',
  'npm prune --omit=dev --workspace=backend --include-workspace-root',
  'node -e "require(\'./backend/dist/modules/timetable/timetable.service\'); require(\'@fyimp/contracts\'); if(require(\'node:fs\').existsSync(\'node_modules/expo\')) throw Error(\'Mobile toolchain included in backend artifact\')"',
  'node scripts/audit-runtime.cjs backend',
  'npm ci --workspace=frontend --include-workspace-root --include=dev',
  'npm run build:frontend',
  'npm prune --omit=dev --workspace=frontend --include-workspace-root',
  'node scripts/audit-runtime.cjs frontend',
] : ['npm ci', 'npm run build', 'npm run build --prefix frontend']
for (const command of commands) {
  const result = spawnSync(command, { cwd: clean, env, shell: true, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('Clean builds passed without NODE_PATH:', process.argv.includes('--deploy') ? 'selected deployment workspaces' : 'root and frontend project')
