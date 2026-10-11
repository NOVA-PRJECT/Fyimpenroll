// Current regression entry point. The original bug reproductions described in
// REVIEW.md were baseline evidence; see FIXES.md for the remediation results.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const result = spawnSync(process.execPath, ['--test',
  'backend/test/production-auth-recovery.test.js',
  'backend/test/production-timetable-transactions.test.js',
  'backend/test/followup-host-campus-classes.test.js',
  'backend/test/credit-ledger-exports.test.js',
], { cwd: root, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status || 0
