import { z } from 'zod'
export const Uuid: z.ZodString
export const Revision: z.ZodNumber
export const CalendarDate: z.ZodType<string>
export const Password: z.ZodString
export const UniqueIds: z.ZodType<string[]>
export const ChangePasswordSchema: z.ZodType<{ current_password: string; new_password: string; confirm_password?: string }>
export const RecoveryPasswordSchema: z.ZodType<{ newPassword: string; token_hash: string }>
export const SubmitAttendanceSchema: z.ZodType<{
  timetable_slot_id: string; attendance_date?: string; absent_student_ids: string[]; present_student_ids?: string[];
  expected_revision: number; last_marked_at?: string; client_timestamp?: string; synced_late?: boolean;
}>
export const CopyPracticalSchema: z.ZodType<{
  source_slot_id: string; target_slot_id: string; attendance_date: string;
  expected_target_revision?: number; expected_revision?: number; overwrite: boolean;
}>
export const AttendanceExportSchema: z.ZodType<{ semesterId: number; departmentId?: string }>
export const AcademicYear: z.ZodType<string>
export const CreditRangeSchema: z.ZodType<{ min_credits: number; max_credits: number }>
export const CohortRequestSchema: z.ZodType<{ academicYear: string; semester: number }>
export const SettingsUpdateSchema: z.ZodType<{ deadline?: string | null; academic_year?: string; min_credits?: number; max_credits?: number }>
export const RegistrationSubmitSchema: z.ZodType<{ semester: number; pathway_id: string; courses?: string[]; preferences?: Record<string, { course_id: string; rank: number }[]> }>
export const SlotUpdateSchema: z.ZodType<{ slot_key: string; course_id: string }>
export const TeacherProvisioningSchema: z.ZodType<{ full_name: string; email: string; password: string }>
export const StudentProvisioningSchema: z.ZodType<{ full_name: string; cap_application_number: string; email: string; password: string; current_semester: number; academic_year_joined: string }>
export const FacultyProvisioningSchema: z.ZodType<{ full_name: string; email: string; password: string; role: 'hod' | 'campus_director' | 'teaching_staff' | 'teacher'; campus_id: string; department_id?: string | null }>
export type TeacherProvisioningInput = z.infer<typeof TeacherProvisioningSchema>
export type StudentProvisioningInput = z.infer<typeof StudentProvisioningSchema>
export type FacultyProvisioningInput = z.infer<typeof FacultyProvisioningSchema>
export const BlueprintUpdateSchema: z.ZodType<{ semester: number; min_credits: number; max_credits: number; pathways: {
  id?: string; name: string; slots: { rule: string; target?: string | null; name?: string; slot?: number }[]
}[] }>
export type BlueprintUpdateInput = z.infer<typeof BlueprintUpdateSchema>
