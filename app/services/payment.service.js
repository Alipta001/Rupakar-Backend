import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Payment } from '../models/payment.model.js';
import { PaymentTransaction } from '../models/payment-transaction.model.js';
import { PaymentEvent } from '../models/payment-event.model.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Cart } from '../models/cart.model.js';
import { AppError } from '../utils/app-error.js';
import { env } from '../config/env.js';
import { RazorpayProvider } from './payment-providers/razorpay.provider.js';
import { inventoryReservationService } from './inventory-reservation.service.js';
import { vendorLedgerService } from './vendor-ledger.service.js';
import {
  scheduleInvoiceGeneration,
  scheduleNotification,
  scheduleVendorOrderPackReminder,
  scheduleVendorOrderAutoCancel,
} from '../jobs/queues.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { Notification } from '../models/notification.model.js';
import { notificationService } from './notification.service.js';
import { emailService } from './email.service.js';
import { smsService } from './sms.service.js';

const PAYMENT_STATUS_TRANSITIONS = {
  PENDING: ['AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['CAPTURED', 'FAILED', 'CANCELLED'],
  CAPTURED: ['REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  REFUND_PENDING: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  REFUNDED: [],
  PARTIALLY_REFUNDED: [],
};

export class PaymentProvider {
  async createPayment() {
    throw new Error('createPayment must be implemented by provider');
  }

  async verifyPayment() {
    throw new Error('verifyPayment must be implemented by provider');
  }

  async getPaymentStatus() {
    throw new Error('getPaymentStatus must be implemented by provider');
  }

  async refundPayment() {
    throw new Error('refundPayment must be implemented by provider');
  }
}

export class MockPaymentProvider extends PaymentProvider {
  async createPayment({ order, amount, currency }) {
    return {
      providerOrderId: `mock_${order.orderNumber}`,
      providerPaymentId: `pay_${Date.now()}`,
      status: 'PENDING',
      amount,
      currency,
      raw: { order, amount, currency },
    };
  }

  async verifyPayment({ providerPaymentId }) {
    return {
      providerPaymentId,
      status: 'CAPTURED',
      verified: true,
    };
  }

  async getPaymentStatus() {
    return { status: 'PENDING' };
  }

  async refundPayment() {
    return { status: 'REFUNDED', refunded: true };
  }

  verifyWebhookSignature({ rawBody, signature, secret = 'mock-webhook-secret' }) {
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''));
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(String(signature ?? ''));

    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }
}

export class PaymentService {
  constructor() {
    this.provider = env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? new RazorpayProvider()
      : new MockPaymentProvider();
  }

  isRazorpayEnabled() {
    return this.provider instanceof RazorpayProvider && this.provider.isEnabled();
  }

  async ensureCapturedOrderArtifacts(orderId, paymentId, payment) {
    if (!mongoose.isValidObjectId(orderId) || !mongoose.isValidObjectId(paymentId)) return { vendorOrders: [], skipped: true };
    const orderQuery = Order.findById(orderId);
    const order = orderQuery && typeof orderQuery.lean === 'function' ? await orderQuery.lean() : await orderQuery;
    if (!order || payment?.status !== 'CAPTURED' || order.paymentStatus !== 'PAID') return { vendorOrders: [], skipped: true };

    const groups = new Map();
    for (const item of order.items || []) {
      const key = String(item.vendorId);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    const vendorOrderIds = [];
    const orderSubtotal = (order.items || []).reduce((sum, item) => sum + Number(item.lineTotal || 0), 0) || 1;
    for (const [vendorId, items] of groups) {
      let vendorOrder = await VendorOrder.findOne({ parentOrderId: order._id, vendorId, deletedAt: null });
      if (!vendorOrder) {
        const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
        const ratio = subtotal / orderSubtotal;
        try {
          vendorOrder = await VendorOrder.create({
            parentOrderId: order._id,
            vendorId,
            customerId: order.customerId,
            status: 'CONFIRMED',
            items: items.map((item) => ({ ...item, productSnapshot: { ...(item.productSnapshot || {}), productName: item.productName, sku: item.sku, categoryId: item.categoryId } })),
            subtotal,
            discount: Number((Number(order.discount || 0) * ratio).toFixed(2)),
            tax: Number((Number(order.tax || 0) * ratio).toFixed(2)),
            shipping: Number((Number(order.shipping || 0) * ratio).toFixed(2)),
            total: Number((subtotal - Number(order.discount || 0) * ratio + Number(order.tax || 0) * ratio + Number(order.shipping || 0) * ratio).toFixed(2)),
            currency: order.currency,
          });
        } catch (error) {
          if (error?.code !== 11000) throw error;
          vendorOrder = await VendorOrder.findOne({ parentOrderId: order._id, vendorId, deletedAt: null });
        }
      } else if (vendorOrder.status === 'PENDING_PAYMENT') {
        vendorOrder.status = 'CONFIRMED';
        await vendorOrder.save();
      }
      vendorOrderIds.push(vendorOrder._id);
      await scheduleInvoiceGeneration({ orderId: order._id, customerId: order.customerId, vendorId, vendorOrderId: vendorOrder._id }).catch(() => null);
      await scheduleVendorOrderPackReminder({ vendorOrderId: vendorOrder._id }).catch(() => null);
      await scheduleVendorOrderAutoCancel({ vendorOrderId: vendorOrder._id }).catch(() => null);
      const vendor = await Vendor.findById(vendorId).select('ownerUserId email phone businessName').lean();
      const owner = vendor?.ownerUserId ? await User.findById(vendor.ownerUserId).select('email phone name firstName lastName').lean() : null;
      const targetEmail = owner?.email || vendor?.email;
      const targetPhone = owner?.phone || vendor?.phone;

      if (vendor?.ownerUserId || targetEmail || targetPhone) {
        try {
          const idempotencyKey = `vendor-order-confirmed:${vendorOrder._id}`;
          const recipientUserId = vendor?.ownerUserId || null;
          const existingNotif = recipientUserId ? await Notification.findOne({
            userId: recipientUserId,
            'metadata.idempotencyKey': idempotencyKey,
          }).lean() : null;

          if (!existingNotif) {
            if (recipientUserId) {
              await notificationService.createNotification({
                userId: recipientUserId,
                type: 'VENDOR_ORDER_CONFIRMED',
                title: 'New order placed',
                message: `New order #${order.orderNumber} has been placed, please check your dashboard to process.`,
                channel: 'IN_APP',
                metadata: {
                  orderId: order._id,
                  vendorOrderId: vendorOrder._id,
                  email: targetEmail,
                  phone: targetPhone,
                  idempotencyKey,
                },
              }).catch(() => null);
            }

            const notifPromises = [];
            if (targetEmail) {
              notifPromises.push(
                emailService.sendEmail({
                  to: targetEmail,
                  subject: `New order #${order.orderNumber} placed - Please check your dashboard`,
                  html: `<div style="font-family:sans-serif;padding:16px;"><h2 style="color:#6B3E26;">New Order Received!</h2><p>New order has been placed, please check your dashboard to process.</p><p><strong>Order #:</strong> ${order.orderNumber}</p><p><strong>Total:</strong> ₹${vendorOrder.total}</p><p><strong>Items:</strong> ${(items || []).map((i) => `${i.productName} (x${i.quantity})`).join(', ')}</p></div>`,
                  text: `New order has been placed, please check your dashboard. Order #${order.orderNumber}, Items: ${items.length}, Total: ₹${vendorOrder.total}.`,
                }).catch((err) => console.error('Failed to send vendor order email:', err?.message))
              );
            }

            const rawPhone = String(targetPhone || '').trim();
            const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
            const isValidPhone = /^\+?[0-9]{10,15}$/.test(digitsOnly);
            if (isValidPhone) {
              notifPromises.push(
                smsService.sendSms({
                  to: rawPhone,
                  message: `Rupakar: New order has been placed, please check your dashboard to process #${order.orderNumber}.`,
                }).catch((err) => console.error('Failed to send vendor order SMS:', err?.message))
              );
            }

            await Promise.all(notifPromises);

            if (recipientUserId) {
              await scheduleNotification({
                userId: recipientUserId,
                type: 'VENDOR_ORDER_CONFIRMED',
                title: 'New order placed',
                message: `New order #${order.orderNumber} has been placed, please check your dashboard to process.`,
                metadata: { orderId: order._id, vendorOrderId: vendorOrder._id, email: targetEmail, phone: targetPhone, idempotencyKey },
              }).catch(() => null);
            }
          }
        } catch (notifError) {
          // Notification failures must never roll back order or payment
          console.error('Vendor notification failed:', notifError?.message);
        }
      }
    }

    await Order.updateOne({ _id: order._id }, { $set: { vendorOrders: vendorOrderIds } });
    await scheduleInvoiceGeneration({ orderId: order._id, customerId: order.customerId }).catch(() => null);
    await scheduleNotification({ userId: order.customerId, type: 'ORDER_CONFIRMED', title: 'Order confirmed', message: `Your order ${order.orderNumber} is confirmed.`, metadata: { orderId: order._id, idempotencyKey: `order-confirmed:${order._id}` } }).catch(() => null);
    await vendorLedgerService.recordCapturedPayment({ orderId: order._id, paymentId, payment }).catch((err) => {
      console.error('Failed to record captured payment in vendor ledger:', err?.message);
    });
    return { vendorOrders: vendorOrderIds, skipped: false };
  }

  async getPaymentForOrder(orderId) {
    if (!orderId) return null;
    const payment = await Payment.findOne({ orderId });
    if (!payment) return null;
    return typeof payment.toObject === 'function' ? payment.toObject() : payment;
  }

  buildPaymentPayload({ order, clientAmount = null, provider = 'razorpay' }) {
    const orderAmount = Number(order?.total ?? 0);
    const paidAmount = Number(orderAmount) || 0;

    if (clientAmount !== null && Number(clientAmount) !== Number(orderAmount)) {
      // Ignore the client-supplied payment amount and always use the authoritative backend total.
    }

    return {
      provider,
      amount: paidAmount,
      currency: order?.currency ?? 'INR',
      providerOrderId: null,
      method: 'CARD',
      metadata: { orderNumber: order?.orderNumber ?? null },
    };
  }

  async createPayment({ order, customerId, amount, method = 'CARD', idempotencyKey = null, provider = 'razorpay' }) {
    if (provider === 'razorpay' && !this.isRazorpayEnabled()) {
      throw new AppError(503, 'RAZORPAY_UNAVAILABLE', 'Online payment is not configured');
    }

    const payload = this.buildPaymentPayload({ order, clientAmount: amount, provider });

    if (amount !== undefined && amount !== null && Number(amount) !== Number(payload.amount)) {
      throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Payment amount must match the backend-calculated order total');
    }

    const existing = idempotencyKey
      ? await Payment.findOne({ customerId, idempotencyKey })
      : null;

    if (existing) {
      return existing.toObject ? existing.toObject() : existing;
    }

    let providerPayment = null;
    if (provider === 'razorpay') {
      providerPayment = await this.provider.createPayment({
        order,
        amount: payload.amount,
        currency: payload.currency,
        notes: payload.metadata,
      });
      if (Number(providerPayment.amount) !== Number(payload.amount)) {
        throw new AppError(502, 'PAYMENT_AMOUNT_MISMATCH', 'Payment provider amount did not match the order total');
      }
    }

    const payment = await Payment.create({
      orderId: order._id,
      customerId,
      provider,
      providerOrderId: providerPayment?.providerOrderId ?? `${provider}_${order?.orderNumber ?? 'order'}`,
      amount: payload.amount,
      currency: payload.currency,
      method,
      status: 'PENDING',
      idempotencyKey,
      metadata: payload.metadata,
    });

    await PaymentTransaction.create({
      paymentId: payment._id,
      orderId: order._id,
      provider,
      type: 'CREATE',
      status: 'SUCCESS',
      requestPayload: payload,
      responsePayload: { providerOrderId: payment.providerOrderId },
    });

    return {
      ...(payment.toObject ? payment.toObject() : payment),
      publicKey: provider === 'razorpay' ? env.RAZORPAY_KEY_ID : null,
    };
  }

  async simulateMockPayment({ orderId, customerId, outcome }) {
    if (!env.PAYMENT_MOCK_ENABLED) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Mock payments are unavailable');
    }

    const payment = await Payment.findOne({ orderId, customerId, provider: 'mock' });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Mock payment not found');

    if (['CAPTURED', 'FAILED', 'CANCELLED'].includes(payment.status)) {
      if (payment.status === 'CAPTURED') await this.ensureCapturedOrderArtifacts(orderId, payment._id, payment);
      return {
        outcome: payment.status === 'CAPTURED' ? 'success' : payment.status === 'FAILED' ? 'failure' : 'cancel',
        status: payment.status,
        duplicate: true,
      };
    }

    const nextStatus = { success: 'CAPTURED', failure: 'FAILED', cancel: 'CANCELLED' }[outcome];
    if (!nextStatus) throw new AppError(400, 'INVALID_MOCK_OUTCOME', 'Mock outcome must be success, failure, or cancel');

    await this.transitionPaymentStatus(payment.status, nextStatus, {
      paymentId: payment._id,
      orderId,
      actorType: 'SYSTEM',
      reason: `LOCAL_MOCK_${outcome.toUpperCase()}`,
    });

    const capturedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, status: payment.status },
      { $set: { status: nextStatus, providerPaymentId: nextStatus === 'CAPTURED' ? `mock_payment_${payment._id}` : undefined, paidAt: nextStatus === 'CAPTURED' ? new Date() : null, failureReason: nextStatus === 'FAILED' ? 'LOCAL_MOCK_FAILURE' : null } },
      { new: true },
    );

    const orderStatus = nextStatus === 'CAPTURED' ? 'CONFIRMED' : nextStatus === 'FAILED' ? 'FAILED' : 'CANCELLED';
    const paymentStatus = nextStatus === 'CAPTURED' ? 'PAID' : nextStatus;
    const order = await Order.findOne({ _id: orderId, customerId }).lean();
    if (order && nextStatus === 'CAPTURED') await inventoryReservationService.consumeOrderReservations({ orderId, items: order.items });
    if (order && nextStatus !== 'CAPTURED') await inventoryReservationService.releaseOrderReservations({ orderId, items: order.items, reason: `LOCAL_MOCK_${outcome.toUpperCase()}` });
    await Order.updateOne({ _id: orderId, customerId }, { $set: { status: orderStatus, paymentStatus } });
    await VendorOrder.updateMany({ parentOrderId: orderId }, { $set: { status: orderStatus } });
    if (nextStatus === 'CAPTURED' && capturedPayment) await this.ensureCapturedOrderArtifacts(orderId, capturedPayment._id, capturedPayment);

    if (nextStatus === 'CAPTURED') {
      if (order) await Cart.updateOne({ userId: customerId }, { $pull: { items: { variantId: { $in: order.items.map((item) => item.variantId) } } } });
    }

    const updatedOrder = await Order.findOne({ _id: orderId, customerId }).lean();
    return { outcome, status: nextStatus, paymentStatus, orderStatus, order: updatedOrder, duplicate: false };
  }

  async transitionPaymentStatus(currentStatus, nextStatus, { paymentId = null, orderId = null, actorType = 'SYSTEM', actorId = null, reason = null } = {}) {
    if (!currentStatus || !nextStatus) {
      throw new AppError(400, 'INVALID_PAYMENT_TRANSITION', 'Payment status transition is invalid');
    }

    const allowed = PAYMENT_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(400, 'INVALID_PAYMENT_TRANSITION', `Cannot transition from ${currentStatus} to ${nextStatus}`);
    }

    if (paymentId || orderId) {
      const normalizedPaymentId = mongoose.isValidObjectId(paymentId) ? paymentId : null;
      const normalizedOrderId = mongoose.isValidObjectId(orderId) ? orderId : null;
      const paymentTransactionPayload = {
        paymentId: normalizedPaymentId,
        orderId: normalizedOrderId,
        provider: 'internal',
        type: 'WEBHOOK',
        status: 'SUCCESS',
        requestPayload: { previousStatus: currentStatus, newStatus: nextStatus, actorType, actorId, reason },
        responsePayload: { previousStatus: currentStatus, newStatus: nextStatus },
      };

      if (paymentTransactionPayload.paymentId && paymentTransactionPayload.orderId) {
        await PaymentTransaction.create(paymentTransactionPayload);
      }
    }

    return { previousStatus: currentStatus, nextStatus };
  }

  getProviderFromPayload(payload, fallback = 'mock') {
    const providerName = payload?.provider ?? payload?.event ?? fallback;
    return providerName === 'razorpay' ? 'razorpay' : fallback;
  }

  getProviderEventId(payload, provider) {
    const eventId = payload?.eventId
      || payload?.id
      || payload?.payload?.payment?.entity?.id
      || payload?.payload?.order?.entity?.id
      || `${provider}:${Date.now()}`;
    return String(eventId);
  }

  getEventType(payload, provider) {
    const directType = payload?.type || payload?.event;
    if (directType) return String(directType);
    const entityStatus = payload?.payload?.payment?.entity?.status;
    if (entityStatus === 'captured') return 'payment.captured';
    if (entityStatus === 'failed') return 'payment.failed';
    return `${provider}.updated`;
  }

  async processWebhook({ provider, payload, signature, rawBody, secret = env.RAZORPAY_WEBHOOK_SECRET }) {
    const providerName = provider || this.getProviderFromPayload(payload, 'mock');
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? JSON.stringify(payload ?? {})));

    if (providerName === 'razorpay') {
      const validSignature = this.provider.verifyWebhookSignature({ rawBody: body, signature, secret });
      if (!validSignature) {
        return { success: false, error: 'INVALID_SIGNATURE' };
      }
    } else if (!signature || !body || signature !== 'valid-mock-signature') {
      return { success: false, error: 'INVALID_SIGNATURE' };
    }

    const providerEventId = this.getProviderEventId(payload, providerName);
    const eventType = this.getEventType(payload, providerName);
    const eventPayload = payload || {};

    const paymentEntity = eventPayload?.payload?.payment?.entity || eventPayload?.payload?.payment || {};
    const paymentId = paymentEntity?.id || paymentEntity?.providerPaymentId;
    const providerOrderId = paymentEntity?.order_id || paymentEntity?.orderId;
    const paymentLookup = paymentId || providerOrderId
      ? { $or: [{ providerPaymentId: paymentId }, { providerOrderId }] }
      : null;
    const currentPayment = paymentLookup ? await Payment.findOne(paymentLookup) : null;
    if ((paymentId || providerOrderId) && !currentPayment) {
      return { success: false, retryable: true, error: 'PAYMENT_NOT_FOUND', eventId: providerEventId };
    }

    let processed;
    try {
      processed = await PaymentEvent.create({
        provider: providerName,
        providerEventId,
        eventType,
        payload: eventPayload,
        processedAt: new Date(),
        status: 'PROCESSED',
      });
    } catch (error) {
      if (error?.code === 11000) return { success: true, duplicate: true, eventId: providerEventId };
      throw error;
    }

    if (paymentId) {
      const refundAmount = Number(paymentEntity?.amount ?? paymentEntity?.refund_amount ?? 0) / 100;
      const nextStatus = eventType === 'payment.captured'
        ? 'CAPTURED'
        : eventType === 'payment.failed'
          ? 'FAILED'
          : eventType === 'payment.refunded'
            ? (refundAmount > 0 && refundAmount < Number(currentPayment.amount) ? 'PARTIALLY_REFUNDED' : 'REFUNDED')
            : 'PENDING';
      const canApply = currentPayment && (
        (nextStatus === 'CAPTURED' && ['PENDING', 'AUTHORIZED'].includes(currentPayment.status))
        || (nextStatus === 'FAILED' && ['PENDING', 'AUTHORIZED'].includes(currentPayment.status))
        || (nextStatus === 'REFUNDED' && ['CAPTURED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(currentPayment.status))
        || (nextStatus === 'PARTIALLY_REFUNDED' && ['CAPTURED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(currentPayment.status))
      );
      if (!canApply) {
        if (nextStatus === 'CAPTURED' && currentPayment?.status === 'CAPTURED') {
          await this.ensureCapturedOrderArtifacts(currentPayment.orderId, currentPayment._id, currentPayment);
        }
        return { success: true, duplicate: false, ignored: true, eventId: providerEventId };
      }

      if (eventType === 'payment.captured' && (Number(paymentEntity?.amount ?? 0) !== Math.round(Number(currentPayment.amount) * 100) || paymentEntity?.currency !== currentPayment.currency)) {
        return { success: false, retryable: false, error: 'PAYMENT_DATA_MISMATCH', eventId: providerEventId };
      }

      const updatedPayment = await Payment.findOneAndUpdate({ _id: currentPayment._id, status: currentPayment.status }, {
        $set: {
          status: nextStatus,
          ...(paymentId ? { providerPaymentId: paymentId } : {}),
          paidAt: nextStatus === 'CAPTURED' ? new Date() : undefined,
          providerEventId,
        },
      }, { new: true });

      if (updatedPayment) {
        const order = await Order.findById(updatedPayment.orderId).lean();
        if (order && nextStatus === 'CAPTURED') await inventoryReservationService.consumeOrderReservations({ orderId: updatedPayment.orderId, items: order.items });
        if (order && nextStatus === 'FAILED') await inventoryReservationService.releaseOrderReservations({ orderId: updatedPayment.orderId, items: order.items, reason: 'PAYMENT_FAILED' });
        const paymentStatus = nextStatus === 'CAPTURED' ? 'PAID' : nextStatus;
        const orderStatus = nextStatus === 'CAPTURED' ? 'CONFIRMED' : nextStatus === 'FAILED' ? 'FAILED' : nextStatus === 'REFUNDED' ? 'REFUNDED' : nextStatus === 'PARTIALLY_REFUNDED' ? 'PARTIALLY_REFUNDED' : undefined;
        await Order.updateOne({ _id: updatedPayment.orderId }, {
          $set: {
            paymentStatus,
            ...(orderStatus ? { status: orderStatus } : {}),
          },
        });
        if (orderStatus) await VendorOrder.updateMany({ parentOrderId: updatedPayment.orderId }, { $set: { status: orderStatus } });
        if (nextStatus === 'CAPTURED') await this.ensureCapturedOrderArtifacts(updatedPayment.orderId, updatedPayment._id, updatedPayment);
      }
    }

    return {
      success: true,
      duplicate: false,
      event: processed.toObject ? processed.toObject() : processed,
    };
  }
}

export const paymentService = new PaymentService();
