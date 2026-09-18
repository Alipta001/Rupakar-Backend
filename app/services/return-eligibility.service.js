import { AppError } from '../utils/app-error.js';
import { Order } from '../models/order.model.js';

export class ReturnEligibilityService {
  async canRequestReturn({ customerId, orderId, items = [], now = new Date() }) {
    if (!customerId || !orderId) {
      throw new AppError(400, 'INVALID_RETURN_REQUEST', 'Customer and order are required');
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return { allowed: false, reason: 'ORDER_NOT_FOUND' };
    }

    if (String(order.customerId) !== String(customerId)) {
      return { allowed: false, reason: 'ORDER_OWNERSHIP_MISMATCH' };
    }

    if (order.status !== 'DELIVERED') {
      return { allowed: false, reason: 'ORDER_NOT_DELIVERED' };
    }

    if (!Array.isArray(items) || items.length === 0) {
      return { allowed: false, reason: 'NO_RETURN_ITEMS' };
    }

    const itemSet = new Map();
    for (const item of order.items || []) {
      itemSet.set(String(item.variantId), Number(item.quantity || 0));
    }

    for (const candidate of items) {
      const variantId = String(candidate.variantId ?? '');
      const qty = Number(candidate.quantity ?? 0);
      if (!variantId || !Number.isInteger(qty) || qty <= 0) {
        return { allowed: false, reason: 'INVALID_RETURN_QUANTITY' };
      }
      const purchased = itemSet.get(variantId) || 0;
      if (qty > purchased) {
        return { allowed: false, reason: 'RETURN_QUANTITY_EXCEEDS_PURCHASED' };
      }
    }

    const windowMs = 7 * 24 * 60 * 60 * 1000;
    const orderAgeMs = now.getTime() - new Date(order.createdAt).getTime();
    if (orderAgeMs > windowMs) {
      return { allowed: false, reason: 'RETURN_WINDOW_EXPIRED' };
    }

    return { allowed: true, order, reason: null };
  }
}

export const returnEligibilityService = new ReturnEligibilityService();
