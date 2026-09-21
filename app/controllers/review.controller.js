import { reviewService } from '../services/review.service.js';
import { createReviewSchema, listReviewsQuerySchema } from '../validators/review.validators.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/app-error.js';

export const createCustomerReview = async (req, res, next) => {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError(403, 'FORBIDDEN', 'Only customers can create reviews');
    }

    const payload = createReviewSchema.parse(req.body ?? {});
    const review = await reviewService.createCustomerReview({
      customerId: req.user.sub,
      productId: payload.productId,
      orderId: payload.orderId,
      rating: payload.rating,
      title: payload.title,
      comment: payload.comment,
    });

    res.status(201).json({
      success: true,
      data: review,
      message: 'Review created',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listPublicProductReviews = async (req, res, next) => {
  try {
    const { page, limit } = listReviewsQuerySchema.parse(req.query ?? {});
    const data = await reviewService.listPublicReviews(req.params.productId, { page, limit });
    sendSuccess(res, data, 'Product reviews loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listCustomerReviews = async (req, res, next) => {
  try {
    if (req.user.role !== 'customer') {
      throw new AppError(403, 'FORBIDDEN', 'Only customers can list their reviews');
    }

    const { page, limit } = listReviewsQuerySchema.parse(req.query ?? {});
    const data = await reviewService.listCustomerReviews(req.user.sub, { page, limit });
    sendSuccess(res, data, 'Customer reviews loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listVendorReviews = async (req, res, next) => {
  try {
    if (req.user.role !== 'vendor') {
      throw new AppError(403, 'FORBIDDEN', 'Only vendors can list vendor reviews');
    }

    const { page, limit } = listReviewsQuerySchema.parse(req.query ?? {});
    const data = await reviewService.listVendorReviews(req.user.sub, { page, limit });
    sendSuccess(res, data, 'Vendor reviews loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
