import { z } from 'zod';

export const AcceptConsentSchema = z.object({
  policy_version: z.string().min(1, 'Policy version is required'),
});

export type AcceptConsentDto = z.infer<typeof AcceptConsentSchema>;
