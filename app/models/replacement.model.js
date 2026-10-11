import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const REPLACEMENT_STATUSES = [
  'APPROVED',
  'PENDING_ORDER_CREATION',
  'ORDER_CREATED',
  'PENDING_FULFILLMENT',
  'FULFILLMENT_STARTED',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'ORDER_CREATION_FAILED',
  'CANCELLED',
];

const replacementSchema = new Schema(
  {
    replacementNumber: { type: String, required: true, unique: true, index: true },
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', required: true, unique: true, index: true },
    originalOrderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    originalVendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', default: null, index: true },
    quantity: { type: Number, required: true, min: 1 },
    productSnapshot: { type: Object, default: {} },
    status: {
      type: String,
      enum: REPLACEMENT_STATUSES,
      default: 'APPROVED',
      index: true,
    },
    replacementOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    replacementVendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', default: null, index: true },
    idempotencyKey: { type: String, default: null, index: true },
    failureReason: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    statusHistory: [
      {
        status: { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        actorType: { type: String, enum: ['CUSTOMER', 'VENDOR', 'ADMIN', 'SYSTEM'], default: 'SYSTEM' },
        notes: { type: String, default: null },
      },
    ],
  },
  { timestamps: true },
);

replacementSchema.index({ customerId: 1, createdAt: -1 });
replacementSchema.index({ vendorId: 1, createdAt: -1 });
replacementSchema.index({ status: 1, createdAt: -1 });
replacementSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } } },
);

export const Replacement = model('Replacement', replacementSchema);
export { REPLACEMENT_STATUSES };
