const { z } = require('zod')

const Uuid = z.string().uuid()
const Revision = z.number().int().min(0).max(2147483647)
const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00.000Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')
const Password = z.string().min(8).max(256)
const UniqueIds = z.array(Uuid).max(10000).refine(ids => new Set(ids).size === ids.length, 'Duplicate student IDs are not allowed')
const ChangePasswordSchema = z.object({ current_password: z.string().min(1).max(256), new_password: Password,
  confirm_password: Password.optional() }).refine(value => value.confirm_password === undefined || value.confirm_password === value.new_password, 'Passwords do not match')
const RecoveryPasswordSchema = z.object({ newPassword: Password, token_hash: z.string().regex(/^[a-fA-F0-9]{64}$/) }).strict()
const SubmitAttendanceSchema = z.object({
  timetable_slot_id: Uuid, attendance_date: CalendarDate.optional(),
  absent_student_ids: UniqueIds.default([]), present_student_ids: UniqueIds.optional(),
  expected_revision: Revision, last_marked_at: z.string().datetime({ offset: true }).optional(),
  client_timestamp: z.string().datetime({ offset: true }).optional(), synced_late: z.boolean().optional(),
}).refine(body => !body.present_student_ids?.some(id => body.absent_student_ids.includes(id)), 'Present and absent lists overlap')
const CopyPracticalSchema = z.object({
  source_slot_id: Uuid, target_slot_id: Uuid, attendance_date: CalendarDate,
  expected_target_revision: Revision.optional(), expected_revision: Revision.optional(), overwrite: z.boolean().default(false),
}).refine(body => body.expected_target_revision !== undefined || body.expected_revision !== undefined, 'A target revision is required')
  .refine(body => body.expected_revision === undefined || body.expected_target_revision === undefined || body.expected_revision === body.expected_target_revision, 'Revision aliases disagree')
const AttendanceExportSchema = z.object({
  semesterId: z.string().regex(/^(?:[1-9]|10)$/).default('1').transform(Number), departmentId: Uuid.optional(),
})
const AcademicYear = z.string().regex(/^\d{4}-\d{2}$/).refine(value => (Number(value.slice(0, 4)) + 1) % 100 === Number(value.slice(5)), 'Academic year must contain consecutive years')
const CreditRangeSchema = z.object({ min_credits: z.number().int().min(0).max(100), max_credits: z.number().int().min(0).max(100) })
  .refine(value => value.min_credits <= value.max_credits, 'Minimum credits cannot exceed maximum credits')
const CohortRequestSchema = z.object({ academicYear: AcademicYear, semester: z.number().int().min(1).max(10) })
const SettingsUpdateSchema = z.object({ deadline: z.string().datetime({ offset: true }).nullable().optional(),
  min_credits: z.number().int().min(0).max(100).optional(), max_credits: z.number().int().min(0).max(100).optional(),
  academic_year: AcademicYear.optional() }).strict()
const RegistrationSubmitSchema = z.object({ semester: z.number().int().min(1).max(10), pathway_id: z.string().min(1).max(128),
  courses: z.array(Uuid).max(8).optional(), preferences: z.record(z.string().regex(/^slot_[1-8]$/),
    z.array(z.object({ course_id: Uuid, rank: z.number().int().min(1).max(3) })).max(3)
      .refine(choices => new Set(choices.map(c => c.course_id)).size === choices.length && new Set(choices.map(c => c.rank)).size === choices.length, 'Duplicate course or rank')).optional(),
}).strict()
const SlotUpdateSchema = z.object({ slot_key: z.string().regex(/^slot_[1-8]$/), course_id: Uuid }).strict()
const TeacherProvisioningSchema = z.object({ full_name: z.string().trim().min(1).max(100), email: z.string().email().max(254), password: Password })
const StudentProvisioningSchema = z.object({ full_name: z.string().trim().min(1).max(100), cap_application_number: z.string().trim().min(1).max(128),
  email: z.string().email().max(254), password: Password, current_semester: z.coerce.number().int().min(1).max(10), academic_year_joined: AcademicYear })
const FacultyProvisioningSchema = z.object({ full_name: z.string().trim().min(1).max(150), email: z.string().email().max(254), password: Password,
  role: z.enum(['hod','campus_director','teaching_staff','teacher']), campus_id: Uuid, department_id: Uuid.nullable().optional() })
  .refine(value => value.role !== 'teacher' || !!value.department_id, 'A teacher requires a home department')
const BlueprintUpdateSchema = z.object({ semester: z.coerce.number().int().min(1).max(10),
  min_credits: z.coerce.number().int().min(0).max(50), max_credits: z.coerce.number().int().min(0).max(50),
  pathways: z.array(z.object({ id: z.string().max(128).optional(), name: z.string().trim().min(1).max(200),
    slots: z.array(z.object({ rule: z.string().min(1).max(128), target: z.string().max(500).nullable().optional(),
      name: z.string().max(200).optional(), slot: z.number().int().min(1).max(8).optional() })).min(1).max(8),
  })).max(100).optional().default([]),
}).refine(value => value.min_credits <= value.max_credits, 'Minimum credits cannot exceed maximum credits')
module.exports = { Uuid, Revision, CalendarDate, Password, UniqueIds, ChangePasswordSchema, RecoveryPasswordSchema,
  SubmitAttendanceSchema, CopyPracticalSchema, AttendanceExportSchema, AcademicYear, CreditRangeSchema,
  CohortRequestSchema, SettingsUpdateSchema, RegistrationSubmitSchema, SlotUpdateSchema,
  TeacherProvisioningSchema, StudentProvisioningSchema, FacultyProvisioningSchema, BlueprintUpdateSchema }
