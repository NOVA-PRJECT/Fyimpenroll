import ExcelJS from 'exceljs'
import { downloadBlob } from './downloadFile'

export interface StudentExcelRow {
  name: string
  sem: number
  paper_1?: string
  paper_2?: string
  paper_3?: string
  paper_4?: string
  paper_5?: string
  paper_6?: string
}

export async function downloadStudentsExcel(
  rows: StudentExcelRow[],
  semesterLabel: string = 'All_Semesters',
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FYIMP Academic Portal'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('Student Papers Roster')

  worksheet.columns = [
    { header: 'Sl. No.', key: 'sl', width: 10 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Sem', key: 'sem', width: 10 },
    { header: 'Paper 1', key: 'paper_1', width: 34 },
    { header: 'Paper 2', key: 'paper_2', width: 34 },
    { header: 'Paper 3', key: 'paper_3', width: 34 },
    { header: 'Paper 4', key: 'paper_4', width: 34 },
    { header: 'Paper 5', key: 'paper_5', width: 34 },
    { header: 'Paper 6', key: 'paper_6', width: 34 },
  ]

  // Style header row
  worksheet.getRow(1).font = { bold: true }

  rows.forEach((r, index) => {
    worksheet.addRow({
      sl: index + 1,
      name: r.name,
      sem: r.sem,
      paper_1: r.paper_1 || '-',
      paper_2: r.paper_2 || '-',
      paper_3: r.paper_3 || '-',
      paper_4: r.paper_4 || '-',
      paper_5: r.paper_5 || '-',
      paper_6: r.paper_6 || '-',
    })
  })

  const sanitizedSem = semesterLabel.replace(/\s+/g, '_')
  const dateStr = new Date().toISOString().slice(0, 10)
  const fileName = `Student_Papers_${sanitizedSem}_${dateStr}.xlsx`

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  await downloadBlob(blob, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}
