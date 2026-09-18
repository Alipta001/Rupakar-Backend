import { z } from 'zod';

export const shipmentStatusSchema = z.object({
  status: z.enum(['PENDING', 'READY_TO_SHIP', 'PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED']).optional(),
  reason: z.string().trim().min(2).max(200).optional(),
}).strict();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().min(1).max(64).optional(),
}).passthrough();

export const shipmentTrackingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).passthrough();
