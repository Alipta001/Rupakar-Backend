import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.middleware.js';
import { getCart, addCartItem, updateCartItem, removeCartItem, clearCart, mergeCart } from '../controllers/cart.controller.js';

const router = Router();

router.use('/cart', optionalAuth);
router.get('/cart', getCart);
router.post('/cart/items', addCartItem);
router.patch('/cart/items/:variantId', updateCartItem);
router.delete('/cart/items/:variantId', removeCartItem);
router.delete('/cart', clearCart);
router.post('/cart/merge', mergeCart);

export default router;
