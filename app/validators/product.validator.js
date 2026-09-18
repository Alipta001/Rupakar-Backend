import { z } from 'zod';

export const productBaseSchema = z.object({
  name: z.string().trim().min(2).max(220),
  shortDescription: z.string().trim().max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  categoryId: z.string().trim().min(1).optional(),
  subcategoryId: z.string().trim().min(1).optional().nullable(),
  brandId: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  attributes: z.record(z.array(z.string().trim().min(1).max(80))).optional(),
  featured: z.boolean().optional(),
  seo: z.object({
    title: z.string().trim().max(160).optional(),
    description: z.string().trim().max(220).optional(),
    keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  }).optional(),
  authenticity: z.object({
    reference: z.string().trim().max(220).optional(),
    status: z.enum(['VERIFIED', 'UNVERIFIED', 'PENDING']).optional(),
  }).optional(),
  shipping: z.object({
    originState: z.string().trim().min(2).max(80).optional(),
    originDistrict: z.string().trim().min(2).max(80).optional(),
    deliveryDays: z.number().int().min(1).max(120).optional(),
    freeShipping: z.boolean().optional(),
  }).optional(),
  tax: z.object({
    taxable: z.boolean().optional(),
    taxCode: z.string().trim().max(40).optional(),
    gstIncluded: z.boolean().optional(),
  }).optional(),
}).strict();

export const variantSchema = z.object({
  sku: z.string().trim().min(3).max(80),
  barcode: z.string().trim().max(80).optional(),
  price: z.number().min(0),
  compareAtPrice: z.number().min(0).nullable().optional(),
  costPrice: z.number().min(0).nullable().optional(),
  weight: z.number().min(0).nullable().optional(),
  dimensions: z.object({
    length: z.number().min(0).optional(),
    width: z.number().min(0).optional(),
    height: z.number().min(0).optional(),
  }).optional(),
  attributes: z.record(z.string().trim().min(1).max(80)).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).strict();

export const createProductSchema = productBaseSchema.extend({
  variants: z.array(variantSchema).min(1).max(50).optional(),
  images: z.array(z.object({
    storageKey: z.string().trim().min(1),
    url: z.string().trim().url(),
    altText: z.string().trim().max(160).optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    isPrimary: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })).max(20).optional(),
}).strict();

export const updateProductSchema = createProductSchema.partial();
export const submitProductSchema = z.object({}).strict();
export const adminReviewSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();
export const publicProductQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  vendor: z.string().trim().max(120).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  status: z.enum(['PUBLISHED', 'APPROVED']).optional(),
  sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'name_asc', 'name_desc']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().trim().max(64).optional(),
}).strict();
