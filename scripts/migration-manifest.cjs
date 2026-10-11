const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
const text = '# Migration inventory\n\nGenerated from the actual directory by `node scripts/migration-manifest.cjs`.\n\n' +
  'This is an ordered inventory, not permission to replay destructive historical migrations. Existing deployments apply only unapplied files after schema/backup review. Fresh staging must first establish the base tables and Supabase auth schema; the repository does not contain a certified empty-database bootstrap. See RELEASE_RUNBOOK.md.\n\n' +
  files.map((f, i) => `${i + 1}. \`supabase/migrations/${f}\``).join('\n') + '\n'
fs.writeFileSync(path.join(root, 'implementation-handoffs/followup/MIGRATIONS.md'), text)
console.log(`Recorded ${files.length} actual migration filenames.`)
