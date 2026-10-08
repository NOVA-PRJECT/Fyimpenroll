import { z } from 'zod';

export const CampusSignInSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().max(50, 'Location accuracy must be 50m or better to verify presence on campus'),
  client_timestamp: z.string().optional(),
});

export type CampusSignInDto = z.infer<typeof CampusSignInSchema>;
