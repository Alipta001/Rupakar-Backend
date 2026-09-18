import { z } from 'zod';

export const returnItemSchema = z.object({
  variantId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(1000),
  reason: z.string().trim().min(2).max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export const createReturnSchema = z.object({
  items: z.array(returnItemSchema).min(1),
  reason: z.string().trim().min(2).max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export const cancelReturnSchema = z.object({
  reason: z.string().trim().min(2).max(200).optional(),
}).strict();

export const adminReturnDecisionSchema = z.object({
  reason: z.string().trim().min(2).max(200),
}).strict();

export const returnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().min(1).max(64).optional(),
}).passthrough();
