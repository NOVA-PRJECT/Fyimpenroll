const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Papa = require('papaparse')
const ExcelJS = require('exceljs')
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true })
const { CreditLedgerService } = require('../src/modules/credit-ledger/credit-ledger.service')
const { ExportService } = require('../src/modules/credit-ledger/export.service')

const student = { id: 'student', full_name: 'Test Student', department_id: 'department', campus_id: 'campus', departments: { name: 'Department' } }
const user = { userId: student.id, role: 'student', campus_id: student.campus_id }

function ledgerService() {
  const courses = Array.from({ length: 8 }, (_, index) => ({
    id: `course-${index + 1}`, course_code: `TEST${index + 1}`, title: `Course ${index + 1}`,
    credits: index < 6 ? 4 : 9, category: index < 6 ? 'DSC' : 'MDC',
    department_id: student.department_id, departments: student.departments,
  }))
  const registration = { id: 'registration', student_id: student.id, semester: 1, academic_year: '2026-27',
    ...Object.fromEntries(courses.map((course, index) => [`slot_${index + 1}_course_id`, course.id])),
    selections: [{ course_id: 'course-7', slot: 7, credits: 2, category: 'MDC' }, { course_id: 'course-8', slot: 8, credits: 3, category: 'MDC' }],
  }
  const tables = { students: [student], student_registrations: [registration], courses }
  const admin = { from(table) {
    let rows = tables[table]
    return {
      select() { return this }, order() { return this },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return this },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return this },
      single: async () => ({ data: rows[0], error: null }),
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject) },
    }
  } }
  return new CreditLedgerService({ admin })
}

test('all eight slots contribute to one total, using historical snapshot credits when available', async () => {
  const ledger = await ledgerService().getCreditLedger(student.id, user)
  assert.equal(ledger.registeredCourses.length, 8)
  assert.equal(ledger.totalRegisteredCredits, 29)
  assert.equal(ledger.totalCredits, 29)
  assert.equal(ledger.categories.find(item => item.category === 'MDC').registeredCredits, 5)
  assert.equal(ledger.byDepartment[0].earned, 29)
  assert.ok(!('coreCredits' in ledger))
  assert.ok(!('additionalCredits' in ledger))
  assert.ok(ledger.registeredCourses.every(course => !('isAdditional' in course)))
})

for (const format of ['json', 'csv', 'xlsx']) {
  test(`${format} ledger export includes all courses without level or credit-track fields`, async () => {
    const result = await new ExportService({}, ledgerService()).exportCreditLedger(student.id, user, format)
    let rows
    if (format === 'json') {
      rows = result.data
      assert.equal(result.metadata.totalRegisteredCredits, 29)
      assert.ok(!('coreCredits' in result.metadata))
      assert.ok(!('additionalCredits' in result.metadata))
    } else if (format === 'csv') {
      rows = Papa.parse(result.buffer.toString('utf8'), { header: true }).data
    } else {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(result.buffer)
      const sheet = workbook.worksheets[0]
      const headers = sheet.getRow(1).values.slice(1)
      rows = sheet.getRows(2, sheet.rowCount - 1).map(row => Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).value])))
    }
    assert.equal(rows.length, 8)
    assert.equal(rows.reduce((sum, row) => sum + Number(row['Registered Credits']), 0), 29)
    assert.ok(rows.every(row => !('Academic Level' in row) && !('Type' in row)))
  })
}
