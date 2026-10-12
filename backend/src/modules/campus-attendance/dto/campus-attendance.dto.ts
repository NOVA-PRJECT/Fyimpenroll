import { z } from 'zod';

export const CampusSignInSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative().max(50, 'Location accuracy must be 50m or better to verify presence on campus'),
  client_timestamp: z.string().datetime({ offset: true }),
  mocked: z.literal(false).optional(),
});

export type CampusSignInDto = z.infer<typeof CampusSignInSchema>;
