import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuthUser } from '../../core/auth/types';
import { fetchAllPaginated, fetchByIdChunks } from '../../core/database/pagination.util';
import { registrationSlots } from '../credit-ledger/enrollment-reporting';
import { sanitizeSpreadsheetValue } from '../credit-ledger/export.service';

@Injectable()
export class AttendanceExportService {
  private readonly logger = new Logger(AttendanceExportService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Generates a styled XLSX Attendance Statement (APC) for a department and semester.
   * Scoped to HOD's department.
   */
  async generateAttendanceStatement(
    user: AuthUser,
    semester: number,
    requestedDeptId?: string
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!['hod','campus_director','superadmin'].includes(user.role)) throw new ForbiddenException('Role cannot export department statements');
    const deptId = requestedDeptId || user.department_id;
    if (!deptId || (user.role === 'hod' && deptId !== user.department_id)) throw new ForbiddenException('Department outside scope');
    const { data: department, error: deptError } = await this.supabase.admin.from('departments').select('id, name, code, campus_id').eq('id', deptId).single();
    if (deptError || !department) throw new NotFoundException('Department not found');
    if (user.role !== 'superadmin' && (!user.campus_id || department.campus_id !== user.campus_id)) throw new ForbiddenException('Campus outside scope');
    const { data: settings, error: settingsError } = await this.supabase.admin.from('campus_settings').select('academic_year').eq('campus_id', department.campus_id).single();
    if (settingsError || !settings?.academic_year) throw new InternalServerErrorException('Active academic year unavailable');
    const studentList = await fetchAllPaginated<any>(this.supabase.admin.from('students')
      .select('id, full_name, cap_application_number, current_semester').eq('department_id',deptId)
      .eq('campus_id',department.campus_id).eq('current_semester',semester).order('id'));
    const studentIds = studentList.map(s => s.id);
    const registrations = studentIds.length ? await fetchByIdChunks<any>(studentIds, chunk => this.supabase.admin.from('student_registrations')
      .select('*').eq('semester',semester).eq('academic_year',settings.academic_year).in('student_id',chunk).order('id')) : [];
    const enrolledCourseSet = new Set<string>();
    const ids = new Set<string>();
    for (const reg of registrations) for (const slot of registrationSlots(reg)) {
      enrolledCourseSet.add(reg.student_id + '_' + slot.courseId); ids.add(slot.courseId!);
    }
    const courseList = await fetchByIdChunks<any>([...ids], chunk => this.supabase.admin.from('courses').select('id, course_code, title').in('id',chunk).order('id'));
    const courseConductedMap = new Map<string, number>();
    const studentCoursePresentMap = new Map<string, number>();
    // Denominator = this student's explicitly marked published dated periods.
    // Unmarked/cancelled periods and pre-enrollment periods are not fabricated absences.
    const counts = await fetchByIdChunks<any>(studentIds, ids => this.supabase.admin.rpc('attendance_student_course_counts', {
      p_student_ids: ids, p_campus_id: department.campus_id, p_academic_year: settings.academic_year, p_semester: semester,
    }).order('student_id').order('course_id'));
    for (const row of counts) {
      const key = row.student_id + '_' + row.course_id;
      if (!enrolledCourseSet.has(key)) continue;
      courseConductedMap.set(key, Number(row.conducted));
      studentCoursePresentMap.set(key, Number(row.present));
    }

    // 7. Build XLSX using exceljs
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FYIMP Portal';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(`Sem ${semester} APC Statement`, {
      views: [{ showGridLines: true }],
    });

    const totalCols = 4 + courseList.length;
    // Helper to get Excel column letter (up to ZZ)
    const getColLetter = (n: number) => {
      let s = '';
      while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - m) / 26);
      }
      return s;
    };
    const lastColLetter = getColLetter(totalCols);

    // A. Title Rows
    worksheet.mergeCells(`A1:${lastColLetter}1`);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `${department.name.toUpperCase()} — ATTENDANCE STATEMENT (APC)`;
    titleCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FF002147' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 28;

    worksheet.mergeCells(`A2:${lastColLetter}2`);
    const subCell = worksheet.getCell('A2');
    const generatedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    subCell.value = `Semester: ${semester}  |  Department Code: ${department.code}  |  Generated On: ${generatedDate}`;
    subCell.font = { name: 'Arial', size: 9.5, italic: true, color: { argb: 'FF64748B' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(2).height = 18;

    // Blank row 3
    worksheet.getRow(3).height = 8;

    // B. Header Row (Row 4)
    const headerRow = worksheet.getRow(4);
    headerRow.height = 28;

    const headers = ['#', 'Reg No', 'Student Name', ...courseList.map((c) => c.course_code), 'Overall marked-period %'];
    headerRow.values = headers;

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }, // Navy blue
      };
      cell.font = {
        name: 'Arial',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });

    // C. Data Rows (Row 5 onwards)
    let rowIndex = 5;
    for (let i = 0; i < studentList.length; i++) {
      const student = studentList[i];
      const row = worksheet.getRow(rowIndex);
      row.height = 22;

      let totalPeriods = 0;
      let presentPeriods = 0;
      const rowValues: any[] = [
        i + 1,
        sanitizeSpreadsheetValue(student.cap_application_number || '—'),
        sanitizeSpreadsheetValue(student.full_name),
      ];

      for (const course of courseList) {
        const isEnrolled = enrolledCourseSet.has(`${student.id}_${course.id}`);
        if (!isEnrolled) {
          rowValues.push('NA');
        } else {
          const totalConducted = courseConductedMap.get(`${student.id}_${course.id}`) || 0;
          const present = studentCoursePresentMap.get(`${student.id}_${course.id}`) || 0;
          const percentage = totalConducted > 0 ? Number(((present / totalConducted) * 100).toFixed(2)) : 'NA';
          rowValues.push(percentage);
          totalPeriods += totalConducted;
          presentPeriods += present;
        }
      }

      // Calculate Average APC
      const averageApc = totalPeriods > 0 ? Number((100 * presentPeriods / totalPeriods).toFixed(2)) : 'NA';
      rowValues.push(averageApc);
      row.values = rowValues;

      // Apply cell styling & conditional below-60% red highlight
      row.eachCell((cell, colNumber) => {
        // Border
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        // Alignments & Fonts
        if (colNumber === 1) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.font = { name: 'Arial', size: 9, color: { argb: 'FF64748B' } };
        } else if (colNumber === 2) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
          cell.font = { name: 'Courier New', size: 9, bold: true, color: { argb: 'FF334155' } };
        } else if (colNumber === 3) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
          cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
        } else {
          // Course columns & Average APC
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          const val = cell.value;

          if (val === 'NA') {
            cell.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
          } else if (typeof val === 'number') {
            cell.numFmt = '0.00';
            if (val < 60) {
              // Red Fill & bold dark-red text per regulation requirement
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFC7CE' }, // Soft red fill
              };
              cell.font = {
                name: 'Arial',
                size: 9.5,
                bold: true,
                color: { argb: 'FF9C0006' }, // Dark red text
              };
            } else {
              cell.font = { name: 'Arial', size: 9, color: { argb: 'FF1E293B' } };
            }
          }
        }

        // Highlight Average APC column bold
        if (colNumber === rowValues.length) {
          if (typeof cell.value === 'number') {
            cell.font = {
              name: 'Arial',
              size: 10,
              bold: true,
              color: cell.value < 60 ? { argb: 'FF9C0006' } : { argb: 'FF1E3A8A' },
            };
          }
        }
      });

      rowIndex++;
    }

    worksheet.getCell('A' + (rowIndex + 1)).value = 'Denominator: explicitly marked published periods in ' + settings.academic_year + '. Unmarked periods excluded; NA means no data. Optional-paper and cancellation policy pending.';
    // Auto-fit column widths
    worksheet.getColumn(1).width = 6; // #
    worksheet.getColumn(2).width = 18; // Reg No
    worksheet.getColumn(3).width = 28; // Name

    for (let c = 0; c < courseList.length; c++) {
      worksheet.getColumn(4 + c).width = 14;
    }
    worksheet.getColumn(4 + courseList.length).width = 16; // Average APC

    // Generate buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const deptCode = department.code || department.name || 'DEPT';
    const sanitizedDept = deptCode.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Attendance_Statement_${sanitizedDept}_Sem_${semester}.xlsx`;

    return { buffer, filename };
  }
}
