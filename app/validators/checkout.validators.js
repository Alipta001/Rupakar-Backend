import { z } from 'zod';

export const checkoutItemSchema = z.object({
  productId: z.string().trim().min(1),
  variantId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(20),
}).strict();

export const checkoutPreviewSchema = z.object({
  items: z.array(checkoutItemSchema).min(1),
  shippingAddressId: z.string().trim().min(1).optional(),
  couponCode: z.string().trim().min(1).max(64).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  note: z.string().trim().max(500).optional(),
}).strict();
