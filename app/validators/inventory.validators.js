import { z } from 'zod';

export const inventoryAdjustmentSchema = z.object({
  delta: z.number().finite().refine((value) => Number.isFinite(value), 'Delta must be numeric'),
  reason: z.string().trim().min(1).max(180).optional(),
});

export const inventoryReadSchema = z.object({
  variantId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
});
