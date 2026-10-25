import { z } from 'zod';

export const CourseSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  credits: z.number().optional().default(0),
  category: z.string().optional().default(''),
  faculty_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  prerequisites: z.string().nullable().optional(),
  prerequisite_points: z.array(z.string()).optional().default([]),
});

export const TimetableSlotSchema = z.object({
  id: z.string(),
  day_of_week: z.string().or(z.number()),
  start_time: z.string(),
  end_time: z.string(),
  period_index: z.number().optional(),
  course_code: z.string(),
  course_title: z.string(),
  room_number: z.string().nullable().optional(),
  faculty_name: z.string().nullable().optional(),
});

export const StudentDashboardSchema = z.object({
  todaySlots: z.array(TimetableSlotSchema),
  attendanceSummary: z
    .object({
      overallPercentage: z.number().nullable(),
      totalPresent: z.number(),
      totalClasses: z.number(),
      campusSignInStatus: z
        .object({
          morning: z.enum(['completed', 'pending', 'absent']),
          evening: z.enum(['completed', 'pending', 'absent']),
        }),
    }),
  latestAnnouncement: z
    .object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      created_at: z.string(),
    })
    .nullable(),
});

export type StudentDashboard = z.infer<typeof StudentDashboardSchema>;
export type TimetableSlot = z.infer<typeof TimetableSlotSchema>;
export type Course = z.infer<typeof CourseSchema>;
