import { z } from 'zod';

export const createOrderSchema = z.object({
  shippingAddressId: z.string().trim().min(1).optional(),
  billingAddressId: z.string().trim().min(1).optional(),
  couponCode: z.string().trim().min(1).max(64).optional(),
  paymentMethod: z.string().trim().min(1).max(32).default('razorpay'),
  mockOutcome: z.enum(['success', 'failure', 'cancel']).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  shippingAddress: z.record(z.any()).optional(),
}).strict();

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(2).max(200).optional(),
}).strict();
