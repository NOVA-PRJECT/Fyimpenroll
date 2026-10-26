import { z } from 'zod';

const CampusSessionSchema = z.object({
  state: z.enum(['completed', 'pending', 'absent']),
  status: z.enum(['on_time', 'late', 'early_leave']).nullable(),
  signed_in_at: z.string().nullable(),
});
export const CampusSignInStatusSchema = z.object({
  date: z.string(), current_time_ist: z.string(),
  active_session: z.enum(['morning', 'evening', 'closed']),
  can_sign_in: z.boolean(), unavailable_reason: z.string().nullable(),
  campus: z.object({
    id: z.string().nullable(), name: z.string().nullable(), radius_meters: z.number(),
    morning_cutoff: z.string(), midday_split: z.string(), evening_cutoff: z.string(), day_end: z.string(),
  }),
  morning: CampusSessionSchema, evening: CampusSessionSchema,
});

export const CourseAttendanceItemSchema = z.object({
  course_id: z.string(),
  course_code: z.string(),
  course_title: z.string(),
  attended_classes: z.number(),
  total_classes: z.number(),
  percentage: z.number().nullable(),
});

export const StudentAttendanceListSchema = z.object({
  cleared: z.boolean().optional(),
  message: z.string().optional(),
  overall_percentage: z.number().nullable(),
  courses: z.array(CourseAttendanceItemSchema),
});

export type CampusSignInStatus = z.infer<typeof CampusSignInStatusSchema>;
export type StudentAttendanceList = z.infer<typeof StudentAttendanceListSchema>;
