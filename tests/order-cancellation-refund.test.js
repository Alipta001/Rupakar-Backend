import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { orderService } from '../app/services/order.service.js';
import { cancellationService } from '../app/services/cancellation.service.js';
import { refundService } from '../app/services/refund.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Payment } from '../app/models/payment.model.js';
import { CancellationRequest } from '../app/models/cancellation-request.model.js';
import { OrderStatusHistory } from '../app/models/order-status-history.model.js';

describe('Order Cancellation & Refund Regression Tests', () => {
  const orderId = new mongoose.Types.ObjectId().toHexString();
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const vendorId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorId2 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId2 = new mongoose.Types.ObjectId().toHexString();
  const paymentId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    refundService.duplicateRefunds.clear();
  });

  it('cancels an order with CAPTURED payment without throwing CAPTURED -> CANCELLED transition error', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      items: [
        { variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 },
        { variantId: variantId2, quantity: 2, unitPrice: 300, lineTotal: 600 },
      ],
      total: 1100,
      toObject: () => ({ _id: orderId, customerId, status: 'CONFIRMED', paymentStatus: 'PAID' }),
    };

    const mockVendorOrders = [
      {
        _id: new mongoose.Types.ObjectId().toHexString(),
        parentOrderId: orderId,
        vendorId: vendorId1,
        total: 500,
        status: 'CONFIRMED',
        inventoryDecremented: false,
        items: [{ variantId: variantId1, quantity: 1 }],
        save: jest.fn().mockResolvedValue(true),
      },
      {
        _id: new mongoose.Types.ObjectId().toHexString(),
        parentOrderId: orderId,
        vendorId: vendorId2,
        total: 600,
        status: 'CONFIRMED',
        inventoryDecremented: false,
        items: [{ variantId: variantId2, quantity: 2 }],
        save: jest.fn().mockResolvedValue(true),
      },
    ];

    const mockPayment = {
      _id: paymentId,
      orderId,
      status: 'CAPTURED',
      amount: 1100,
      provider: 'mock',
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(OrderStatusHistory, 'create').mockResolvedValue({ _id: 'history-1' });
    jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ status: 'RELEASED' });
    jest.spyOn(VendorOrder, 'find').mockResolvedValue(mockVendorOrders);
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(paymentService, 'getPaymentForOrder').mockResolvedValue(mockPayment);
    jest.spyOn(paymentService, 'transitionPaymentStatus').mockResolvedValue(true);
    jest.spyOn(refundService, 'createRefund').mockResolvedValue({ _id: 'refund-1', status: 'PROCESSING' });
    jest.spyOn(Order, 'findByIdAndUpdate').mockImplementation((id, update) => {
      return Promise.resolve({
        _id: orderId,
        status: update.$set.status,
        paymentStatus: update.$set.paymentStatus,
        toObject: () => ({
          _id: orderId,
          status: update.$set.status,
          paymentStatus: update.$set.paymentStatus,
        }),
      });
    });

    const result = await orderService.cancelOrder({
      orderId,
      customerId,
      reason: 'Customer cancelled',
      actorType: 'CUSTOMER',
      actorId: customerId,
    });

    // Payment transition must be to REFUND_PENDING, never CANCELLED
    expect(paymentService.transitionPaymentStatus).toHaveBeenCalledWith(
      'CAPTURED',
      'REFUND_PENDING',
      expect.objectContaining({ paymentId, orderId })
    );
    expect(paymentService.transitionPaymentStatus).not.toHaveBeenCalledWith(
      'CAPTURED',
      'CANCELLED',
      expect.anything()
    );

    // Refund service must be called for each vendor order
    expect(refundService.createRefund).toHaveBeenCalledTimes(2);
    expect(refundService.createRefund).toHaveBeenCalledWith(expect.objectContaining({
      refundData: expect.objectContaining({
        orderId,
        vendorOrderId: mockVendorOrders[0]._id,
        amount: 500,
        isCancellation: true,
      }),
    }));
    expect(refundService.createRefund).toHaveBeenCalledWith(expect.objectContaining({
      refundData: expect.objectContaining({
        orderId,
        vendorOrderId: mockVendorOrders[1]._id,
        amount: 600,
        isCancellation: true,
      }),
    }));

    // Order status must be CANCELLED and paymentStatus must be REFUND_PENDING
    expect(result.status).toBe('CANCELLED');
    expect(result.paymentStatus).toBe('REFUND_PENDING');
  });

  it('prevents duplicate cancellations and returns idempotently', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'CANCELLED',
      paymentStatus: 'REFUND_PENDING',
      toObject: () => ({ _id: orderId, customerId, status: 'CANCELLED', paymentStatus: 'REFUND_PENDING' }),
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    const refundSpy = jest.spyOn(refundService, 'createRefund');

    const result = await orderService.cancelOrder({
      orderId,
      customerId,
      reason: 'Customer cancelled again',
      actorType: 'CUSTOMER',
      actorId: customerId,
    });

    expect(result.status).toBe('CANCELLED');
    expect(result.paymentStatus).toBe('REFUND_PENDING');
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('restores inventory exactly once when inventoryDecremented is true on vendor order', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'CONFIRMED',
      paymentStatus: 'PENDING',
      items: [{ variantId: variantId1, quantity: 3 }],
      toObject: () => ({ _id: orderId, status: 'CONFIRMED' }),
    };

    const voSaveMock = jest.fn().mockResolvedValue(true);
    const mockVendorOrder = {
      _id: 'vo-decremented',
      parentOrderId: orderId,
      vendorId: vendorId1,
      inventoryDecremented: true,
      items: [{ variantId: variantId1, quantity: 3 }],
      save: voSaveMock,
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(OrderStatusHistory, 'create').mockResolvedValue({ _id: 'history-1' });
    jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue(null);
    jest.spyOn((await import('../app/models/inventory-reservation.model.js')).InventoryReservation, 'findOne').mockResolvedValue(null);
    const increaseStockSpy = jest.spyOn(inventoryService, 'increaseStock').mockResolvedValue({ success: true });
    jest.spyOn(VendorOrder, 'find').mockResolvedValue([mockVendorOrder]);
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(paymentService, 'getPaymentForOrder').mockResolvedValue(null);
    jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({ _id: orderId, status: 'CANCELLED', paymentStatus: 'CANCELLED' });

    await orderService.cancelOrder({
      orderId,
      customerId,
      reason: 'Cancel order',
      actorType: 'CUSTOMER',
      actorId: customerId,
    });

    // Exactly one increaseStock call for the 3 units
    expect(increaseStockSpy).toHaveBeenCalledTimes(1);
    expect(increaseStockSpy).toHaveBeenCalledWith(variantId1, 3, expect.objectContaining({
      referenceType: 'ORDER_CANCELLED',
    }));

    // Vendor order inventoryDecremented must now be false and saved
    expect(mockVendorOrder.inventoryDecremented).toBe(false);
    expect(voSaveMock).toHaveBeenCalled();
  });

  it('approving cancellation request for one vendor does not cancel sibling vendor orders', async () => {
    const requestId = new mongoose.Types.ObjectId().toHexString();
    const vo1Id = new mongoose.Types.ObjectId().toHexString();
    const vo2Id = new mongoose.Types.ObjectId().toHexString();

    const mockRequest = {
      _id: requestId,
      vendorOrderId: vo1Id,
      orderId,
      vendorId: vendorId1,
      variantId: variantId1,
      quantity: 1,
      refundAmount: 500,
      reason: 'Damaged item',
      status: 'PENDING',
      save: jest.fn().mockResolvedValue(true),
      toObject: function() { return { ...this }; },
    };

    const mockVo1 = {
      _id: vo1Id,
      parentOrderId: orderId,
      vendorId: vendorId1,
      status: 'CONFIRMED',
      items: [{ variantId: variantId1, quantity: 1 }],
      inventoryDecremented: false,
      save: jest.fn().mockResolvedValue(true),
    };

    const mockVo2 = {
      _id: vo2Id,
      parentOrderId: orderId,
      vendorId: vendorId2,
      status: 'CONFIRMED',
      items: [{ variantId: variantId2, quantity: 2 }],
      inventoryDecremented: false,
      save: jest.fn().mockResolvedValue(true),
    };

    const mockParentOrder = {
      _id: orderId,
      customerId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(CancellationRequest, 'findById').mockResolvedValue(mockRequest);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVo1);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockParentOrder);
    jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ status: 'RELEASED' });
    jest.spyOn(Payment, 'findOne').mockResolvedValue(null);
    jest.spyOn(CancellationRequest, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockRequest]) }); // all approved for vo1
    jest.spyOn(VendorOrder, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockVo1, mockVo2]) }); // sibling check
    jest.spyOn(cancellationService, 'notifyPartiesApproval').mockResolvedValue(true);

    await cancellationService.approveRequest({
      requestId,
      vendorId: vendorId1,
      reviewerUserId: 'seller-user-1',
    });

    // vo1 becomes CANCELLED because its only item was approved
    expect(mockVo1.status).toBe('CANCELLED');
    // vo2 (sibling) must remain CONFIRMED
    expect(mockVo2.status).toBe('CONFIRMED');
    // Parent order must NOT be CANCELLED because sibling vo2 is still active
    expect(mockParentOrder.status).toBe('CONFIRMED');
    expect(mockParentOrder.paymentStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('cancels order safely when payment is a plain object without .save() method (production bug reproduction)', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      items: [{ variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
      total: 500,
      toObject: () => ({ _id: orderId, customerId, status: 'CONFIRMED', paymentStatus: 'PAID' }),
    };

    const mockVendorOrder = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      parentOrderId: orderId,
      vendorId: vendorId1,
      total: 500,
      status: 'CONFIRMED',
      inventoryDecremented: false,
      items: [{ variantId: variantId1, quantity: 1 }],
      save: jest.fn().mockResolvedValue(true),
    };

    // Plain JS object simulating what paymentService.getPaymentForOrder returns via .toObject()
    const plainPayment = {
      _id: paymentId,
      orderId,
      status: 'CAPTURED',
      amount: 500,
      provider: 'mock',
      // Explicitly NO save property: save is undefined
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(OrderStatusHistory, 'create').mockResolvedValue({ _id: 'history-1' });
    jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ status: 'RELEASED' });
    jest.spyOn(VendorOrder, 'find').mockResolvedValue([mockVendorOrder]);
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(paymentService, 'getPaymentForOrder').mockResolvedValue(plainPayment);
    jest.spyOn(paymentService, 'transitionPaymentStatus').mockResolvedValue(true);
    const paymentUpdateSpy = jest.spyOn(Payment, 'findByIdAndUpdate').mockResolvedValue({ _id: paymentId, status: 'REFUND_PENDING' });
    jest.spyOn(refundService, 'createRefund').mockResolvedValue({ _id: 'refund-1', status: 'PROCESSING' });
    jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({ _id: orderId, status: 'CANCELLED', paymentStatus: 'REFUND_PENDING' });

    const result = await orderService.cancelOrder({
      orderId,
      customerId,
      reason: 'Testing POJO payment handling',
      actorType: 'CUSTOMER',
      actorId: customerId,
    });

    expect(result.status).toBe('CANCELLED');
    expect(paymentUpdateSpy).toHaveBeenCalledWith(paymentId, { $set: { status: 'REFUND_PENDING' } });
  });

  it('fails with 502 REFUND_FAILED and aborts cancellation when refund provider fails', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      items: [{ variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
      total: 500,
      toObject: () => ({ _id: orderId, customerId, status: 'CONFIRMED', paymentStatus: 'PAID' }),
    };

    const mockVendorOrder = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      parentOrderId: orderId,
      vendorId: vendorId1,
      total: 500,
      status: 'CONFIRMED',
      inventoryDecremented: false,
      items: [{ variantId: variantId1, quantity: 1 }],
      save: jest.fn().mockResolvedValue(true),
    };

    const mockPayment = {
      _id: paymentId,
      orderId,
      status: 'CAPTURED',
      amount: 500,
      provider: 'mock',
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(OrderStatusHistory, 'create').mockResolvedValue({ _id: 'history-1' });
    jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ status: 'RELEASED' });
    jest.spyOn(VendorOrder, 'find').mockResolvedValue([mockVendorOrder]);
    jest.spyOn(paymentService, 'getPaymentForOrder').mockResolvedValue(mockPayment);
    jest.spyOn(paymentService, 'transitionPaymentStatus').mockResolvedValue(true);
    jest.spyOn(Payment, 'findByIdAndUpdate').mockResolvedValue({ _id: paymentId, status: 'REFUND_PENDING' });
    const orderUpdateSpy = jest.spyOn(Order, 'findByIdAndUpdate');

    // Refund provider failure
    const { AppError } = await import('../app/utils/app-error.js');
    jest.spyOn(refundService, 'createRefund').mockRejectedValue(
      new AppError(502, 'REFUND_FAILED', "We couldn't complete the refund yet. Your order has not been cancelled. Please try again.")
    );

    await expect(
      orderService.cancelOrder({
        orderId,
        customerId,
        reason: 'Customer cancelled',
        actorType: 'CUSTOMER',
        actorId: customerId,
      })
    ).rejects.toThrow("We couldn't complete the refund yet");

    // Order status must NOT have been changed to CANCELLED in DB
    expect(orderUpdateSpy).not.toHaveBeenCalled();
  });

  it('rejects cancellation with 409 ORDER_ALREADY_PACKED when vendor order is already PACKED', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      items: [{ variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
      total: 500,
      toObject: () => ({ _id: orderId, customerId, status: 'PROCESSING', paymentStatus: 'PAID' }),
    };

    const mockVendorOrder = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      parentOrderId: orderId,
      vendorId: vendorId1,
      total: 500,
      status: 'PACKED', // Already packed!
      inventoryDecremented: false,
      items: [{ variantId: variantId1, quantity: 1 }],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'find').mockResolvedValue([mockVendorOrder]);

    await expect(
      orderService.cancelOrder({
        orderId,
        customerId,
        reason: 'Customer cancelled',
        actorType: 'CUSTOMER',
        actorId: customerId,
      })
    ).rejects.toThrow('This order can no longer be cancelled because it has already been packed');
  });

  it('cancels uncaptured payment cleanly without invoking refundService', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      items: [{ variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
      total: 500,
      toObject: () => ({ _id: orderId, customerId, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' }),
    };

    const mockVendorOrder = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      parentOrderId: orderId,
      vendorId: vendorId1,
      total: 500,
      status: 'PENDING_PAYMENT',
      inventoryDecremented: false,
      items: [{ variantId: variantId1, quantity: 1 }],
      save: jest.fn().mockResolvedValue(true),
    };

    const uncapturedPayment = {
      _id: paymentId,
      orderId,
      status: 'CREATED',
      amount: 500,
      provider: 'mock',
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(OrderStatusHistory, 'create').mockResolvedValue({ _id: 'history-1' });
    jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ status: 'RELEASED' });
    jest.spyOn(VendorOrder, 'find').mockResolvedValue([mockVendorOrder]);
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(paymentService, 'getPaymentForOrder').mockResolvedValue(uncapturedPayment);
    const transitionSpy = jest.spyOn(paymentService, 'transitionPaymentStatus').mockResolvedValue(true);
    jest.spyOn(Payment, 'findByIdAndUpdate').mockResolvedValue({ _id: paymentId, status: 'CANCELLED' });
    const refundSpy = jest.spyOn(refundService, 'createRefund');
    jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({ _id: orderId, status: 'CANCELLED', paymentStatus: 'CANCELLED' });

    const result = await orderService.cancelOrder({
      orderId,
      customerId,
      reason: 'Changed my mind',
      actorType: 'CUSTOMER',
      actorId: customerId,
    });

    expect(result.status).toBe('CANCELLED');
    expect(transitionSpy).toHaveBeenCalledWith('CREATED', 'CANCELLED', expect.anything());
    expect(refundSpy).not.toHaveBeenCalled();
  });
});

