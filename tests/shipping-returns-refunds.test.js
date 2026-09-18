import mongoose from 'mongoose';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ShippingService } from '../app/services/shipping.service.js';
import { ShipmentStateService } from '../app/services/shipment-state.service.js';
import { ReturnEligibilityService } from '../app/services/return-eligibility.service.js';
import { RefundService } from '../app/services/refund.service.js';
import { Inventory } from '../app/models/inventory.model.js';
import { Order } from '../app/models/order.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { Payment } from '../app/models/payment.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { refundService } from '../app/services/refund.service.js';
import { paymentService } from '../app/services/payment.service.js';

describe('shipping and return workflows', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('creates vendor shipments idempotently and validates shipment status transitions', async () => {
    const service = new ShippingService();
    const shipmentId = new mongoose.Types.ObjectId().toHexString();
    const vendorOrderId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockResolvedValue({
      _id: shipmentId,
      orderId: new mongoose.Types.ObjectId().toHexString(),
      vendorOrderId,
      vendorId: new mongoose.Types.ObjectId().toHexString(),
      customerId: new mongoose.Types.ObjectId().toHexString(),
      shipmentNumber: 'SHIP-1',
      status: 'PENDING',
      toObject: () => ({
        _id: shipmentId,
        shipmentNumber: 'SHIP-1',
        status: 'PENDING',
      }),
    });

    const created = await service.createShipment({
      orderId: new mongoose.Types.ObjectId().toHexString(),
      vendorOrderId,
      vendorId: new mongoose.Types.ObjectId().toHexString(),
      customerId: new mongoose.Types.ObjectId().toHexString(),
      shippingMethod: 'standard',
      carrier: 'mock-carrier',
    });

    expect(created.status).toBe('PENDING');

    const stateService = new ShipmentStateService();
    await expect(stateService.transitionShipmentStatus('PENDING', 'SHIPPED')).resolves.toMatchObject({ nextStatus: 'SHIPPED' });
    await expect(stateService.transitionShipmentStatus('PENDING', 'DELIVERED')).rejects.toMatchObject({ code: 'INVALID_SHIPMENT_TRANSITION' });
  });

  it('allows returns only for delivered, owned orders and valid quantities', async () => {
    const service = new ReturnEligibilityService();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      items: [{ productId: new mongoose.Types.ObjectId().toHexString(), variantId, quantity: 2, unitPrice: 250, lineTotal: 500 }],
    });

    const allowed = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId, quantity: 1 }],
    });

    expect(allowed.allowed).toBe(true);

    await expect(service.canRequestReturn({
      customerId: new mongoose.Types.ObjectId().toHexString(),
      orderId,
      items: [{ variantId, quantity: 1 }],
    })).resolves.toMatchObject({ allowed: false });
  });

  it('calculates refunds from immutable order snapshots and prevents duplicates', async () => {
    const service = new RefundService();
    const order = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      total: 2000,
      subtotal: 1800,
      discount: 100,
      tax: 300,
      items: [{ productId: new mongoose.Types.ObjectId().toHexString(), variantId: new mongoose.Types.ObjectId().toHexString(), quantity: 2, unitPrice: 900, lineTotal: 1800 }],
    };

    const refund = await service.calculateRefund({
      order,
      returnItems: [{ variantId: order.items[0].variantId, quantity: 1, unitPrice: 900, lineTotal: 900 }],
    });

    expect(refund.amount).toBe(900);
    expect(refund.currency).toBe('INR');
    expect(service.isDuplicateRefund({ orderId: order._id, returnId: 'ret-1', refundKey: 'dup' })).toBe(false);
  });

  it('restocks inventory only after an accepted return inspection', async () => {
    const service = new RefundService();
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue({
      _id: 'inventory-1',
      availableQuantity: 12,
      reservedQuantity: 0,
    });

    const result = await service.applyRestock({
      variantId: new mongoose.Types.ObjectId().toHexString(),
      quantity: 2,
      inspectedStatus: 'APPROVED_FOR_REFUND',
    });

    expect(result).toMatchObject({ restocked: true, quantity: 2 });
  });

  it('marks full and partial Razorpay refunds as pending without inventing payout rules', async () => {
    const payment = { _id: 'payment-1', provider: 'razorpay', providerPaymentId: 'pay-1', amount: 1000, status: 'CAPTURED', save: jest.fn().mockResolvedValue(true) };
    jest.spyOn(Payment, 'findById').mockResolvedValue(payment);
    jest.spyOn(paymentService.provider, 'refundPayment').mockResolvedValue({ id: 'refund-1', status: 'processed' });
    jest.spyOn(Order, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn((await import('../app/models/refund.model.js')).Refund, 'create').mockImplementation(async (payload) => ({ toObject: () => payload }));

    const full = await refundService.createRefund({ refundData: { orderId: 'order-1', paymentId: 'payment-1', customerId: 'customer-1', vendorId: 'vendor-1', amount: 1000 } });
    expect(full.status).toBe('PROCESSING');
    expect(payment.status).toBe('REFUND_PENDING');
    expect(Order.updateOne).toHaveBeenCalledWith({ _id: 'order-1' }, { $set: { status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING' } });

    refundService.duplicateRefunds.clear();
    payment.status = 'CAPTURED';
    const partial = await refundService.createRefund({ refundData: { orderId: 'order-1', paymentId: 'payment-1', customerId: 'customer-1', vendorId: 'vendor-1', amount: 400, returnId: 'return-partial' } });
    expect(partial.status).toBe('PROCESSING');
  });
});
