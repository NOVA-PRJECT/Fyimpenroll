import { z } from 'zod';

export const RuleKindSchema = z.enum([
  'NO_STUDENT_OVERLAP',
  'NO_TEACHER_OVERLAP',
  'TEACHER_RESERVATIONS',
  'NO_LUNCH_OVERLAP',
  'EXACT_CONTACT_HOURS',
  'LAB_CONSECUTIVE_PAIR',
  'P6_LAST_RESORT',
  'THEORY_SPREAD',
  'DEPARTMENT_TIME_PREFERENCE',
  'DAY_WINDOW',
  'CATEGORY_WINDOW',
  'SESSION_BLOCK',
  'PARALLEL_CATEGORY_SYNC',
  'CAMPUS_TIME_LIMIT',
]);

export const RuleScopeSchema = z.enum(['global', 'campus', 'semester', 'category', 'course', 'department']);

export const RuleDefinitionSchema = z.object({
  id: z.string().min(1),
  kind: RuleKindSchema,
  scope: RuleScopeSchema,
  targetSemester: z.number().int().min(1).max(10).optional(),
  targetCategory: z.string().optional(),
  targetCourseId: z.string().optional(),
  targetDepartmentId: z.string().optional(),
  isHard: z.boolean(),
  weight: z.number().min(0).max(1000).optional(),
  parameters: z.object({
    courseCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(100).optional(),
    days: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional(),
    periods: z.array(z.number().int().min(1).max(6)).min(1).max(6).optional(),
    allowed_days: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional(),
    allowed_periods: z.array(z.number().int().min(1).max(6)).min(1).max(6).optional(),
  }).passthrough().optional(),
  version: z.number().int().min(1).default(1),
  description: z.string().min(1).max(500),
});

export const DynamicConstraintSchema = z.object({
  id: z.string(),
  text: z.string().min(5, 'Constraint must be at least 5 characters').max(500, 'Constraint cannot exceed 500 characters'),
  category: z.enum(['hard', 'soft']).optional(),
  typedRule: RuleDefinitionSchema.optional(),
});

export const GenerateRequestSchema = z.object({
  academicYear: z.string().min(1, 'Academic year is required'),
  semester: z.number().int().min(1).max(10),
  dynamicConstraints: z.array(DynamicConstraintSchema).default([]),
  rules: z.array(RuleDefinitionSchema).min(1).max(100).optional(),
});

export const PublishRequestSchema = z.object({
  academicYear: z.string().min(1, 'Academic year is required'),
  semester: z.number().int().min(1).max(10),
  force: z.boolean().optional().default(false),
});

export const ValidateRequestSchema = z.object({
  academicYear: z.string().min(1, 'Academic year is required'),
  semester: z.number().int().min(1).max(10),
});

export const TimetableQuerySchema = z.object({
  academicYear: z.string().min(1, 'Academic year is required'),
  semester: z.coerce.number().int().min(1).max(10),
  departmentId: z.string().uuid().optional().or(z.literal('')),
});

export const JobStatusQuerySchema = z.object({
  academicYear: z.string().min(1, 'Academic year is required'),
  semester: z.coerce.number().int().min(1).max(10),
});

export type RuleDefinitionDto = z.infer<typeof RuleDefinitionSchema>;
export type DynamicConstraintItem = z.infer<typeof DynamicConstraintSchema>;
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export type ValidateRequest = z.infer<typeof ValidateRequestSchema>;

// Teacher identity is deliberately absent: manual scheduling cannot change HOD assignments.
export const ManualEntrySchema = z.object({
  courseId: z.string().uuid(),
  day: z.number().int().min(1).max(5),
  period: z.number().int().min(1).max(6),
  sessionType: z.enum(['theory', 'practical']),
  isLabBlock: z.boolean(),
}).strict();

export const ManualTimetableSchema = z.object({
  academicYear: z.string().regex(/^\d{4}-\d{2}$/),
  semester: z.number().int().min(1).max(10),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  entries: z.array(ManualEntrySchema).max(10000),
  mode: z.enum(['follow_rules', 'allow_overrides']),
  reason: z.string().trim().max(2000).default(''),
}).strict();

export const ManualPublishSchema = z.object({
  academicYear: z.string().regex(/^\d{4}-\d{2}$/),
  semester: z.number().int().min(1).max(10),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  acknowledgeOverrides: z.boolean().default(false),
}).strict();

export type ManualEntry = Required<z.infer<typeof ManualEntrySchema>>;
export type ManualTimetableRequest = Omit<z.infer<typeof ManualTimetableSchema>, 'entries'> & { entries: ManualEntry[] };
