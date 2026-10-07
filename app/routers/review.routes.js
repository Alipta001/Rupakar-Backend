import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  createCustomerReview,
  updateCustomerReview,
  getReviewEligibility,
  listCustomerReviews,
  listPublicProductReviews,
  listVendorReviews,
} from '../controllers/review.controller.js';

const router = Router();

router.get('/product/:productId', listPublicProductReviews);
router.use(requireAuth);
router.get('/eligibility/:productId', getReviewEligibility);
router.get('/customer', listCustomerReviews);
router.post('/', createCustomerReview);
router.put('/:id', updateCustomerReview);
router.patch('/:id', updateCustomerReview);
router.get('/vendor', listVendorReviews);

export default router;
