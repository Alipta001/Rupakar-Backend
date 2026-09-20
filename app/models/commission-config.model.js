import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const commissionConfigSchema = new Schema(
  {
    scope: { type: String, enum: ['PRODUCT', 'VENDOR', 'CATEGORY', 'GLOBAL'], required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    rate: { type: Number, required: true, min: 0, max: 100 },
    active: { type: Boolean, default: true, index: true },
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },
  },
  { timestamps: true },
);

commissionConfigSchema.index({ scope: 1, productId: 1, vendorId: 1, categoryId: 1, active: 1 }, { unique: true });

export const CommissionConfig = model('CommissionConfig', commissionConfigSchema);
