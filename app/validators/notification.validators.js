import { z } from 'zod';

export const notificationIdSchema = z.object({
  id: z.string().trim().min(1),
});

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
}).passthrough();

export const markReadSchema = z.object({
  // Empty body for read action
}).strict();
