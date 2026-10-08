import { z } from 'zod';

export const CopyPracticalSchema = z.object({
  source_slot_id: z.string().uuid('Invalid source slot ID'),
  target_slot_id: z.string().uuid('Invalid target slot ID'),
  attendance_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'attendance_date must be in YYYY-MM-DD format'),
  overwrite: z.boolean().default(false),
});

export type CopyPracticalDto = z.infer<typeof CopyPracticalSchema>;
