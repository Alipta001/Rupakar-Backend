import { jest, expect, it, afterEach } from '@jest/globals';
import { Payment } from '../app/models/payment.model.js';
import { PaymentTransaction } from '../app/models/payment-transaction.model.js';
import { PaymentService } from '../app/services/payment.service.js';

afterEach(() => {
  jest.restoreAllMocks();
});

it('returns the existing payment for a repeated idempotency key', async () => {
  const service = new PaymentService();
  const existing = {
    _id: 'payment-1',
    customerId: 'customer-1',
    idempotencyKey: 'checkout-1',
    toObject: () => ({ _id: 'payment-1', status: 'PENDING' }),
  };
  const findSpy = jest.spyOn(Payment, 'findOne').mockResolvedValue(existing);
  const createSpy = jest.spyOn(Payment, 'create');

  const result = await service.createPayment({
    order: { _id: 'order-1', orderNumber: 'ORD-1', total: 1250, currency: 'INR' },
    customerId: 'customer-1',
    amount: 1250,
    provider: 'mock',
    idempotencyKey: 'checkout-1',
  });

  expect(result).toEqual({ _id: 'payment-1', status: 'PENDING' });
  expect(findSpy).toHaveBeenCalledWith({ customerId: 'customer-1', idempotencyKey: 'checkout-1' });
  expect(createSpy).not.toHaveBeenCalled();
});

it('creates a fresh payment for checkout #2 after checkout #1 is cancelled', async () => {
  const service = new PaymentService();
  const firstOrder = { _id: 'order-product-a', orderNumber: 'ORD-A', total: 1, currency: 'INR' };
  const secondOrder = { _id: 'order-product-b', orderNumber: 'ORD-B', total: 1, currency: 'INR' };
  const providerSpy = jest.spyOn(service.provider, 'createPayment')
    .mockResolvedValueOnce({ providerOrderId: 'order_razorpay_a', providerPaymentId: null, amount: 1, currency: 'INR' })
    .mockResolvedValueOnce({ providerOrderId: 'order_razorpay_b', providerPaymentId: null, amount: 1, currency: 'INR' });
  jest.spyOn(service, 'isRazorpayEnabled').mockReturnValue(true);
  jest.spyOn(Payment, 'findOne').mockResolvedValue(null);
  jest.spyOn(Payment, 'create')
    .mockResolvedValueOnce({ toObject: () => ({ orderId: 'order-product-a', providerOrderId: 'order_razorpay_a', status: 'PENDING' }) })
    .mockResolvedValueOnce({ toObject: () => ({ orderId: 'order-product-b', providerOrderId: 'order_razorpay_b', status: 'PENDING' }) });
  jest.spyOn(PaymentTransaction, 'create').mockResolvedValue({});

  const firstPayment = await service.createPayment({
    order: firstOrder,
    customerId: 'customer-1',
    amount: 1,
    provider: 'razorpay',
    idempotencyKey: 'checkout-a',
  });
  expect(firstPayment.providerOrderId).toBe('order_razorpay_a');

  const secondPayment = await service.createPayment({
    order: secondOrder,
    customerId: 'customer-1',
    amount: 1,
    provider: 'razorpay',
    idempotencyKey: 'checkout-b',
  });

  expect(secondPayment.providerOrderId).toBe('order_razorpay_b');
  expect(providerSpy).toHaveBeenCalledTimes(2);
});
