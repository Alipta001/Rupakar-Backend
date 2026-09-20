import { z } from 'zod';

export const createReviewSchema = z.object({
  productId: z.string().trim().min(1),
  orderId: z.string().trim().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(120),
  comment: z.string().trim().min(3).max(2000),
}).strict();

export const listReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).passthrough();
