import { cartService } from '../services/cart.service.js';
import { sendSuccess } from '../utils/response.js';

export const getCart = async (req, res, next) => {
  try {
    const userId = req.user?.sub ?? null;
    const sessionId = req.headers['x-guest-session-id'] ?? req.query.guestSessionId ?? null;
    const cart = userId
      ? await cartService.getCartForUser(userId)
      : await cartService.getGuestCart(sessionId);
    sendSuccess(res, cart, 'Cart loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const addCartItem = async (req, res, next) => {
  try {
    const userId = req.user?.sub ?? null;
    const sessionId = req.headers['x-guest-session-id'] ?? req.query.guestSessionId ?? null;
    const cart = await cartService.addItem({
      userId,
      guestSessionId: sessionId,
      productId: req.body.productId,
      variantId: req.body.variantId,
      quantity: req.body.quantity,
    });
    sendSuccess(res, cart, 'Item added to cart', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const updateCartItem = async (req, res, next) => {
  try {
    const userId = req.user?.sub ?? null;
    const sessionId = req.headers['x-guest-session-id'] ?? req.query.guestSessionId ?? null;
    const cart = await cartService.updateItemQuantity({
      userId,
      guestSessionId: sessionId,
      variantId: req.params.variantId,
      quantity: req.body.quantity,
    });
    sendSuccess(res, cart, 'Cart item updated', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const removeCartItem = async (req, res, next) => {
  try {
    const userId = req.user?.sub ?? null;
    const sessionId = req.headers['x-guest-session-id'] ?? req.query.guestSessionId ?? null;
    const cart = await cartService.removeItem({
      userId,
      guestSessionId: sessionId,
      variantId: req.params.variantId,
    });
    sendSuccess(res, cart, 'Cart item removed', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const clearCart = async (req, res, next) => {
  try {
    const userId = req.user?.sub ?? null;
    const sessionId = req.headers['x-guest-session-id'] ?? req.query.guestSessionId ?? null;
    const cart = await cartService.clearCart({ userId, guestSessionId: sessionId });
    sendSuccess(res, cart, 'Cart cleared', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
