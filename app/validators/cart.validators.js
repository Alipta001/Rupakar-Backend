import { z } from 'zod';

export const cartItemSchema = z.object({
  productId: z.string().trim().min(1),
  variantId: z.string().trim().min(1),
  quantity: z.number().int().positive().max(20),
});

export const cartQuantitySchema = z.object({
  quantity: z.number().int().positive().max(20),
});
