import { afterEach, expect, it, jest } from '@jest/globals';
import { confirmPayment } from '../app/controllers/payment.controller.js';
import { Order } from '../app/models/order.model.js';
import { Payment } from '../app/models/payment.model.js';
import { Cart } from '../app/models/cart.model.js';
import { paymentService } from '../app/services/payment.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { PaymentEvent } from '../app/models/payment-event.model.js';

const runConfirm = async () => {
  const order = {
    _id: 'order-1',
    customerId: 'customer-1',
    items: [{ variantId: 'variant-1' }],
    status: 'PENDING_PAYMENT',
    paymentStatus: 'PENDING',
    save: jest.fn().mockResolvedValue(true),
  };
  const payment = {
    _id: 'payment-1',
    provider: 'razorpay',
    providerOrderId: 'order_razorpay_test',
    amount: 100,
    currency: 'INR',
    status: 'PENDING',
    save: jest.fn().mockResolvedValue(true),
  };
  jest.spyOn(Order, 'findOne').mockResolvedValue(order);
  jest.spyOn(Payment, 'findOne').mockResolvedValue(payment);
  jest.spyOn(Payment, 'findOneAndUpdate').mockImplementation(async (_filter, update) => {
    Object.assign(payment, update.$set);
    return payment;
  });
  jest.spyOn(paymentService.provider, 'verifyPayment').mockReturnValue(true);
  jest.spyOn(paymentService.provider, 'getPaymentStatus').mockResolvedValue({
    order_id: 'order_razorpay_test',
    amount: 10000,
    currency: 'INR',
  });
  jest.spyOn(Cart, 'updateOne').mockResolvedValue({ acknowledged: true });
  jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
  const consumeSpy = jest.spyOn(inventoryReservationService, 'consumeOrderReservations').mockResolvedValue([]);
  const json = jest.fn();
  const next = jest.fn();

  await confirmPayment({
    user: { sub: 'customer-1' },
    body: {
      orderId: 'order-1',
      razorpay_order_id: 'order_razorpay_test',
      razorpay_payment_id: 'pay_test_1',
      razorpay_signature: 'valid-signature',
    },
    headers: {},
  }, { status: () => ({ json }) }, next);

  return { order, payment, consumeSpy, json, next };
};

afterEach(() => jest.restoreAllMocks());

it('consumes reservations when server-side Razorpay verification succeeds', async () => {
  const result = await runConfirm();

  expect(result.next).not.toHaveBeenCalled();
  expect(result.payment.status).toBe('CAPTURED');
  expect(result.order.status).toBe('CONFIRMED');
  expect(result.order.paymentStatus).toBe('PAID');
  expect(result.consumeSpy).toHaveBeenCalledWith({ orderId: 'order-1', items: result.order.items });
  expect(result.json).toHaveBeenCalled();
});

it('rejects a provider currency mismatch', async () => {
  const order = { _id: 'order-1', customerId: 'customer-1', items: [], save: jest.fn() };
  const payment = { _id: 'payment-1', provider: 'razorpay', providerOrderId: 'order_razorpay_test', amount: 100, currency: 'INR' };
  jest.spyOn(Order, 'findOne').mockResolvedValue(order);
  jest.spyOn(Payment, 'findOne').mockResolvedValue(payment);
  jest.spyOn(paymentService.provider, 'verifyPayment').mockReturnValue(true);
  jest.spyOn(paymentService.provider, 'getPaymentStatus').mockResolvedValue({ order_id: 'order_razorpay_test', amount: 10000, currency: 'USD' });
  const next = jest.fn();

  await confirmPayment({ user: { sub: 'customer-1' }, body: { orderId: 'order-1', razorpay_order_id: 'order_razorpay_test', razorpay_payment_id: 'pay-1', razorpay_signature: 'sig' }, headers: {} }, { status: () => ({ json: jest.fn() }) }, next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PAYMENT_CURRENCY' }));
});

it('returns an idempotent success for a repeated confirmation with the same payment ID', async () => {
  const order = { _id: 'order-1', customerId: 'customer-1', status: 'CONFIRMED', paymentStatus: 'PAID' };
  const payment = { _id: 'payment-1', provider: 'razorpay', providerOrderId: 'order_razorpay_test', providerPaymentId: 'pay_test_1', status: 'CAPTURED', amount: 100, currency: 'INR' };
  jest.spyOn(Order, 'findOne').mockResolvedValue(order);
  jest.spyOn(Payment, 'findOne').mockResolvedValue(payment);
  const json = jest.fn();
  const next = jest.fn();

  await confirmPayment({ user: { sub: 'customer-1' }, body: { orderId: 'order-1', razorpay_order_id: 'order_razorpay_test', razorpay_payment_id: 'pay_test_1', razorpay_signature: 'unused' }, headers: {} }, { status: () => ({ json }) }, next);

  expect(next).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ duplicate: true, paymentStatus: 'PAID' }) }));
});

it('settles a captured webhook when the payment record only has the Razorpay order ID', async () => {
  const payment = {
    _id: 'payment-1',
    orderId: 'order-1',
    provider: 'razorpay',
    providerOrderId: 'order_razorpay_test',
    amount: 1,
    currency: 'INR',
    status: 'PENDING',
  };
  jest.spyOn(paymentService.provider, 'verifyWebhookSignature').mockReturnValue(true);
  jest.spyOn(Payment, 'findOne').mockResolvedValue(payment);
  jest.spyOn(PaymentEvent, 'create').mockResolvedValue({ toObject: () => ({ eventType: 'payment.captured' }) });
  jest.spyOn(Payment, 'findOneAndUpdate').mockImplementation(async (_filter, update) => ({
    ...payment,
    ...update.$set,
  }));
  jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'order-1', items: [] }) });
  jest.spyOn(Order, 'updateOne').mockResolvedValue({ acknowledged: true });
  jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
  jest.spyOn(inventoryReservationService, 'consumeOrderReservations').mockResolvedValue([]);

  const payload = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_1',
          order_id: 'order_razorpay_test',
          amount: 100,
          currency: 'INR',
        },
      },
    },
  };
  const result = await paymentService.processWebhook({
    provider: 'razorpay',
    payload,
    signature: 'valid-signature',
    rawBody: Buffer.from(JSON.stringify(payload)),
  });

  expect(result.success).toBe(true);
  expect(Payment.findOne).toHaveBeenCalledWith({
    $or: [
      { providerPaymentId: 'pay_test_1' },
      { providerOrderId: 'order_razorpay_test' },
    ],
  });
  expect(Payment.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: 'payment-1', status: 'PENDING' },
    expect.objectContaining({ $set: expect.objectContaining({ status: 'CAPTURED', providerPaymentId: 'pay_test_1' }) }),
    { new: true },
  );
  expect(Order.updateOne).toHaveBeenCalledWith(
    { _id: 'order-1' },
    { $set: { paymentStatus: 'PAID', status: 'CONFIRMED' } },
  );
});
