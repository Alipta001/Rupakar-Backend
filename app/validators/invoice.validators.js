import { z } from 'zod';

export const createInvoiceSchema = z.object({
  // Invoice is generated server-side, no frontend input needed for creation
}).strict();

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).passthrough();

export const invoiceIdSchema = z.object({
  id: z.string().trim().min(1),
});
