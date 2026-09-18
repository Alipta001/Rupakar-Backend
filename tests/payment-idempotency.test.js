import { jest, expect, it, afterEach } from '@jest/globals';
import { Payment } from '../app/models/payment.model.js';
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
