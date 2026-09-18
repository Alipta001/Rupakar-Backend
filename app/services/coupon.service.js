import { Coupon } from '../models/coupon.model.js';
import { CouponUsage } from '../models/coupon-usage.model.js';
import { AppError } from '../utils/app-error.js';

const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
};

export class CouponService {
  normalizeCode(code) {
    return String(code ?? '').trim().toUpperCase();
  }

  async validateCoupon({ couponCode, userId = null, subtotal = 0, items = [] } = {}) {
    const code = this.normalizeCode(couponCode);
    if (!code) {
      throw new AppError(400, 'INVALID_COUPON', 'Coupon code is required');
    }

    const couponDoc = await Coupon.findOne({ code, status: 'ACTIVE', deletedAt: null }).lean();
    if (!couponDoc) {
      throw new AppError(404, 'COUPON_NOT_FOUND', 'Coupon code is invalid or inactive');
    }

    const now = Date.now();
    const startAt = couponDoc.startAt ? new Date(couponDoc.startAt).getTime() : null;
    const expiresAt = couponDoc.expiresAt ? new Date(couponDoc.expiresAt).getTime() : null;
    if (startAt && now < startAt) {
      throw new AppError(400, 'COUPON_NOT_ACTIVE_YET', 'Coupon is not active yet');
    }
    if (expiresAt && now > expiresAt) {
      throw new AppError(400, 'COUPON_EXPIRED', 'Coupon has expired');
    }

    const orderValue = Number(subtotal) || 0;
    if (orderValue < (Number(couponDoc.minimumOrderValue) || 0)) {
      throw new AppError(400, 'COUPON_MIN_ORDER', 'Coupon minimum order value is not met');
    }

    if (userId) {
      const usedForUser = await CouponUsage.countDocuments({ couponId: couponDoc._id, userId });
      const perUserLimit = Number(couponDoc.perUserLimit ?? 1);
      if (perUserLimit > 0 && usedForUser >= perUserLimit) {
        throw new AppError(400, 'COUPON_LIMIT_REACHED', 'Coupon usage limit for this user has been reached');
      }

      if (couponDoc.firstOrderOnly) {
        const previousUsage = await CouponUsage.findOne({ couponId: couponDoc._id, userId });
        if (previousUsage) {
          throw new AppError(400, 'COUPON_FIRST_ORDER_ONLY', 'This coupon is only valid on the first order');
        }
      }
    }

    const globalUsageLimit = Number(couponDoc.usageLimit ?? 0);
    if (globalUsageLimit > 0) {
      const totalUsage = await CouponUsage.countDocuments({ couponId: couponDoc._id });
      if (totalUsage >= globalUsageLimit) {
        throw new AppError(400, 'COUPON_LIMIT_REACHED', 'Coupon has reached its total usage limit');
      }
    }

    const safeItems = Array.isArray(items) ? items : [];
    if (couponDoc.scope === 'PRODUCT' && couponDoc.productId) {
      const productIds = safeItems.map((item) => String(item.productId));
      if (!productIds.includes(String(couponDoc.productId))) {
        throw new AppError(400, 'COUPON_PRODUCT_SCOPE', 'Coupon applies only to a specific product');
      }
    }

    if (couponDoc.scope === 'CATEGORY' && couponDoc.categoryId) {
      const categoryIds = safeItems.map((item) => String(item.categoryId));
      if (!categoryIds.includes(String(couponDoc.categoryId))) {
        throw new AppError(400, 'COUPON_CATEGORY_SCOPE', 'Coupon applies only to a specific category');
      }
    }

    const rawDiscount = couponDoc.discountType === 'PERCENTAGE'
      ? (orderValue * Number(couponDoc.discountValue || 0)) / 100
      : Number(couponDoc.discountValue || 0);

    const cappedDiscount = couponDoc.maximumDiscount > 0 ? Math.min(rawDiscount, Number(couponDoc.maximumDiscount)) : rawDiscount;
    const discount = Math.max(0, Math.round(cappedDiscount));

    return {
      code,
      discount,
      discountType: couponDoc.discountType,
      discountValue: couponDoc.discountValue,
      maximumDiscount: couponDoc.maximumDiscount,
      minimumOrderValue: couponDoc.minimumOrderValue,
      coupon: toPlain(couponDoc),
    };
  }
}

export const couponService = new CouponService();
