import { paymentService } from '../services/payment.service.js';
import { Payment } from '../models/payment.model.js';
import { Order } from '../models/order.model.js';
import { Cart } from '../models/cart.model.js';
import { AppError } from '../utils/app-error.js';
import { env } from '../config/env.js';
import { z } from 'zod';
import { inventoryReservationService } from '../services/inventory-reservation.service.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { vendorLedgerService } from '../services/vendor-ledger.service.js';

export const paymentWebhook = async (req, res, next) => {
  try {
    const provider = 'razorpay';
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const payload = rawBody.length ? JSON.parse(rawBody.toString()) : {};
    const signature = req.headers['x-signature'] || req.headers['x-razorpay-signature'];
    const result = await paymentService.processWebhook({
      provider,
      payload,
      signature: typeof signature === 'string' ? signature : String(signature ?? ''),
      rawBody,
    });

    if (!result.success) {
      throw new AppError(400, 'INVALID_WEBHOOK', 'Invalid webhook payload');
    }

    res.status(200).json({
      success: true,
      data: { accepted: true, duplicate: !!result.duplicate },
      message: 'Webhook processed',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentByOrder = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ orderId: req.params.orderId, customerId: req.user.sub }).lean();
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    res.status(200).json({
      success: true,
      data: payment,
      message: 'Payment loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentConfig = async (_req, res, next) => {
  try {
    const razorpayEnabled = paymentService.isRazorpayEnabled();
    res.status(200).json({
      success: true,
      data: {
        razorpayEnabled,
        mockEnabled: env.PAYMENT_MOCK_ENABLED,
        publicKey: razorpayEnabled ? env.RAZORPAY_KEY_ID : null,
      },
      message: 'Payment configuration loaded',
    });
  } catch {
    next(new AppError(503, 'PAYMENT_CONFIGURATION_UNAVAILABLE', 'Payment configuration is temporarily unavailable'));
  }
};

export const simulateMockPayment = async (req, res, next) => {
  try {
    const payload = z.object({
      orderId: z.string().trim().min(1),
      outcome: z.enum(['success', 'failure', 'cancel']),
    }).parse(req.body ?? {});
    const result = await paymentService.simulateMockPayment({
      orderId: payload.orderId,
      customerId: req.user.sub,
      outcome: payload.outcome,
    });
    res.status(200).json({ success: true, data: result, message: 'Mock payment simulated' });
  } catch (error) {
    next(error);
  }
};

export const getOrderPaymentStatus = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, customerId: req.user.sub }).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const payment = await Payment.findOne({ orderId: order._id }).lean();
    res.status(200).json({
      success: true,
      data: { orderStatus: order.status, paymentStatus: payment?.status ?? 'PENDING' },
      message: 'Payment status loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const confirmPayment = async (req, res, next) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
    const order = await Order.findOne({ _id: orderId, customerId: req.user.sub });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const payment = await Payment.findOne({ orderId: order._id });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.provider !== 'razorpay') {
      throw new AppError(400, 'PAYMENT_PROVIDER_UNSUPPORTED', 'Payment provider confirmation is not configured');
    }
    if (payment.status === 'CAPTURED') {
      if (payment.providerPaymentId === razorpay_payment_id) {
        await paymentService.ensureCapturedOrderArtifacts(order._id, payment._id, payment);
        res.status(200).json({
          success: true,
          data: { orderId: order._id, status: order.status, paymentStatus: order.paymentStatus, duplicate: true },
          message: 'Payment was already confirmed',
          requestId: String(req.headers['x-request-id'] ?? ''),
        });
        return;
      }
      throw new AppError(409, 'PAYMENT_ALREADY_CONFIRMED', 'Payment has already been confirmed with a different payment ID');
    }
    if (!razorpay_order_id || razorpay_order_id !== payment.providerOrderId) {
      throw new AppError(400, 'INVALID_PAYMENT_ORDER', 'Payment order could not be verified');
    }
    const verified = paymentService.provider.verifyPayment({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });
    if (!verified) throw new AppError(400, 'INVALID_PAYMENT_SIGNATURE', 'Payment signature could not be verified');

    const providerPayment = await paymentService.provider.getPaymentStatus(razorpay_payment_id);
    if (providerPayment?.order_id !== payment.providerOrderId) {
      throw new AppError(400, 'INVALID_PAYMENT_ORDER', 'Payment provider order does not match this order');
    }
    if (providerPayment?.currency !== payment.currency) {
      throw new AppError(400, 'INVALID_PAYMENT_CURRENCY', 'Payment currency does not match the order currency');
    }
    if (Number(providerPayment?.amount) !== Math.round(Number(payment.amount) * 100)) {
      throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Payment amount does not match the order total');
    }

    const capturedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $in: ['PENDING', 'AUTHORIZED'] }, providerPaymentId: null },
      { $set: { status: 'CAPTURED', providerPaymentId: razorpay_payment_id, paidAt: new Date() } },
      { new: true },
    );
    if (!capturedPayment) {
      const currentPayment = await Payment.findById(payment._id).lean();
      if (currentPayment?.status === 'CAPTURED' && currentPayment.providerPaymentId === razorpay_payment_id) {
        res.status(200).json({
          success: true,
          data: { orderId: order._id, status: order.status, paymentStatus: order.paymentStatus, duplicate: true },
          message: 'Payment was already confirmed',
          requestId: String(req.headers['x-request-id'] ?? ''),
        });
        return;
      }
      throw new AppError(409, 'PAYMENT_CONFIRMATION_CONFLICT', 'Payment confirmation is already being processed or has changed');
    }

    await Cart.updateOne(
      { userId: req.user.sub },
      { $pull: { items: { variantId: { $in: order.items.map((item) => item.variantId) } } } },
    );

    order.paymentStatus = 'PAID';
    order.status = 'CONFIRMED';
    await order.save();
    await inventoryReservationService.consumeOrderReservations({ orderId: order._id, items: order.items });
    await paymentService.ensureCapturedOrderArtifacts(order._id, capturedPayment._id, capturedPayment);

    res.status(200).json({
      success: true,
      data: { orderId: order._id, status: order.status, paymentStatus: order.paymentStatus },
      message: 'Payment confirmed successfully',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
