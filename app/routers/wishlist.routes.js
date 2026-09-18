import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.middleware.js';
import { addWishlistItem, removeWishlistItem, listWishlist } from '../controllers/wishlist.controller.js';

const router = Router();

router.get('/', optionalAuth, listWishlist);
router.use(requireAuth);
router.post('/:productId', addWishlistItem);
router.delete('/:productId', removeWishlistItem);

export default router;
