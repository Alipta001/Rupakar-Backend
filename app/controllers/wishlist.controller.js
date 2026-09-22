import { wishlistService } from '../services/wishlist.service.js';
import { sendSuccess } from '../utils/response.js';

export const addWishlistItem = async (req, res, next) => {
  try {
    const item = await wishlistService.addItem({ userId: req.user.sub, productId: req.params.productId });
    sendSuccess(res, item, 'Wishlist item added', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const removeWishlistItem = async (req, res, next) => {
  try {
    const item = await wishlistService.removeItem({ userId: req.user.sub, productId: req.params.productId });
    sendSuccess(res, item, 'Wishlist item removed', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listWishlist = async (req, res, next) => {
  try {
    const userId = req.user?.sub ?? null;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
    const data = userId ? await wishlistService.listItems(userId, { page, limit }) : { items: [], page, limit, total: 0, totalPages: 0, hasNext: false, hasPrevious: false };
    sendSuccess(res, data, 'Wishlist loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
