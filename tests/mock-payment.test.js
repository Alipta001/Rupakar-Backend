import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../app/config/env.js';
import { Payment } from '../app/models/payment.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Cart } from '../app/models/cart.model.js';
import { paymentService } from '../app/services/payment.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';

const makePayment = (status = 'PENDING') => ({
  _id: 'payment-1',
  orderId: 'order-1',
  customerId: 'customer-1',
  provider: 'mock',
  status,
});

const setupPendingMocks = () => {
  jest.spyOn(Payment, 'findOne').mockResolvedValue(makePayment());
  jest.spyOn(Payment, 'findOneAndUpdate').mockResolvedValue({});
  jest.spyOn(Order, 'updateOne').mockResolvedValue({ acknowledged: true });
  jest.spyOn(Order, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue({ items: [{ variantId: 'variant-1' }] }) });
  jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
  jest.spyOn(Cart, 'updateOne').mockResolvedValue({ acknowledged: true });
  jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ status: 'RELEASED' });
  jest.spyOn(inventoryReservationService, 'consumeOrderReservations').mockResolvedValue([]);
  jest.spyOn(inventoryReservationService, 'releaseOrderReservations').mockResolvedValue([]);
  jest.spyOn(paymentService, 'transitionPaymentStatus').mockResolvedValue({});
};

describe('local mock payments', () => {
  afterEach(() => {
    env.PAYMENT_MOCK_ENABLED = false;
    jest.restoreAllMocks();
  });

  it.each([
    ['success', 'CAPTURED', 'PAID', 'CONFIRMED'],
    ['failure', 'FAILED', 'FAILED', 'FAILED'],
    ['cancel', 'CANCELLED', 'CANCELLED', 'CANCELLED'],
  ])('simulates %s through backend status transitions', async (outcome, status, paymentStatus, orderStatus) => {
    env.PAYMENT_MOCK_ENABLED = true;
    setupPendingMocks();

    const result = await paymentService.simulateMockPayment({
      orderId: 'order-1',
      customerId: 'customer-1',
      outcome,
    });

    expect(result).toMatchObject({ outcome, status, paymentStatus, orderStatus, duplicate: false });
    expect(paymentService.transitionPaymentStatus).toHaveBeenCalledWith('PENDING', status, expect.any(Object));
    expect(Order.updateOne).toHaveBeenCalledWith(
      { _id: 'order-1', customerId: 'customer-1' },
      { $set: { status: orderStatus, paymentStatus } },
    );
    if (outcome !== 'success') expect(inventoryReservationService.releaseOrderReservations).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1' }));
    if (outcome === 'success') expect(inventoryReservationService.consumeOrderReservations).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1' }));
  });

  it('returns the existing terminal result for a repeated simulation request', async () => {
    env.PAYMENT_MOCK_ENABLED = true;
    jest.spyOn(Payment, 'findOne').mockResolvedValue(makePayment('CAPTURED'));
    const transitionSpy = jest.spyOn(paymentService, 'transitionPaymentStatus');

    const result = await paymentService.simulateMockPayment({
      orderId: 'order-1',
      customerId: 'customer-1',
      outcome: 'success',
    });

    expect(result).toEqual({ outcome: 'success', status: 'CAPTURED', duplicate: true });
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it('is unavailable when the local flag is disabled', async () => {
    await expect(paymentService.simulateMockPayment({
      orderId: 'order-1',
      customerId: 'customer-1',
      outcome: 'success',
    })).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });
});
