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
  },
  { _id: true },
);

export const ReturnItem = model('ReturnItem', returnItemSchema);
