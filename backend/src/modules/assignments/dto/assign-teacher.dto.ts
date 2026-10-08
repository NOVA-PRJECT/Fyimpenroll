import { z } from 'zod';

export const AssignTeacherSchema = z.object({
  teacher_id: z.string().uuid('Invalid teacher ID format'),
  course_id: z.string().uuid('Invalid course ID format'),
  campus_id: z.string().uuid('Invalid campus ID format').optional(),
  academic_year: z.string().optional(),
  semester: z.number().int().min(1).max(10).optional(),
});

export type AssignTeacherDto = z.infer<typeof AssignTeacherSchema>;

export const BatchAssignTeacherSchema = z.object({
  assignments: z
    .array(
      z.object({
        teacher_id: z.string().uuid('Invalid teacher ID format'),
        course_id: z.string().uuid('Invalid course ID format'),
        campus_id: z.string().uuid('Invalid campus ID format').optional(),
        academic_year: z.string().optional(),
        semester: z.number().int().min(1).max(10).optional(),
      })
    )
    .min(1, 'At least one assignment is required'),
});

export interface BatchAssignmentItem {
  teacher_id: string;
  course_id: string;
  campus_id?: string;
  academic_year?: string;
  semester?: number;
}

export type BatchAssignTeacherDto = {
  assignments: BatchAssignmentItem[];
};

