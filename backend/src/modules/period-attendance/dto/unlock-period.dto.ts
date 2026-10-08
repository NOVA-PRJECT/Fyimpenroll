import { z } from 'zod';

export const UnlockPeriodSchema = z.object({
  timetable_slot_id: z.string().uuid('Invalid timetable slot ID'),
  reason: z.string().min(3, 'A justification reason is required for unlocking period marking'),
});

export type UnlockPeriodDto = z.infer<typeof UnlockPeriodSchema>;
