import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { createCustomerReview, listCustomerReviews, listVendorReviews } from '../controllers/review.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/customer', listCustomerReviews);
router.post('/', createCustomerReview);
router.get('/vendor', listVendorReviews);

export default router;
