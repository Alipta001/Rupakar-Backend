import mongoose from 'mongoose';
import { AppError } from '../utils/app-error.js';
import { Review } from '../models/review.model.js';
import { Product } from '../models/product.model.js';
import { Order } from '../models/order.model.js';
import { Vendor } from '../models/vendor.model.js';

const sanitizeReview = (review) => {
  if (!review) return review;
  const plain = typeof review.toObject === 'function' ? review.toObject() : review;
  return {
    ...plain,
    id: String(plain._id),
    customerId: String(plain.customerId),
    productId: String(plain.productId),
    orderId: String(plain.orderId),
    vendorId: String(plain.vendorId),
  };
};

const queryToArray = async (query) => {
  if (!query) return [];
  if (typeof query.lean === 'function') {
    return query.lean();
  }
  if (typeof query.then === 'function') {
    return query;
  }
  return query;
};

export class ReviewService {
  async createCustomerReview({ customerId, productId, orderId, rating, title, comment }) {
    if (!customerId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    if (!mongoose.isValidObjectId(productId)) {
      throw new AppError(400, 'INVALID_PRODUCT_ID', 'Product ID is invalid');
    }
    if (!mongoose.isValidObjectId(orderId)) {
      throw new AppError(400, 'INVALID_ORDER_ID', 'Order ID is invalid');
    }

    const productDoc = await Product.findById(productId);
    const product = typeof productDoc?.lean === 'function' ? productDoc.lean() : productDoc;
    if (!product || product.deletedAt) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }

    const orderQuery = Order.findOne({
      _id: orderId,
      customerId,
      status: { $in: ['DELIVERED', 'RETURNED', 'REFUNDED'] },
      paymentStatus: { $in: ['PAID', 'CAPTURED'] },
    });
    const orderDoc = await orderQuery;
    const order = typeof orderDoc?.lean === 'function' ? orderDoc.lean() : orderDoc;

    if (!order) {
      throw new AppError(403, 'ORDER_NOT_ELIGIBLE_FOR_REVIEW', 'Only customers with a completed purchase can review this product');
    }

    const purchased = (order.items ?? []).some((item) => String(item.productId) === String(productId));
    if (!purchased) {
      throw new AppError(403, 'PRODUCT_NOT_PURCHASED', 'This product was not purchased by the authenticated customer');
    }

    const existingReviewDoc = await Review.findOne({ customerId, productId, orderId });
    const existing = typeof existingReviewDoc?.lean === 'function' ? existingReviewDoc.lean() : existingReviewDoc;
    if (existing) {
      throw new AppError(409, 'REVIEW_ALREADY_EXISTS', 'A review for this order and product already exists');
    }

    const review = await Review.create({
      customerId,
      productId,
      orderId,
      vendorId: product.vendorId,
      rating,
      title,
      comment,
      status: 'PUBLISHED',
    });

    return sanitizeReview(review);
  }

  async listCustomerReviews(customerId, { page = 1, limit = 20 } = {}) {
    if (!customerId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      queryToArray(Review.find({ customerId }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(safeLimit)),
      Review.countDocuments({ customerId }),
    ]);

    return {
      items: items.map((item) => sanitizeReview(item)),
      page: safePage,
      limit: safeLimit,
      total,
    };
  }

  async listVendorReviews(ownerUserId, { page = 1, limit = 20 } = {}) {
    if (!ownerUserId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const vendorDoc = await Vendor.findOne({ ownerUserId, deletedAt: null, status: 'APPROVED' });
    const vendor = typeof vendorDoc?.lean === 'function' ? vendorDoc.lean() : vendorDoc;
    if (!vendor) {
      throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can view reviews');
    }

    const productIds = await Product.find({ vendorId: vendor._id, deletedAt: null }).distinct('_id');
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      queryToArray(
        Review.find({ productId: { $in: productIds }, status: 'PUBLISHED' })
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(safeLimit),
      ),
      Review.countDocuments({ productId: { $in: productIds }, status: 'PUBLISHED' }),
    ]);

    return {
      items: items.map((item) => sanitizeReview(item)),
      page: safePage,
      limit: safeLimit,
      total,
    };
  }
}

export const reviewService = new ReviewService();
