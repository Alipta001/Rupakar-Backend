import { AppError } from '../utils/app-error.js';
import { pricingService } from './pricing.service.js';

const idempotencyMap = new Map();

export class CheckoutService {
  async preview({ userId, items, shippingAddressId, couponCode, idempotencyKey, shippingAddress }) {
    const key = idempotencyKey ? `${userId ?? 'guest'}:${idempotencyKey}` : `${userId ?? 'guest'}:${JSON.stringify(items)}:${shippingAddressId ?? ''}:${couponCode ?? ''}`;
    if (idempotencyKey && idempotencyMap.has(key)) {
      return idempotencyMap.get(key);
    }

    const summary = await pricingService.buildPriceSummary({
      userId,
      items,
      shippingAddressId,
      couponCode,
      shippingAddress,
    });

    if (idempotencyKey) {
      idempotencyMap.set(key, summary);
    }

    return summary;
  }

  clearIdempotencyKey(userId, idempotencyKey) {
    if (!idempotencyKey) return;
    idempotencyMap.delete(`${userId ?? 'guest'}:${idempotencyKey}`);
  }
}

export const checkoutService = new CheckoutService();
