import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const returnItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    reason: { type: String, default: null },
    productSnapshot: { type: Object, default: {} },
    inspection: {
      inspectedAt: { type: Date, default: null },
      inspectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      result: { type: String, enum: ['PASS', 'FAIL', 'PASSED', 'FAILED', 'PARTIAL', null], default: null },
      acceptedQuantity: { type: Number, default: 0, min: 0 },
      rejectedQuantity: { type: Number, default: 0, min: 0 },
      condition: { type: String, default: null },
      itemCondition: { type: String, default: null },
      notes: { type: String, trim: true, default: null },
      evidence: [{ type: String, trim: true }],
      authenticityCondition: { type: String, default: null },
    },
    disposition: {
      disposedAt: { type: Date, default: null },
      disposedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      disposition: {
        type: String,
        enum: [
          'RESTOCKABLE',
          'DAMAGED',
          'DEFECTIVE',
          'UNSALEABLE',
          'MISSING_PARTS',
          'WRONG_ITEM',
          'AUTHENTICITY_HOLD',
          null,
        ],
        default: null,
      },
      returnedQuantity: { type: Number, default: 0, min: 0 },
      acceptedQuantity: { type: Number, default: 0, min: 0 },
      rejectedQuantity: { type: Number, default: 0, min: 0 },
      restockableQuantity: { type: Number, default: 0, min: 0 },
      nonRestockableQuantity: { type: Number, default: 0, min: 0 },
      reason: { type: String, trim: true, default: null },
      notes: { type: String, trim: true, default: null },
      restocked: { type: Boolean, default: false },
      restockedAt: { type: Date, default: null },
    },
  },
  { _id: true },
);

export const ReturnItem = model('ReturnItem', returnItemSchema);
