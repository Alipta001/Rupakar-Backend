import { z } from 'zod';

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    fullName: z.string().trim().min(1).max(120).optional(),
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().max(25).optional(),
    phoneNumber: z.string().trim().max(25).optional(),
    avatar: z.string().optional(),
    profileImage: z.string().optional(),
    preferences: z.record(z.any()).optional(),
  })
  .passthrough()
  .transform((data) => {
    const result = { ...data };
    if (data.fullName && !data.name) result.name = data.fullName;
    if (data.phoneNumber && !data.phone) result.phone = data.phoneNumber;
    if (data.profileImage && !data.avatar) result.avatar = data.profileImage;
    if (result.name && !result.firstName) {
      const parts = result.name.trim().split(' ');
      result.firstName = parts[0];
      result.lastName = parts.slice(1).join(' ') || '';
    } else if (!result.name && (data.firstName || data.lastName)) {
      result.name = [data.firstName, data.lastName].filter(Boolean).join(' ').trim();
    }
    return result;
  });

export const addressSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    recipientName: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(6).max(25).optional(),
    phoneNumber: z.string().trim().min(6).max(25).optional(),
    mobile: z.string().trim().min(6).max(25).optional(),
    addressLine1: z.string().trim().min(1).max(250).optional(),
    line1: z.string().trim().min(1).max(250).optional(),
    street: z.string().trim().min(1).max(250).optional(),
    address: z.string().trim().min(1).max(250).optional(),
    addressLine2: z.string().trim().max(250).optional().default(''),
    line2: z.string().trim().max(250).optional().default(''),
    landmark: z.string().trim().max(150).optional().default(''),
    city: z.string().trim().min(1).max(100).optional().default(''),
    district: z.string().trim().max(100).optional(),
    state: z.string().trim().min(1).max(100).optional().default(''),
    postalCode: z.string().trim().min(3).max(20).optional(),
    pincode: z.string().trim().min(3).max(20).optional(),
    pin: z.string().trim().min(3).max(20).optional(),
    zipCode: z.string().trim().min(3).max(20).optional(),
    zip: z.string().trim().min(3).max(20).optional(),
    country: z.string().trim().max(100).optional().default('India'),
    addressType: z.enum(['HOME', 'WORK', 'OTHER']).optional().default('HOME'),
    isDefaultShipping: z.boolean().optional().default(false),
    isDefaultBilling: z.boolean().optional().default(false),
  })
  .passthrough()
  .transform((data) => ({
    fullName: (data.fullName || data.name || data.recipientName || 'Customer').trim(),
    phone: (data.phone || data.phoneNumber || data.mobile || '0000000000').trim(),
    addressLine1: (data.addressLine1 || data.line1 || data.street || data.address || 'Address Line 1').trim(),
    addressLine2: (data.addressLine2 || data.line2 || '').trim(),
    landmark: (data.landmark || '').trim(),
    city: (data.city || 'City').trim(),
    district: (data.district || data.city || 'District').trim(),
    state: (data.state || 'State').trim(),
    postalCode: (data.postalCode || data.pincode || data.pin || data.zipCode || data.zip || '700001').trim(),
    country: (data.country || 'India').trim(),
    addressType: data.addressType || 'HOME',
    isDefaultShipping: Boolean(data.isDefaultShipping),
    isDefaultBilling: Boolean(data.isDefaultBilling),
  }));

export const updateAddressSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(6).max(25).optional(),
    addressLine1: z.string().trim().min(1).max(250).optional(),
    line1: z.string().trim().min(1).max(250).optional(),
    addressLine2: z.string().trim().max(250).optional(),
    line2: z.string().trim().max(250).optional(),
    landmark: z.string().trim().max(150).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    district: z.string().trim().max(100).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    postalCode: z.string().trim().min(3).max(20).optional(),
    pincode: z.string().trim().min(3).max(20).optional(),
    country: z.string().trim().max(100).optional(),
    addressType: z.enum(['HOME', 'WORK', 'OTHER']).optional(),
    isDefaultShipping: z.boolean().optional(),
    isDefaultBilling: z.boolean().optional(),
  })
  .passthrough()
  .transform((data) => {
    const result = { ...data };
    if (data.name && !data.fullName) result.fullName = data.name;
    if (data.line1 && !data.addressLine1) result.addressLine1 = data.line1;
    if (data.line2 && !data.addressLine2) result.addressLine2 = data.line2;
    if (data.pincode && !data.postalCode) result.postalCode = data.pincode;
    return result;
  });
