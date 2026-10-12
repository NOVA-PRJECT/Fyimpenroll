import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a valid 24-hour time');
export const CampusAttendanceSettingsSchema = z.object({
  center_latitude: z.number().finite().min(-90).max(90),
  center_longitude: z.number().finite().min(-180).max(180),
  radius_meters: z.number().finite().int().positive(),
  morning_cutoff_time: time,
  midday_split_time: time,
  evening_cutoff_time: time,
  day_end_time: time,
}).strict().refine(value => {
  const times = [value.morning_cutoff_time, value.midday_split_time, value.evening_cutoff_time, value.day_end_time].map(timeMinutes);
  return times[0] < times[1] && times[1] < times[2] && times[2] < times[3];
}, { message: 'Times must be ordered: morning cutoff, midday split, evening cutoff, day end' });

export function timeMinutes(value: string): number {
  const [hours, minutes, seconds = 0] = value.split(':').map(Number);
  return hours * 60 + minutes + seconds / 60;
}

export function attendanceSettings(campus: any) {
  return {
    center_latitude: campus?.center_latitude == null ? null : Number(campus.center_latitude),
    center_longitude: campus?.center_longitude == null ? null : Number(campus.center_longitude),
    radius_meters: campus?.radius_meters == null ? 400 : Number(campus.radius_meters),
    morning_cutoff_time: campus?.morning_cutoff_time ?? '09:30:00',
    midday_split_time: campus?.midday_split_time ?? '13:30:00',
    evening_cutoff_time: campus?.evening_cutoff_time ?? '15:30:00',
    day_end_time: campus?.day_end_time ?? '17:00:00',
  };
}

export function campusSetupError(campus: any): string | null {
  if (!campus) return 'No campus is linked to your account. Contact your administrator.';
  if (!CampusAttendanceSettingsSchema.safeParse(attendanceSettings(campus)).success) {
    return 'Campus location or attendance timings are not configured correctly. Contact your campus director.';
  }
  return null;
}
