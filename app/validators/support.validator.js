import { z } from 'zod';
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES } from '../models/support-ticket.model.js';

export const supportCategorySchema = z.enum(SUPPORT_CATEGORIES);

export const supportPrioritySchema = z.object({ priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) });

export const createSupportTicketSchema = z.object({
  category: supportCategorySchema,
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(160, 'Subject cannot exceed 160 characters'),
  message: z.string().trim().min(1, 'Message cannot be empty').max(5000, 'Message cannot exceed 5000 characters'),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  orderId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid order ID').optional().nullable(),
  productId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid product ID').optional().nullable(),
  returnId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid return ID').optional().nullable(),
  replacementId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid replacement ID').optional().nullable(),
  vendorId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid vendor ID').optional().nullable(),
});

export const supportTicketQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(SUPPORT_STATUSES).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: supportCategorySchema.optional(),
  search: z.string().trim().optional(),
  returnId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  orderId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

export const supportMessageSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(5000, 'Message cannot exceed 5000 characters'),
  isInternal: z.boolean().optional(),
});

export const supportStatusSchema = z.object({
  status: z.enum(SUPPORT_STATUSES),
});
