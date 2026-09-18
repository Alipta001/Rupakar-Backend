import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/app-error.js';

export class RazorpayProvider {
  constructor() {
    this.enabled = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
    this.client = this.enabled
      ? new Razorpay({
          key_id: env.RAZORPAY_KEY_ID,
          key_secret: env.RAZORPAY_KEY_SECRET,
        })
      : null;
  }

  isEnabled() {
    return this.enabled;
  }

  async createPayment({ order, amount, currency = 'INR', notes = {} }) {
    if (!this.enabled || !this.client) {
      throw new AppError(503, 'RAZORPAY_UNAVAILABLE', 'Razorpay is not configured');
    }

    const razorpayAmount = Number(amount ?? order?.total ?? 0) * 100;
    const receipt = String(order?.orderNumber ?? `order-${Date.now()}`);

    const response = await this.client.orders.create({
      amount: Number(razorpayAmount),
      currency,
      receipt,
      notes,
    });

    return {
      providerOrderId: response?.id ?? null,
      providerPaymentId: null,
      amount: Number(response?.amount ?? razorpayAmount) / 100,
      currency: response?.currency ?? currency,
      status: response?.status ?? 'created',
      raw: response,
    };
  }

  verifyPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature, secret = env.RAZORPAY_KEY_SECRET }) {
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !secret) {
      return false;
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(String(razorpay_signature));

    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  verifyWebhookSignature({ rawBody, signature, secret = env.RAZORPAY_WEBHOOK_SECRET }) {
    if (!rawBody || !signature || !secret) {
      return false;
    }

    const normalizedBody = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
    const expected = crypto.createHmac('sha256', secret).update(normalizedBody).digest('hex');
    const provided = Buffer.from(String(signature));
    const expectedBuf = Buffer.from(expected);

    if (provided.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, provided);
  }

  async getPaymentStatus(providerPaymentId) {
    if (!this.enabled || !this.client || !providerPaymentId) {
      throw new AppError(503, 'RAZORPAY_UNAVAILABLE', 'Razorpay is not configured');
    }

    return this.client.payments.fetch(providerPaymentId);
  }

  async refundPayment({ providerPaymentId, amount, notes = {} }) {
    if (!this.enabled || !this.client || !providerPaymentId) {
      throw new AppError(503, 'RAZORPAY_UNAVAILABLE', 'Razorpay is not configured');
    }

    return this.client.payments.refund(providerPaymentId, {
      amount: Math.round(Number(amount) * 100),
      notes,
    });
  }
}
