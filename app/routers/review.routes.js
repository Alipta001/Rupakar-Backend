import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { createCustomerReview, listCustomerReviews, listPublicProductReviews, listVendorReviews } from '../controllers/review.controller.js';

const router = Router();

router.get('/product/:productId', listPublicProductReviews);
router.use(requireAuth);
router.get('/customer', listCustomerReviews);
router.post('/', createCustomerReview);
router.get('/vendor', listVendorReviews);

export default router;
