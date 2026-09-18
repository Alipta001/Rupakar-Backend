import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const couponSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, unique: true, uppercase: true, index: true },
    name: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'PAUSED'], default: 'ACTIVE', index: true },
    discountType: { type: String, enum: ['PERCENTAGE', 'FIXED'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    minimumOrderValue: { type: Number, min: 0, default: 0 },
    maximumDiscount: { type: Number, min: 0, default: 0 },
    usageLimit: { type: Number, min: 0, default: 0 },
    perUserLimit: { type: Number, min: 0, default: 1 },
    startAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    firstOrderOnly: { type: Boolean, default: false },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
    scope: { type: String, enum: ['GLOBAL', 'VENDOR', 'CATEGORY', 'PRODUCT'], default: 'GLOBAL' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

couponSchema.index({ status: 1, startAt: 1, expiresAt: 1 });

export const Coupon = model('Coupon', couponSchema);
