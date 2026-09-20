import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { listVendorOrders, getVendorOrder } from '../app/controllers/order.controller.js';
import { packVendorOrder } from '../app/controllers/shipping.controller.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Order } from '../app/models/order.model.js';

const response = () => {
  const json = jest.fn();
  return { response: { status: () => ({ json }) }, json, next: jest.fn() };
};

afterEach(() => jest.restoreAllMocks());

describe('seller order access', () => {
  it('lists only the authenticated approved vendor orders with parent payment context', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: 'vendor-a', ownerUserId: 'user-a', status: 'APPROVED' });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({ sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: 'vendor-order-a', vendorId: 'vendor-a', parentOrderId: 'order-a', items: [{ sku: 'SKU-A' }] }]) });
    jest.spyOn(VendorOrder, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(Order, 'find').mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: 'order-a', paymentStatus: 'PAID', status: 'CONFIRMED', shippingAddressSnapshot: { city: 'Kolkata' } }]) });
    const result = response();

    await listVendorOrders({ user: { sub: 'user-a' }, query: { page: '1', limit: '20' }, headers: {} }, result.response, result.next);

    expect(result.next).not.toHaveBeenCalled();
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ total: 1, items: [expect.objectContaining({ vendorId: 'vendor-a', parent: expect.objectContaining({ paymentStatus: 'PAID' }) })] }) }));
  });

  it('rejects non-approved vendors', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(null);
    const result = response();

    await listVendorOrders({ user: { sub: 'user-a' }, query: {}, headers: {} }, result.response, result.next);

    expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VENDOR_ACCESS_DENIED' }));
  });

  it('cannot view another vendor order', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: 'vendor-a', ownerUserId: 'user-a', status: 'APPROVED' });
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const result = response();

    await getVendorOrder({ user: { sub: 'user-a' }, params: { id: 'vendor-order-b' }, headers: {} }, result.response, result.next);

    expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VENDOR_ORDER_NOT_FOUND' }));
  });

  it('cannot pack an unpaid or pending vendor order', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: 'vendor-a', ownerUserId: 'user-a', status: 'APPROVED' });
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({ _id: 'vendor-order-a', vendorId: 'vendor-a', parentOrderId: 'order-a', status: 'PENDING_PAYMENT' });
    jest.spyOn(Order, 'findById').mockResolvedValue({ _id: 'order-a', paymentStatus: 'PENDING' });
    const result = response();

    await packVendorOrder({ user: { sub: 'user-a' }, params: { id: 'vendor-order-a' }, headers: {} }, result.response, result.next);

    expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_VENDOR_ORDER_TRANSITION' }));
  });
});
