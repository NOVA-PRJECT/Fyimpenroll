import { z } from 'zod';

export const TeacherScheduleSchema = z.object({ periods: z.array(z.object({
  timetable_slot_id: z.string(), course_code: z.string(), course_title: z.string(),
  period_number: z.number(), start_time: z.string(), end_time: z.string(), is_marked: z.boolean(),
})) });

const session = z.object({ status: z.enum(['on_time', 'late', 'early_leave', 'absent', 'pending']) });
export const CampusRosterSchema = z.object({
  roster: z.array(z.object({
    id: z.string(), full_name: z.string(), cap_application_number: z.string(), current_semester: z.number(),
    morning: session, evening: session,
  })),
});

// Pending checkpoints have not closed and must not be counted as absences.
export function summarizeCampusRoster(response: unknown) {
  const { roster } = CampusRosterSchema.parse(response);
  let verified = 0, assessed = 0;
  for (const student of roster) {
    for (const checkpoint of [student.morning, student.evening]) {
      if (checkpoint.status !== 'pending') assessed++;
      if (checkpoint.status !== 'pending' && checkpoint.status !== 'absent') verified++;
    }
  }
  const flaggedStudents = roster.filter(student => student.morning.status === 'absent' || student.evening.status === 'absent');
  return { totalStudents: roster.length, absentCount: flaggedStudents.length, flaggedStudents,
    attendanceRate: assessed ? Math.round(verified / assessed * 100) : null };
}
