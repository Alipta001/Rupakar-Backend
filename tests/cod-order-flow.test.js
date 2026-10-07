import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../app/jobs/queues.js', () => ({
  scheduleNotification: jest.fn().mockResolvedValue('notif-job-1'),
  scheduleEmail: jest.fn().mockResolvedValue('email-job-1'),
  scheduleInvoiceGeneration: jest.fn().mockResolvedValue('invoice-job-1'),
  schedulePackingSlipGeneration: jest.fn().mockResolvedValue('packing-slip-job-1'),
  scheduleVendorOrderPackReminder: jest.fn().mockResolvedValue('pack-reminder-job-1'),
  scheduleVendorOrderAutoCancel: jest.fn().mockResolvedValue('auto-cancel-job-1'),
}));

const { OrderService } = await import('../app/services/order.service.js');
const { PaymentService, paymentService } = await import('../app/services/payment.service.js');
const { Order } = await import('../app/models/order.model.js');
const { VendorOrder } = await import('../app/models/vendor-order.model.js');
const { Product } = await import('../app/models/product.model.js');
const { ProductVariant } = await import('../app/models/product-variant.model.js');
const { Inventory } = await import('../app/models/inventory.model.js');
const { inventoryReservationService } = await import('../app/services/inventory-reservation.service.js');
const { listVendorOrders } = await import('../app/controllers/order.controller.js');
const { packVendorOrder } = await import('../app/controllers/shipping.controller.js');
const { Vendor } = await import('../app/models/vendor.model.js');
const { Shipment } = await import('../app/models/shipment.model.js');
const { shippingService } = await import('../app/services/shipping.service.js');
const { orderService } = await import('../app/services/order.service.js');
const { notificationService } = await import('../app/services/notification.service.js');
const { vendorLedgerService } = await import('../app/services/vendor-ledger.service.js');

describe('COD Order Flow and Vendor Order Visibility', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('creates confirmed Order, consumes reservations, and generates VendorOrder records for single-vendor COD', async () => {
    const service = new OrderService();
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const paymentId = new mongoose.Types.ObjectId().toHexString();
    const vendorOrderId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Product, 'findOne').mockImplementation(() => {
      const doc = {
        _id: productId,
        name: 'Handcrafted Terracotta Vase',
        status: 'PUBLISHED',
        vendorId,
        images: [],
      };
      return {
        ...doc,
        populate: () => Promise.resolve(doc),
        then: (onFulfilled, onRejected) => Promise.resolve(doc).then(onFulfilled, onRejected),
      };
    });

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      sku: 'VASE-01',
      price: 1200,
      status: 'ACTIVE',
    });

    jest.spyOn(Inventory, 'findOne').mockResolvedValue({
      variantId,
      availableQuantity: 15,
    });

    const createdOrderData = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-2026-COD-001',
      status: 'CONFIRMED',
      paymentStatus: 'PENDING',
      paymentMethod: 'cod',
      items: [{
        productId,
        variantId,
        vendorId,
        productName: 'Handcrafted Terracotta Vase',
        sku: 'VASE-01',
        quantity: 1,
        unitPrice: 1200,
        lineTotal: 1200,
      }],
      subtotal: 1200,
      discount: 0,
      tax: 0,
      shipping: 0,
      total: 1200,
      currency: 'INR',
      vendorOrders: [],
    };

    jest.spyOn(Order, 'create').mockResolvedValue({
      ...createdOrderData,
      toObject: () => ({ ...createdOrderData }),
    });

    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ id: 'res-1' });
    const consumeSpy = jest.spyOn(inventoryReservationService, 'consumeOrderReservations').mockResolvedValue([]);

    jest.spyOn(paymentService, 'createPayment').mockResolvedValue({
      _id: paymentId,
      status: 'PENDING',
      method: 'cod',
    });

    const ensureSpy = jest.spyOn(paymentService, 'ensureCapturedOrderArtifacts').mockResolvedValue({
      vendorOrders: [vendorOrderId],
      skipped: false,
    });

    const result = await service.createOrder({
      customerId,
      items: [{ productId, variantId, quantity: 1 }],
      paymentMethod: 'cod',
    });

    expect(result.status).toBe('CONFIRMED');
    expect(result.paymentStatus).toBe('PENDING');
    expect(result.paymentMethod).toBe('cod');
    expect(consumeSpy).toHaveBeenCalledWith(expect.objectContaining({ orderId }));
    expect(ensureSpy).toHaveBeenCalledWith(orderId, paymentId, expect.objectContaining({ method: 'cod' }));
    expect(result.vendorOrders).toContain(vendorOrderId);
  });

  it('ensureCapturedOrderArtifacts creates VendorOrders for COD order even when paymentStatus is PENDING', async () => {
    const service = new PaymentService();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const paymentId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorOrderId = new mongoose.Types.ObjectId().toHexString();

    const orderDoc = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-2026-COD-002',
      paymentMethod: 'cod',
      status: 'CONFIRMED',
      paymentStatus: 'PENDING',
      currency: 'INR',
      items: [{
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        vendorId,
        productName: 'Clay Pot',
        sku: 'POT-1',
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000,
      }],
      subtotal: 1000,
      discount: 100,
      tax: 50,
      shipping: 50,
      total: 1000,
    };

    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(orderDoc),
    });

    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);
    const createVoSpy = jest.spyOn(VendorOrder, 'create').mockResolvedValue({
      _id: vendorOrderId,
      parentOrderId: orderId,
      vendorId,
      customerId,
      status: 'CONFIRMED',
      total: 1000,
    });
    jest.spyOn(Order, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(Vendor, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue([]);
    jest.spyOn(vendorLedgerService, 'recordCapturedPayment').mockResolvedValue({});

    const result = await service.ensureCapturedOrderArtifacts(orderId, paymentId, {
      _id: paymentId,
      status: 'PENDING',
      method: 'cod',
    });

    expect(result.skipped).toBe(false);
    expect(result.vendorOrders).toHaveLength(1);
    expect(createVoSpy).toHaveBeenCalledWith(expect.objectContaining({
      parentOrderId: orderId,
      vendorId,
      customerId,
      status: 'CONFIRMED',
    }));
  });

  it('allows seller to view their COD vendor orders in listVendorOrders', async () => {
    const vendorUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const vendorOrderId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: vendorUserId,
      status: 'APPROVED',
    });

    const mockVendorOrder = {
      _id: vendorOrderId,
      parentOrderId: orderId,
      vendorId,
      status: 'CONFIRMED',
      total: 1000,
      items: [{ productName: 'Clay Pot', quantity: 2, lineTotal: 1000 }],
    };

    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([mockVendorOrder]),
    });
    jest.spyOn(VendorOrder, 'countDocuments').mockResolvedValue(1);

    jest.spyOn(Order, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: orderId,
        paymentStatus: 'PENDING',
        status: 'CONFIRMED',
      }]),
    });

    const req = {
      user: { sub: vendorUserId },
      query: { page: '1', limit: '20' },
      headers: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await listVendorOrders(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            _id: vendorOrderId,
            status: 'CONFIRMED',
            parent: expect.objectContaining({
              paymentStatus: 'PENDING',
              status: 'CONFIRMED',
            }),
          }),
        ]),
      }),
    }));
  });

  it('enforces multi-vendor isolation for multi-vendor COD order', async () => {
    const sellerAUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorAId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const voAId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorAId,
      ownerUserId: sellerAUserId,
      status: 'APPROVED',
    });

    const findSpy = jest.spyOn(VendorOrder, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: voAId,
        parentOrderId: orderId,
        vendorId: vendorAId,
        status: 'CONFIRMED',
        total: 500,
      }]),
    });
    jest.spyOn(VendorOrder, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(Order, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: orderId,
        paymentStatus: 'PENDING',
        status: 'CONFIRMED',
      }]),
    });

    const req = {
      user: { sub: sellerAUserId },
      query: {},
      headers: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await listVendorOrders(req, res, () => {});

    expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: vendorAId,
      deletedAt: null,
    }));
    const returnedItems = res.json.mock.calls[0][0].data.items;
    expect(returnedItems).toHaveLength(1);
    expect(returnedItems[0].vendorId).toBe(vendorAId);
  });

  it('allows seller to pack a COD vendor order without requiring paymentStatus to be PAID', async () => {
    const vendorUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderId = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
    const vo = {
      _id: vendorOrderId,
      vendorId,
      parentOrderId,
      status: 'PROCESSING',
      save: jest.fn().mockResolvedValue(true),
      toObject: () => ({ _id: vendorOrderId, status: 'PACKED' }),
    };
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
    jest.spyOn(VendorOrder, 'findOneAndUpdate').mockResolvedValue(vo);
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...vo, status: 'PACKED' }),
    });

    // COD order has paymentStatus: 'PENDING' and paymentMethod: 'cod'
    jest.spyOn(Order, 'findById').mockReturnValue({
      _id: parentOrderId,
      paymentMethod: 'cod',
      paymentStatus: 'PENDING',
      lean: jest.fn().mockResolvedValue({ _id: parentOrderId, paymentMethod: 'cod', paymentStatus: 'PENDING' }),
      toObject: () => ({ _id: parentOrderId, paymentMethod: 'cod', paymentStatus: 'PENDING' }),
    });
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    const createdShipment = {
      _id: new mongoose.Types.ObjectId(),
      vendorOrderId,
      orderId: parentOrderId,
      status: 'PACKED',
      save: jest.fn().mockResolvedValue(true),
      toObject: () => ({ status: 'PACKED' }),
    };
    jest.spyOn(shippingService, 'createShipment').mockResolvedValue(createdShipment);

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await packVendorOrder(
      { params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} },
      res,
      (err) => { throw err; },
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: 'Order packed',
    }));
  });
});
