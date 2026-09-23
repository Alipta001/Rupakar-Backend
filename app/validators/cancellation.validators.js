import { z } from 'zod';

export const createCancellationRequestSchema = z.object({
  variantId: z.string().min(1, 'Variant ID is required'),
  quantity: z.number().int().positive().optional(),
  reason: z.string().min(1, 'Reason is required').max(300),
  customerNote: z.string().max(1000).optional(),
});

export const rejectCancellationRequestSchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required').max(500),
});

export const listCancellationRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
