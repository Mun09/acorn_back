import z from 'zod';

export const getUserSchema = z.object({
  handle: z.string().min(1).max(30),
});

export const UpdateUserSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  bio: z.string().max(160).nullable().optional(),
  handle: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
});
