const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/app/dashboard/hod/page.tsx'), 'utf8')
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleExportExcel') handler = node.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
function harness(activeTab, response) {
  const errors = { students: 'old error', defaulters: 'old error' }, pending = [], downloads = [], urls = []
  const context = { activeTab, studentSemester: 2, defaulterSemester: 'all', deptData: { academic_year: '2026-27' },
    setStudentError: value => { errors.students = value }, setDefaulterError: value => { errors.defaulters = value },
    setExportingExcel: value => pending.push(value), URLSearchParams, Error,
    fetch: async url => { urls.push(url); if (response instanceof Error) throw response; return response },
    downloadBlob: async (blob, filename) => downloads.push({ blob, filename }),
  }
  const code = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, context)
  return { ...context, errors, pending, downloads, urls }
}

for (const tab of ['students', 'defaulters']) {
  test(`${tab}: exports chosen semester and clears previous error`, async () => {
    const h = harness(tab, { ok: true, blob: async () => 'workbook' })
    await h.handleExportExcel()
    const url = new URL(h.urls[0], 'http://localhost')
    assert.equal(url.searchParams.get('format'), 'xlsx')
    assert.equal(url.searchParams.get('academic_year'), '2026-27')
    assert.equal(url.searchParams.get('semester'), tab === 'students' ? '2' : null)
    assert.equal(h.errors[tab], '')
    assert.equal(h.downloads[0].filename, `Registrations_${tab === 'students' ? 2 : 'all'}.xlsx`)
    assert.deepEqual(h.pending, [true, false])
  })
  test(`${tab}: displays backend and network errors in the requesting tab`, async () => {
    for (const response of [{ ok: false, json: async () => ({ message: 'Please retry shortly.' }) }, new Error('Network unavailable')]) {
      const h = harness(tab, response)
      await h.handleExportExcel()
      assert.equal(h.errors[tab], response instanceof Error ? response.message : 'Please retry shortly.')
      assert.equal(h.downloads.length, 0)
      assert.deepEqual(h.pending, [true, false])
    }
  })
}

test('non-JSON export failures produce a useful error', async () => {
  const h = harness('defaulters', { ok: false, json: async () => { throw new Error('Not JSON') } })
  await h.handleExportExcel(3)
  assert.equal(h.errors.defaulters, 'Failed to export Excel file')
})
