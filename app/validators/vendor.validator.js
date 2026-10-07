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

export const vendorPickupAddressSchema = z
  .object({
    pickupLocationName: z.string().trim().min(2, 'Pickup location name must be at least 2 characters').max(100),
    contactPerson: z.string().trim().min(2, 'Contact person must be at least 2 characters').max(100),
    phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Phone number must be a valid 10-digit Indian mobile number'),
    addressLine1: z.string().trim().min(3, 'Address line 1 must be at least 3 characters').max(200),
    addressLine2: z.string().trim().max(200).optional().default(''),
    city: z.string().trim().min(2, 'City is required').max(100),
    state: z.string().trim().min(2, 'State is required').max(100),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be a valid 6-digit Indian postal code'),
    country: z.string().trim().max(100).optional().default('India'),
  })
  .strict();

export const vendorShippingSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    fee: z.number().min(0, 'Delivery fee cannot be negative').default(0),
    freeDeliveryThreshold: z.number().min(0, 'Free delivery threshold cannot be negative').default(0),
  })
  .strict();

export const vendorUpdateSchema = vendorApplySchema.partial().extend({
  pickupAddress: vendorPickupAddressSchema.optional(),
  shippingSettings: vendorShippingSettingsSchema.optional(),
});

export const adminVendorDecisionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
}).passthrough();

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
