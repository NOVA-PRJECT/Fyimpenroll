const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const ExcelJS = require('exceljs')
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true })
const { ExportService } = require('../src/modules/credit-ledger/export.service')

const user = { userId: 'hod', role: 'hod', campus_id: 'campus', department_id: 'dept' }
function harness() {
  const registration = (id, semester, campus = 'campus', department = 'dept', year = '2026-27') => ({
    id, semester, academic_year: year, slot_1_course_id: 'course',
    students: { campus_id: campus, department_id: department, full_name: id,
      cap_application_number: 'CAP001', departments: { name: department }, campuses: { name: campus } },
  })
  const tables = {
    campus_settings: [{ campus_id: 'campus', academic_year: '2026-27' }],
    student_registrations: [registration('one', 1), registration('two', 2),
      registration('other-campus', 1, 'outside'), registration('other-dept', 1, 'campus', 'outside'),
      registration('old', 1, 'campus', 'dept', '2025-26')],
    courses: [{ id: 'course', title: 'Example Paper', course_code: 'TEST', credits: 4 }],
    semester_blueprints: [],
  }
  const admin = { from(table) {
    let rows = tables[table], selection = '', from = 0, to = Infinity
    const q = {
      select(value) { selection = value; return q }, order() { return q },
      eq(key, value) { rows = rows.filter(row => key.split('.').reduce((v, k) => v?.[k], row) === value); return q },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return q },
      range(start, end) { from = start; to = end; return q },
      async execute() {
        // Match PostgREST's failure when two FKs link registrations to students.
        if (table === 'student_registrations' && /students!inner\(/.test(selection)) {
          return { data: null, error: { code: 'PGRST201', message: 'Ambiguous student relationship' } }
        }
        // Without an inner join, related-table filters cannot exclude parent rows.
        if (table === 'student_registrations') assert.match(selection, /students![^()]+!inner\(/)
        return { data: rows.slice(from, to + 1), error: null }
      },
      then(a, b) { return q.execute().then(a, b) },
      async single() { const result = await q.execute(); return { ...result, data: result.data?.[0] } },
    }
    return q
  } }
  return new ExportService({ admin }, {})
}

for (const semester of [1, undefined]) test(`HOD XLSX export resolves duplicate relationships and scopes semester ${semester ?? 'all'}`, async () => {
  const result = await harness().exportFinalRegistrations({ semester, format: 'xlsx' }, user)
  assert.match(result.contentType, /spreadsheetml/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(result.buffer)
  const sheet = workbook.worksheets[0], headers = sheet.getRow(1).values.slice(1)
  const names = sheet.getRows(2, sheet.rowCount - 1).map(row => row.getCell(headers.indexOf('Student Name') + 1).value)
  assert.deepEqual(names, semester ? ['one'] : ['one', 'two'])
  assert.equal(sheet.getCell(2, headers.indexOf('Paper 1') + 1).value, 'Example Paper (TEST)')
})

test('unresolved allocation export shares the repaired registration query', async () => {
  const result = await harness().exportUnresolvedAllocations({ semester: 1, format: 'json' }, user)
  assert.equal(result.count, 1)
  assert.equal(result.data[0]['Student Name'], 'one')
})

test('HOD export still rejects missing campus or department affiliation', async () => {
  for (const key of ['campus_id', 'department_id']) {
    await assert.rejects(harness().exportFinalRegistrations({ format: 'xlsx' }, { ...user, [key]: null }), /affiliation required/)
  }
})
