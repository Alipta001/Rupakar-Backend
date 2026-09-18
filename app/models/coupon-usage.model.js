import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const couponUsageSchema = new Schema(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    checkoutId: { type: String, trim: true, default: null },
    usedAt: { type: Date, default: Date.now },
    amount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

couponUsageSchema.index({ couponId: 1, userId: 1, checkoutId: 1 }, { unique: true, sparse: true });
couponUsageSchema.index({ couponId: 1, userId: 1, orderId: 1 }, { unique: true, sparse: true });

export const CouponUsage = model('CouponUsage', couponUsageSchema);
