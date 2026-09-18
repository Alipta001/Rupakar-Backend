import { z } from 'zod';

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    image: z.string().trim().url().optional(),
    parentId: z.string().trim().optional().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    seo: z
      .object({
        title: z.string().trim().max(160).optional(),
        description: z.string().trim().max(220).optional(),
        keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      })
      .optional(),
  })
  .strict();

export const updateCategorySchema = createCategorySchema.partial();
