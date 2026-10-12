import { z } from 'zod';

import { ROLE_VALUES } from '@fyimp/contracts';
export const UserRoleSchema = z.enum(ROLE_VALUES);

export const ProfileResponseSchema = z.object({
  role: UserRoleSchema,
  must_change_password: z.boolean().optional(),
  profile: z.object({
    id: z.string().optional(),
    full_name: z.string().nullable().optional(),
    current_semester: z.number().nullable().optional(),
    department_id: z.string().nullable().optional(),
    campus_id: z.string().nullable().optional(),
    departments: z
      .object({
        name: z.string().optional(),
      })
      .nullable()
      .optional(),
    campuses: z
      .object({
        name: z.string().optional(),
      })
      .nullable()
      .optional(),
  }),
});

export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
