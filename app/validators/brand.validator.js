import { z } from 'zod';

export const createBrandSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    logo: z.string().trim().url().optional(),
    website: z.string().trim().url().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    seo: z
      .object({
        title: z.string().trim().max(160).optional(),
        description: z.string().trim().max(220).optional(),
        keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      })
      .optional(),
  })
  .strict();

export const updateBrandSchema = createBrandSchema.partial();
