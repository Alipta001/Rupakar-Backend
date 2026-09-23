import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Order } from '../app/models/order.model.js';
import { getOrder } from '../app/controllers/order.controller.js';
import { orderService } from '../app/services/order.service.js';

const invoke = async (id, customerId, order) => {
  const json = jest.fn();
  const next = jest.fn();
  jest.spyOn(Order, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(order) });
  await getOrder({ params: { id }, user: { sub: customerId }, headers: {} }, { status: () => ({ json }) }, next);
  return { json, next };
};

describe('customer order detail lookup', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the selected Mongo order id for its owner', async () => {
    const result = await invoke('507f1f77bcf86cd799439011', 'customer-1', {
      _id: '507f1f77bcf86cd799439011', customerId: 'customer-1', status: 'CONFIRMED',
    });
    expect(result.next).not.toHaveBeenCalled();
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }));
  });

  it('supports public order number lookup for the authenticated owner', async () => {
    const result = await invoke('ORD-2026-ABC', 'customer-1', {
      _id: '507f1f77bcf86cd799439011', orderNumber: 'ORD-2026-ABC', customerId: 'customer-1',
    });
    expect(result.next).not.toHaveBeenCalled();
    expect(result.json).toHaveBeenCalled();
  });

  it('returns not found when another customer owns the order', async () => {
    const result = await invoke('507f1f77bcf86cd799439011', 'customer-2', null);
    expect(result.json).not.toHaveBeenCalled();
    expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'ORDER_NOT_FOUND' }));
  });

  it('aggregates the latest parent order status across vendor fulfillment steps', () => {
    const latest = orderService.calculateParentOrderStatus(['PROCESSING', 'PACKED', 'READY_TO_SHIP', 'SHIPPED']);
    expect(latest).toBe('SHIPPED');
  });
});
