import { z } from 'zod';

export const ReassignTeacherSchema = z.object({
  teacher_id: z.string().uuid('Invalid teacher ID format'),
});

export type ReassignTeacherDto = z.infer<typeof ReassignTeacherSchema>;
