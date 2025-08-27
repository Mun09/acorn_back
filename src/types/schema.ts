import z from 'zod';

export const getUserSchema = z.object({
  handle: z.string().min(1).max(30),
});
