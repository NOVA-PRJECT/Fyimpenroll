import { z } from 'zod';

export const SubmitAttendanceSchema = z.object({
  timetable_slot_id: z.string().uuid('Invalid timetable slot ID'),
  attendance_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'attendance_date must be in YYYY-MM-DD format')
    .optional(),
  absent_student_ids: z.array(z.string().uuid()).default([]),
  present_student_ids: z.array(z.string().uuid()).optional(),
  last_marked_at: z.string().optional(),
  client_timestamp: z.string().optional(),
  synced_late: z.boolean().optional(),
});

export type SubmitAttendanceDto = z.infer<typeof SubmitAttendanceSchema>;
