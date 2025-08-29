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

export const notificationQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : 1)),
  limit: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : 20)),
  type: z.enum(['MENTION', 'REPLY', 'REACTION', 'FOLLOW']).optional(),
  unread: z.string().optional(),
});

export const markAsReadSchema = z.object({
  notificationIds: z.array(z.string()).optional(),
});
