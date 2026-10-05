import { z } from 'zod';

export const shipmentStatusSchema = z.object({
  status: z.enum([
    'PENDING',
    'CREATED',
    'LABEL_GENERATED',
    'READY_TO_SHIP',
    'PACKED',
    'PICKUP_REQUESTED',
    'PICKED_UP',
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'DELIVERY_FAILED',
    'RTO_INITIATED',
    'RTO_IN_TRANSIT',
    'RTO_DELIVERED',
    'CANCELLED',
    'RETURN_REQUESTED',
    'RETURN_IN_TRANSIT',
    'RETURNED',
  ]).optional(),
  reason: z.string().trim().min(2).max(200).optional(),
}).strict();

export const packageInfoSchema = z.object({
  weight: z.coerce.number().positive('Package weight must be greater than 0').max(100, 'Package weight exceeds maximum limit of 100 kg'),
  length: z.coerce.number().positive('Package length must be greater than 0').max(300, 'Package length exceeds maximum limit of 300 cm'),
  width: z.coerce.number().positive('Package width must be greater than 0').max(300, 'Package width exceeds maximum limit of 300 cm'),
  height: z.coerce.number().positive('Package height must be greater than 0').max(300, 'Package height exceeds maximum limit of 300 cm'),
  unit: z.enum(['kg', 'g']).default('kg').optional(),
  dimensionUnit: z.enum(['cm', 'in', 'm']).default('cm').optional(),
});

export const readyToShipSchema = z.object({
  packageInfo: packageInfoSchema.optional(),
  weight: z.coerce.number().positive('Package weight must be greater than 0').max(100).optional(),
  length: z.coerce.number().positive('Package length must be greater than 0').max(300).optional(),
  width: z.coerce.number().positive('Package width must be greater than 0').max(300).optional(),
  height: z.coerce.number().positive('Package height must be greater than 0').max(300).optional(),
  notes: z.string().trim().max(500).optional(),
}).passthrough();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().min(1).max(64).optional(),
}).passthrough();

export const shipmentTrackingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).passthrough();

