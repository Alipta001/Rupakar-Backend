import { z } from 'zod';

export const supportCategorySchema = z.enum(['PRODUCTS', 'ORDERS', 'FINANCE', 'VERIFICATION', 'STORE', 'POLICIES', 'OTHER']);

export const createSupportTicketSchema = z.object({
  category: supportCategorySchema,
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(5000),
  orderId: z.string().regex(/^[a-f\d]{24}$/i).optional().nullable(),
  productId: z.string().regex(/^[a-f\d]{24}$/i).optional().nullable(),
});

export const supportTicketQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
});

export const supportMessageSchema = z.object({ message: z.string().trim().min(1).max(5000) });
export const supportStatusSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) });
