import { z } from 'zod';

export const SubmitAttendanceSchema = z.object({
  timetable_slot_id: z.string().uuid('Invalid timetable slot ID'),
  absent_student_ids: z.array(z.string().uuid()).default([]),
  client_timestamp: z.string().optional(),
  synced_late: z.boolean().optional(),
});

export type SubmitAttendanceDto = z.infer<typeof SubmitAttendanceSchema>;
