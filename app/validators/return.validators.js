import { z } from 'zod';

export const returnItemSchema = z.object({
  variantId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(1000),
  reason: z.string().trim().min(2).max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export const createReturnSchema = z.object({
  items: z.array(returnItemSchema).min(1),
  type: z.enum(['RETURN', 'REPLACEMENT']).default('RETURN').optional(),
  vendorOrderId: z.string().trim().optional(),
  idempotencyKey: z.string().trim().max(128).optional(),
  reason: z.string().trim().min(2).max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  description: z.string().trim().max(1000).optional(),
  evidenceImages: z.array(z.string().trim()).max(10).optional(),
}).strict();

export const cancelReturnSchema = z.object({
  reason: z.string().trim().min(2).max(200).optional(),
}).strict();

export const adminReturnDecisionSchema = z.object({
  reason: z.string().trim().min(2).max(200),
}).strict();

export const returnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().min(1).max(64).optional(),
}).passthrough();

export const sellerReviewReturnSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
}).strict();

export const packageInfoSchema = z
  .object({
    weight: z.coerce.number().positive({ message: 'Weight must be greater than 0' }),
    length: z.coerce.number().positive({ message: 'Length must be greater than 0' }),
    width: z.coerce.number().positive({ message: 'Width must be greater than 0' }),
    height: z.coerce.number().positive({ message: 'Height must be greater than 0' }),
    unit: z.string().trim().default('kg').optional(),
    dimensionUnit: z.string().trim().default('cm').optional(),
  })
  .strict();

export const sellerApproveReturnSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  packageInfo: packageInfoSchema.optional(),
}).strict();

export const sellerReceiveReturnSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
}).strict();

export const inspectionItemSchema = z.object({
  returnItemId: z.string().trim().optional(),
  variantId: z.string().trim().optional(),
  returnedQuantity: z.coerce.number().int().min(0).optional(),
  acceptedQuantity: z.coerce.number().int().min(0).default(0),
  rejectedQuantity: z.coerce.number().int().min(0).default(0),
  condition: z.enum([
    'INTACT',
    'UNUSED',
    'GOOD',
    'USED',
    'DAMAGED',
    'DEFECTIVE',
    'TAG_MISSING',
    'WRONG_ITEM',
    'MISSING_PARTS',
    'TAMPERED',
    'OTHER',
  ]).optional(),
  itemCondition: z.enum([
    'INTACT',
    'UNUSED',
    'GOOD',
    'USED',
    'DAMAGED',
    'DEFECTIVE',
    'TAG_MISSING',
    'WRONG_ITEM',
    'MISSING_PARTS',
    'TAMPERED',
    'OTHER',
  ]).optional(),
  notes: z.string().trim().max(1000).optional(),
  conditionNotes: z.string().trim().max(1000).optional(),
  evidence: z.array(z.string().trim().min(1)).max(10).optional(),
  proofImages: z.array(z.string().trim().min(1)).max(10).optional(),
  authenticityCondition: z.enum(['AUTHENTIC', 'MISMATCH', 'SUSPECTED_COUNTERFEIT', 'TAMPERED', 'OTHER']).optional(),
}).strict();

export const sellerInspectionSchema = z.object({
  result: z.enum(['PASS', 'FAIL', 'PASSED', 'FAILED']),
  condition: z.enum([
    'INTACT',
    'UNUSED',
    'GOOD',
    'USED',
    'DAMAGED',
    'DEFECTIVE',
    'TAG_MISSING',
    'WRONG_ITEM',
    'MISSING_PARTS',
    'TAMPERED',
    'OTHER',
  ]).default('INTACT').optional(),
  itemCondition: z.enum([
    'INTACT',
    'UNUSED',
    'GOOD',
    'USED',
    'DAMAGED',
    'DEFECTIVE',
    'TAG_MISSING',
    'WRONG_ITEM',
    'MISSING_PARTS',
    'TAMPERED',
    'OTHER',
  ]).optional(),
  notes: z.string().trim().max(1000).optional(),
  conditionNotes: z.string().trim().max(1000).optional(),
  proofImages: z.array(z.string().trim().min(1)).max(10).default([]).optional(),
  evidence: z.array(z.string().trim().min(1)).max(10).optional(),
  packagingCondition: z.enum(['INTACT', 'DAMAGED', 'OPENED', 'MISSING', 'OTHER']).optional(),
  accessoriesComplete: z.boolean().optional(),
  authenticityCondition: z.enum(['AUTHENTIC', 'MISMATCH', 'SUSPECTED_COUNTERFEIT', 'TAMPERED', 'OTHER']).optional(),
  items: z.array(inspectionItemSchema).optional(),
}).strict();

export const sellerDisputeSchema = z.object({
  reason: z.enum([
    'WRONG_ITEM_RETURNED',
    'ITEM_USED',
    'ITEM_DAMAGED_BY_CUSTOMER',
    'MISSING_PARTS',
    'TAG_REMOVED',
    'DIFFERENT_PRODUCT',
    'AUTHENTICITY_MISMATCH',
    'SUSPECTED_COUNTERFEIT',
    'TAMPERED',
    'OTHER',
  ]),
  description: z.string().trim().min(3).max(1000),
  evidence: z.array(z.string().trim().min(1)).max(10).default([]).optional(),
}).strict();

export const sellerReturnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().optional(),
  returnNumber: z.string().trim().optional(),
  orderNumber: z.string().trim().optional(),
  search: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
}).passthrough();

export const adminDisputeDecisionSchema = z.object({
  decision: z.enum(['UPHOLD_CUSTOMER', 'UPHOLD_SELLER', 'REQUEST_MORE_INFO']),
  decisionReason: z.string().trim().min(3).max(500),
  adminNotes: z.string().trim().max(1000).optional(),
}).strict();

export const adminReturnResolutionSchema = z.object({
  resolution: z.enum(['RETURN_REFUND', 'REPLACEMENT', 'REJECT_RETURN']),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export const adminReturnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().optional(),
  vendorId: z.string().trim().optional(),
  customerId: z.string().trim().optional(),
  orderNumber: z.string().trim().optional(),
  returnNumber: z.string().trim().optional(),
  search: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
}).passthrough();

export const customerPayoutDetailsSchema = z
  .object({
    method: z.enum(['UPI', 'BANK_ACCOUNT']),
    upiId: z.string().trim().min(3).max(100).optional(),
    accountHolderName: z.string().trim().min(2).max(100).optional(),
    accountNumber: z.string().trim().min(6).max(30).optional(),
    ifscCode: z.string().trim().min(4).max(20).optional(),
    bankName: z.string().trim().min(2).max(100).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.method === 'UPI') return Boolean(data.upiId);
      if (data.method === 'BANK_ACCOUNT') {
        return Boolean(data.accountHolderName && data.accountNumber && data.ifscCode);
      }
      return false;
    },
    { message: 'Required payout details missing for selected payout method' },
  );

export const adminExecuteRefundSchema = z
  .object({
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

export const adminCodPayoutSchema = z
  .object({
    action: z.enum(['INITIATE_PAYOUT', 'COMPLETE_PAYOUT', 'FAIL_PAYOUT']),
    reference: z.string().trim().min(2).max(100).optional(),
    failureReason: z.string().trim().min(2).max(500).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.action === 'COMPLETE_PAYOUT') return Boolean(data.reference);
      if (data.action === 'FAIL_PAYOUT') return Boolean(data.failureReason);
      return true;
    },
    { message: 'Reference required for completing payout, or failureReason required for failing payout' },
  );

export const createReplacementSchema = z
  .object({
    idempotencyKey: z.string().trim().max(128).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

export const prepareReverseShipmentSchema = z
  .object({
    packageInfo: packageInfoSchema,
    idempotencyKey: z.string().trim().max(128).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

export const retryReverseShipmentSchema = z
  .object({
    packageInfo: packageInfoSchema.optional(),
    idempotencyKey: z.string().trim().max(128).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

export const dispositionItemSchema = z
  .object({
    returnItemId: z.string().trim().min(1),
    variantId: z.string().trim().optional(),
    restockableQuantity: z.coerce.number().int().min(0).default(0),
    nonRestockableQuantity: z.coerce.number().int().min(0).default(0),
    disposition: z
      .enum([
        'RESTOCKABLE',
        'DAMAGED',
        'DEFECTIVE',
        'UNSALEABLE',
        'MISSING_PARTS',
        'WRONG_ITEM',
        'AUTHENTICITY_HOLD',
      ])
      .default('RESTOCKABLE'),
    reason: z.string().trim().max(1000).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

export const returnDispositionSchema = z
  .object({
    notes: z.string().trim().max(1000).optional(),
    items: z.array(dispositionItemSchema).optional(),
  })
  .strict();


