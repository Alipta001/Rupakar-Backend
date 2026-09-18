import { checkoutService } from '../services/checkout.service.js';
import { checkoutPreviewSchema } from '../validators/checkout.validators.js';
import { AppError } from '../utils/app-error.js';

export const previewCheckout = async (req, res, next) => {
  try {
    const payload = checkoutPreviewSchema.parse(req.body ?? {});
    const userId = req.user?.sub ?? null;

    if (!userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required for checkout preview');
    }

    const summary = await checkoutService.preview({
      userId,
      items: payload.items,
      shippingAddressId: payload.shippingAddressId,
      couponCode: payload.couponCode,
      idempotencyKey: payload.idempotencyKey,
    });

    res.status(200).json({
      success: true,
      data: summary,
      message: 'Checkout preview generated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
