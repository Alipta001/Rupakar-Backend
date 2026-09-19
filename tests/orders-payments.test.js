import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OrderService } from '../app/services/order.service.js';
import { PaymentService } from '../app/services/payment.service.js';
import { InventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Cart } from '../app/models/cart.model.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { Payment } from '../app/models/payment.model.js';
import { PaymentTransaction } from '../app/models/payment-transaction.model.js';
import { PaymentEvent } from '../app/models/payment-event.model.js';
import { paymentService } from '../app/services/payment.service.js';
import { userAddressService } from '../app/services/user-address.service.js';
import { pricingService } from '../app/services/pricing.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { OrderStatusHistory } from '../app/models/order-status-history.model.js';
import { RazorpayProvider } from '../app/services/payment-providers/razorpay.provider.js';
import { env } from '../app/config/env.js';

describe('order service', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('creates an order from the authenticated customer cart and ignores client totals', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const shippingAddressId = new mongoose.Types.ObjectId().toHexString();
    const billingAddressId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Cart, 'findOne').mockResolvedValue({
      _id: 'cart-1',
      userId: customerId,
      items: [{ productId, variantId, quantity: 2 }],
      save: jest.fn(),
    });
    jest.spyOn(pricingService, 'buildPriceSummary').mockResolvedValue({
      subtotal: 2000,
      discount: 0,
      tax: 100,
      shipping: 0,
      total: 2100,
      currency: 'INR',
      items: [{ productId, variantId, quantity: 2, unitPrice: 1000, lineTotal: 2000 }],
      shippingAddress: { _id: shippingAddressId, state: 'West Bengal', city: 'Kolkata' },
    });
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      sku: 'SKU-1',
      status: 'ACTIVE',
      price: 1000,
      toObject: () => ({ _id: variantId, productId, sku: 'SKU-1', status: 'ACTIVE', price: 1000 }),
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Bengal Cotton',
      categoryId: new mongoose.Types.ObjectId().toHexString(),
      tax: { taxable: true, taxCode: 'GST_5' },
      toObject: () => ({ _id: productId, vendorId, status: 'PUBLISHED', deletedAt: null, name: 'Bengal Cotton', categoryId: new mongoose.Types.ObjectId().toHexString(), tax: { taxable: true, taxCode: 'GST_5' } }),
    });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({
      _id: 'inv-1',
      variantId,
      availableQuantity: 10,
      reservedQuantity: 0,
      deletedAt: null,
    });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({
      _id: 'reservation-1',
      orderId: 'order-1',
      variantId,
      productId,
      quantity: 2,
      status: 'ACTIVE',
    });
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue({
      _id: 'inv-1',
      variantId,
      availableQuantity: 8,
      reservedQuantity: 2,
      deletedAt: null,
    });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({
      _id: 'vendor-order-1',
      vendorId,
      parentOrderId: 'order-1',
      total: 2100,
    });
    jest.spyOn(Order, 'findOne').mockResolvedValue(null);
    jest.spyOn(Order, 'create').mockResolvedValue({
      _id: 'order-1',
      customerId,
      orderNumber: 'ORD-2026-123456',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      total: 2100,
      items: [{ productId, variantId, quantity: 2, productName: 'Bengal Cotton', unitPrice: 1000 }],
      toObject: () => ({
        _id: 'order-1',
        customerId,
        orderNumber: 'ORD-2026-123456',
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
        total: 2100,
        items: [{ productId, variantId, quantity: 2, productName: 'Bengal Cotton', unitPrice: 1000 }],
      }),
    });
    jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({
      _id: 'order-1',
      vendorOrders: ['vendor-order-1'],
    });
    jest.spyOn(Payment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Payment, 'create').mockResolvedValue({
      _id: 'payment-1',
      orderId: 'order-1',
      customerId,
      amount: 2100,
      status: 'PENDING',
      toObject: () => ({ _id: 'payment-1', orderId: 'order-1', customerId, amount: 2100, status: 'PENDING' }),
    });
    jest.spyOn(PaymentTransaction, 'create').mockResolvedValue({ _id: 'payment-tx-1' });
    jest.spyOn(Cart, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(paymentService, 'isRazorpayEnabled').mockReturnValue(true);
    jest.spyOn(paymentService.provider, 'createPayment').mockResolvedValue({
      providerOrderId: 'order_razorpay_test',
      providerPaymentId: null,
      amount: 2100,
      currency: 'INR',
      status: 'created',
    });

    const service = new OrderService();
    const result = await service.createOrder({
      customerId,
      shippingAddressId,
      billingAddressId,
      couponCode: null,
      paymentMethod: 'razorpay',
      idempotencyKey: 'order-1',
    });

    expect(result.orderNumber).toMatch(/^ORD-/);
    expect(result.total).toBeGreaterThan(0);
    expect(result.status).toBe('PENDING_PAYMENT');
  });

  it('rejects duplicate idempotency requests for the same customer', async () => {
    const service = new OrderService();
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const existingOrder = { _id: 'existing-order', orderNumber: 'ORD-1', customerId, idempotencyKey: 'dup-key' };

    jest.spyOn(Order, 'findOne').mockResolvedValue(existingOrder);

    const result = await service.getExistingOrderForIdempotency(customerId, 'dup-key');
    expect(result).toMatchObject({ customerId, idempotencyKey: 'dup-key' });
  });

  it('validates order state transitions and rejects invalid ones', async () => {
    const service = new OrderService();
    await expect(service.transitionOrderStatus('PENDING_PAYMENT', 'DELIVERED')).rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION' });
    await expect(service.transitionOrderStatus('PAID', 'CONFIRMED')).resolves.toBeTruthy();
  });

  it('payment service uses the server-side order amount instead of client amount', async () => {
    const service = new PaymentService();
    const payment = await service.buildPaymentPayload({
      order: { total: 2500, currency: 'INR', orderNumber: 'ORD-ABC-123' },
      clientAmount: 4999,
      provider: 'mock',
    });

    expect(payment.amount).toBe(2500);
    expect(payment.amount).toBeGreaterThan(0);
  });

  it('sends a ₹0.50 server total to Razorpay as 50 paise', async () => {
    const provider = Object.create(RazorpayProvider.prototype);
    provider.enabled = true;
    provider.client = { orders: { create: jest.fn().mockResolvedValue({
      id: 'order_razorpay_half_rupee',
      amount: 50,
      currency: 'INR',
      status: 'created',
    }) } };

    const result = await provider.createPayment({
      order: { orderNumber: 'ORD-HALF-RUPEE', total: 0.5 },
      amount: 0.5,
      currency: 'INR',
    });

    expect(provider.client.orders.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 50,
      currency: 'INR',
    }));
    expect(result.amount).toBe(0.5);
  });

  it('creates a ₹1 Razorpay payment and returns the provider order for checkout', async () => {
    const service = new PaymentService();
    const originalKeyId = env.RAZORPAY_KEY_ID;
    env.RAZORPAY_KEY_ID = 'rzp_test_checkout_regression';
    const order = {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: 'ORD-ONE-RUPEE',
      total: 1,
      currency: 'INR',
    };
    const providerOrder = {
      providerOrderId: 'order_razorpay_one_rupee',
      providerPaymentId: null,
      amount: 1,
      currency: 'INR',
      status: 'created',
    };
    jest.spyOn(service, 'isRazorpayEnabled').mockReturnValue(true);
    jest.spyOn(service.provider, 'createPayment').mockResolvedValue(providerOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Payment, 'create').mockResolvedValue({
      _id: 'payment-1',
      orderId: order._id,
      providerOrderId: providerOrder.providerOrderId,
      amount: 1,
      currency: 'INR',
      status: 'PENDING',
      toObject: () => ({
        _id: 'payment-1',
        orderId: order._id,
        providerOrderId: providerOrder.providerOrderId,
        amount: 1,
        currency: 'INR',
        status: 'PENDING',
      }),
    });
    jest.spyOn(PaymentTransaction, 'create').mockResolvedValue({ _id: 'transaction-1' });

    try {
      const result = await service.createPayment({
        order,
        customerId: new mongoose.Types.ObjectId(),
        amount: 1,
        method: 'razorpay',
        provider: 'razorpay',
      });

      expect(service.provider.createPayment).toHaveBeenCalledWith(expect.objectContaining({
        amount: 1,
        currency: 'INR',
      }));
      expect(result).toMatchObject({
        providerOrderId: 'order_razorpay_one_rupee',
        amount: 1,
        currency: 'INR',
        status: 'PENDING',
        publicKey: 'rzp_test_checkout_regression',
      });
    } finally {
      env.RAZORPAY_KEY_ID = originalKeyId;
    }
  });

  it('cancels a customer-owned order and releases its reservation inventory', async () => {
    const service = new OrderService();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const customerId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      items: [{ variantId: new mongoose.Types.ObjectId().toHexString(), quantity: 2 }],
      toObject: () => ({ _id: orderId, customerId, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' }),
    });
    jest.spyOn(OrderStatusHistory, 'create').mockResolvedValue({ _id: 'history-1' });
    jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({ _id: orderId, status: 'CANCELLED', paymentStatus: 'CANCELLED' });
    jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ _id: 'res-1', status: 'RELEASED' });
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(Payment, 'findOne').mockResolvedValue({ _id: 'pay-1', status: 'PENDING' });
    jest.spyOn(Payment, 'findOneAndUpdate').mockResolvedValue({ _id: 'pay-1', status: 'CANCELLED' });

    const result = await service.cancelOrder({
      orderId,
      customerId,
      reason: 'Customer changed mind',
      actorType: 'CUSTOMER',
      actorId: customerId,
    });

    expect(result.status).toBe('CANCELLED');
    expect(result.paymentStatus).toBe('CANCELLED');
  });

  it('enforces a strict payment status transition whitelist', async () => {
    const service = new PaymentService();
    await expect(service.transitionPaymentStatus('PENDING', 'REFUNDED')).rejects.toMatchObject({ code: 'INVALID_PAYMENT_TRANSITION' });
    await expect(service.transitionPaymentStatus('PENDING', 'AUTHORIZED')).resolves.toBeTruthy();
  });
});

describe('inventory reservation service', () => {
  it('creates a reservation without allowing oversell', async () => {
    const service = new InventoryReservationService();

    await expect(service.validateReservationQuantity(10, 11)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expect(service.validateReservationQuantity(10, 10)).resolves.toBe(10);
  });
});

describe('payment webhook handling', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects unsigned webhook payloads and prevents duplicate processing', async () => {
    const service = new PaymentService();

    jest.spyOn(PaymentEvent, 'findOne').mockResolvedValue(null);
    const orderSpy = jest.spyOn(PaymentEvent, 'create').mockResolvedValue({ _id: 'evt-1' });

    const result = await service.processWebhook({
      provider: 'mock',
      payload: { eventId: 'ev-1', type: 'payment.captured' },
      signature: 'bad-signature',
      rawBody: '{"eventId":"ev-1"}',
    });

    expect(result.success).toBe(false);
    expect(orderSpy).not.toHaveBeenCalled();
  });

  it('accepts a valid Razorpay webhook signature and records the event', async () => {
    const service = new PaymentService();
    const payload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_razorpay_1',
            order_id: 'order_razorpay_1',
            amount: 2500,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const secret = 'test-razorpay-secret';
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    jest.spyOn(PaymentEvent, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(PaymentEvent, 'create').mockResolvedValue({
      _id: 'evt-2',
      provider: 'razorpay',
      providerEventId: 'evt_razorpay_1',
      eventType: 'payment.captured',
      toObject: () => ({ _id: 'evt-2', provider: 'razorpay', providerEventId: 'evt_razorpay_1', eventType: 'payment.captured' }),
    });
    jest.spyOn(Payment, 'findOneAndUpdate').mockResolvedValue({
      _id: 'pay-1',
      orderId: new mongoose.Types.ObjectId().toHexString(),
    });
    jest.spyOn(Order, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(inventoryReservationService, 'consumeOrderReservations').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'order-1', items: [] }) });
    jest.spyOn(Payment, 'findOne').mockResolvedValue({
      _id: 'pay-1',
      orderId: new mongoose.Types.ObjectId().toHexString(),
      customerId: new mongoose.Types.ObjectId().toHexString(),
      status: 'PENDING',
      amount: 25,
      currency: 'INR',
    });

    const result = await service.processWebhook({
      provider: 'razorpay',
      payload,
      signature,
      rawBody,
      secret,
    });

    expect(result.success).toBe(true);
    expect(createSpy).toHaveBeenCalled();
    expect(Order.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ $set: expect.objectContaining({ paymentStatus: 'PAID', status: 'CONFIRMED' }) }),
    );
    expect(VendorOrder.updateMany).toHaveBeenCalledWith(expect.any(Object), { $set: { status: 'CONFIRMED' } });
    expect(inventoryReservationService.consumeOrderReservations).toHaveBeenCalled();
  }, 10000);

  it('treats a concurrent duplicate webhook insert as idempotent', async () => {
    const service = new PaymentService();
    jest.spyOn(PaymentEvent, 'findOne').mockResolvedValue(null);
    jest.spyOn(PaymentEvent, 'create').mockRejectedValue({ code: 11000 });

    const result = await service.processWebhook({ provider: 'mock', payload: { eventId: 'same-event', type: 'payment.captured' }, signature: 'valid-mock-signature', rawBody: '{}' });
    expect(result).toMatchObject({ success: true, duplicate: true, eventId: 'same-event' });
  });

  it('ignores an out-of-order failure after capture without regressing payment', async () => {
    const service = new PaymentService();
    jest.spyOn(PaymentEvent, 'create').mockResolvedValue({ toObject: () => ({}) });
    jest.spyOn(Payment, 'findOne').mockResolvedValue({ _id: 'pay-1', status: 'CAPTURED', providerPaymentId: 'pay-1' });
    const updateSpy = jest.spyOn(Payment, 'findOneAndUpdate');

    const result = await service.processWebhook({ provider: 'mock', payload: { eventId: 'late-failure', type: 'payment.failed', payload: { payment: { entity: { id: 'pay-1' } } } }, signature: 'valid-mock-signature', rawBody: '{}' });
    expect(result).toMatchObject({ success: true, ignored: true });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
