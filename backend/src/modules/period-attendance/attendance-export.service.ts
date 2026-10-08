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

function sanitizeSpreadsheetCell(value: any): any {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

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
    // 1. Scoping validation
    const deptId = requestedDeptId || user.department_id;
    if (!deptId) {
      throw new ForbiddenException('Department affiliation is required to export attendance statements');
    }

    if (user.role === 'hod' && user.department_id && user.department_id !== deptId) {
      throw new ForbiddenException('HOD can only export attendance statements for their own department');
    }

    // 2. Fetch Department Details
    const { data: department, error: deptError } = await this.supabase.admin
      .from('departments')
      .select('id, name, code')
      .eq('id', deptId)
      .single();

    if (deptError || !department) {
      throw new NotFoundException(`Department not found for id ${deptId}`);
    }

    // 3. Fetch courses offered by the department for that semester
    const { data: courses, error: coursesError } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title')
      .eq('department_id', deptId)
      .eq('semester', semester)
      .order('course_code', { ascending: true });

    if (coursesError) {
      throw new InternalServerErrorException(`Failed to fetch department courses: ${coursesError.message}`);
    }

    const courseList = courses || [];

    // 4. Fetch department students enrolled in that semester
    const { data: students, error: studentsError } = await this.supabase.admin
      .from('students')
      .select('id, full_name, cap_application_number, current_semester')
      .eq('department_id', deptId)
      .eq('current_semester', semester)
      .order('cap_application_number', { ascending: true });

    if (studentsError) {
      throw new InternalServerErrorException(`Failed to fetch department students: ${studentsError.message}`);
    }

    const studentList = students || [];

    // 5. Fetch student registrations to determine enrollment per course
    const studentIds = studentList.map((s) => s.id);
    const enrolledCourseSet = new Set<string>(); // key: `${studentId}_${courseId}`

    if (studentIds.length > 0) {
      let { data: registrations, error: regError } = await this.supabase.admin
        .from('student_registrations')
        .select(`
          student_id,
          slot_1_course_id,
          slot_2_course_id,
          slot_3_course_id,
          slot_4_course_id,
          slot_5_course_id,
          slot_6_course_id,
          slot_7_course_id,
          slot_8_course_id,
          selections
        `)
        .eq('semester', semester)
        .in('student_id', studentIds);

      if (regError && (regError.message?.includes('slot_7_course_id') || regError.message?.includes('slot_8_course_id'))) {
        const fallbackRes = await this.supabase.admin
          .from('student_registrations')
          .select(`
            student_id,
            slot_1_course_id,
            slot_2_course_id,
            slot_3_course_id,
            slot_4_course_id,
            slot_5_course_id,
            slot_6_course_id,
            selections
          `)
          .eq('semester', semester)
          .in('student_id', studentIds);
        registrations = fallbackRes.data as any;
        regError = fallbackRes.error;
      }

      if (regError) {
        throw new InternalServerErrorException(`Failed to fetch registrations: ${regError.message}`);
      }

      for (const reg of registrations || []) {
        const sId = reg.student_id;
        for (let i = 1; i <= 8; i++) {
          const cid = (reg as any)[`slot_${i}_course_id`];
          if (cid) {
            enrolledCourseSet.add(`${sId}_${cid}`);
          }
        }
        const rawSel = (reg as any).selections;
        const selected = (Array.isArray(rawSel) ? rawSel : Array.isArray(rawSel?.courses) ? rawSel.courses : []) as any[];
        for (const item of selected) {
          const cid = typeof item === 'string' ? item : item?.id || item?.course_id;
          if (cid) {
            enrolledCourseSet.add(`${sId}_${cid}`);
          }
        }
      }
    }

    // 6. Total periods conducted per course:
    // "count of distinct timetable slots for that course that have at least one submitted attendance record"
    const courseConductedMap = new Map<string, number>();
    const studentCoursePresentMap = new Map<string, number>(); // key: `${studentId}_${courseId}`

    if (courseList.length > 0) {
      const courseIds = courseList.map((c) => c.id);

      // Query period attendance for these courses
      const { data: attendanceRows, error: attError } = await this.supabase.admin
        .from('period_attendance')
        .select('timetable_slot_id, student_id, course_id, status, attendance_date')
        .in('course_id', courseIds);

      if (attError) {
        throw new InternalServerErrorException(`Failed to fetch period attendance records: ${attError.message}`);
      }

      // Compute distinct timetable sessions per course (slot + attendance_date)
      const courseSlotsMap = new Map<string, Set<string>>();
      for (const row of attendanceRows || []) {
        if (!courseSlotsMap.has(row.course_id)) {
          courseSlotsMap.set(row.course_id, new Set<string>());
        }
        const sessionKey = `${row.timetable_slot_id}_${row.attendance_date || ''}`;
        courseSlotsMap.get(row.course_id)!.add(sessionKey);

        if (row.status === 'present') {
          const key = `${row.student_id}_${row.course_id}`;
          studentCoursePresentMap.set(key, (studentCoursePresentMap.get(key) || 0) + 1);
        }
      }

      for (const [cId, slotsSet] of courseSlotsMap.entries()) {
        courseConductedMap.set(cId, slotsSet.size);
      }
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

    const headers = ['#', 'Reg No', 'Student Name', ...courseList.map((c) => c.course_code), 'Average APC'];
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

      const nonNaPercentages: number[] = [];
      const rowValues: any[] = [
        i + 1,
        sanitizeSpreadsheetCell(student.cap_application_number || '—'),
        sanitizeSpreadsheetCell(student.full_name),
      ];

      for (const course of courseList) {
        const isEnrolled = enrolledCourseSet.has(`${student.id}_${course.id}`);
        if (!isEnrolled) {
          rowValues.push('NA');
        } else {
          const totalConducted = courseConductedMap.get(course.id) || 0;
          const present = studentCoursePresentMap.get(`${student.id}_${course.id}`) || 0;
          const percentage = totalConducted > 0 ? Number(((present / totalConducted) * 100).toFixed(2)) : 100.0;
          rowValues.push(percentage);
          nonNaPercentages.push(percentage);
        }
      }

      // Calculate Average APC
      const averageApc =
        nonNaPercentages.length > 0
          ? Number((nonNaPercentages.reduce((a, b) => a + b, 0) / nonNaPercentages.length).toFixed(2))
          : 'NA';

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
