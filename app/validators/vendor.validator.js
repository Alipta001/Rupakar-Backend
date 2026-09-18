import { z } from 'zod';

export const vendorApplySchema = z
  .object({
    businessName: z.string().trim().min(2).max(160),
    legalName: z.string().trim().min(2).max(160).optional(),
    businessType: z.enum(['INDIVIDUAL', 'PARTNERSHIP', 'PRIVATE_LTD', 'LLP', 'PROPRIETORSHIP', 'OTHER']).optional(),
    description: z.string().trim().max(2000).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().min(7).max(20).optional(),
    website: z.string().trim().url().optional(),
    address: z.string().trim().min(5).max(300).optional(),
    originState: z.string().trim().min(2).max(80).optional(),
    originDistrict: z.string().trim().min(2).max(80).optional(),
    gstNumber: z.string().trim().optional(),
    panNumber: z.string().trim().optional(),
  })
  .strict();

export const vendorUpdateSchema = vendorApplySchema.partial();

export const adminVendorDecisionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export const bankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(30),
    bankName: z.string().trim().min(2).max(120),
    branchName: z.string().trim().max(120).optional(),
    ifscCode: z.string().trim().min(4).max(20),
    accountType: z.enum(['SAVINGS', 'CURRENT', 'OTHER']).optional(),
  })
  .strict();
