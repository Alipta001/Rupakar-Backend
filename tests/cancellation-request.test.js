import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cancellationService } from '../app/services/cancellation.service.js';
import { CancellationRequest } from '../app/models/cancellation-request.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Payment } from '../app/models/payment.model.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { refundService } from '../app/services/refund.service.js';

describe('Customer Cancellation Request & Seller Approval Workflow', () => {
  const customerId = new mongoose.Types.ObjectId();
  const unauthorizedCustomerId = new mongoose.Types.ObjectId();
  const parentOrderId = new mongoose.Types.ObjectId();
  const vendorId1 = new mongoose.Types.ObjectId();
  const unauthorizedVendorId = new mongoose.Types.ObjectId();
  const vendorUserId1 = new mongoose.Types.ObjectId();
  const vendorOrderId1 = new mongoose.Types.ObjectId();
  const productId1 = new mongoose.Types.ObjectId();
  const variantId1 = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const requestId1 = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('createRequest', () => {
    it('creates cancellation request with PENDING status and notifies vendor', async () => {
      const mockOrder = {
        _id: parentOrderId,
        orderNumber: 'RUP-1001',
        customerId,
        status: 'CONFIRMED',
        items: [
          {
            productId: productId1,
            variantId: variantId1,
            vendorId: vendorId1,
            productName: 'Clay Vase',
            sku: 'CLAY-VASE-01',
            quantity: 2,
            unitPrice: 500,
            lineTotal: 1000,
          },
        ],
      };

      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
      };

      jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockVendorOrder);
      jest.spyOn(CancellationRequest, 'findOne').mockResolvedValue(null);

      const createdDoc = {
        _id: requestId1,
        requestNumber: 'CAN-12345',
        orderId: parentOrderId,
        vendorOrderId: vendorOrderId1,
        customerId,
        vendorId: vendorId1,
        productId: productId1,
        variantId: variantId1,
        productName: 'Clay Vase',
        sku: 'CLAY-VASE-01',
        quantity: 2,
        unitPrice: 500,
        refundAmount: 1000,
        reason: 'Ordered by mistake',
        status: 'PENDING',
        toObject: () => ({ ...createdDoc }),
      };
      jest.spyOn(CancellationRequest, 'create').mockResolvedValue(createdDoc);
      jest.spyOn(cancellationService, 'notifyVendorNewRequest').mockResolvedValue(true);

      const result = await cancellationService.createRequest({
        customerId,
        orderId: parentOrderId,
        variantId: variantId1,
        quantity: 2,
        reason: 'Ordered by mistake',
        customerNote: 'Accidentally ordered two',
      });

      expect(result.status).toBe('PENDING');
      expect(result.refundAmount).toBe(1000);
      expect(CancellationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
        orderId: parentOrderId,
        vendorId: vendorId1,
        variantId: variantId1,
        reason: 'Ordered by mistake',
        status: 'PENDING',
      }));
      expect(cancellationService.notifyVendorNewRequest).toHaveBeenCalled();
    });

    it('rejects creation if customer does not own the order', async () => {
      const mockOrder = {
        _id: parentOrderId,
        customerId,
        status: 'CONFIRMED',
      };
      jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);

      await expect(
        cancellationService.createRequest({
          customerId: unauthorizedCustomerId,
          orderId: parentOrderId,
          variantId: variantId1,
          reason: 'Ordered by mistake',
        }),
      ).rejects.toThrow('You do not own this order');
    });

    it('prevents duplicate pending requests for the same item', async () => {
      const mockOrder = {
        _id: parentOrderId,
        customerId,
        status: 'CONFIRMED',
        items: [{ productId: productId1, variantId: variantId1, vendorId: vendorId1, quantity: 1, unitPrice: 500 }],
      };
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
      };

      jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockVendorOrder);
      jest.spyOn(CancellationRequest, 'findOne').mockResolvedValue({ _id: new mongoose.Types.ObjectId(), status: 'PENDING' });

      await expect(
        cancellationService.createRequest({
          customerId,
          orderId: parentOrderId,
          variantId: variantId1,
          reason: 'Found cheaper elsewhere',
        }),
      ).rejects.toThrow('A cancellation request is already pending for this item');
    });

    it('rejects cancellation if order or vendor order is already shipped/delivered', async () => {
      const mockOrder = {
        _id: parentOrderId,
        customerId,
        status: 'CONFIRMED',
        items: [{ productId: productId1, variantId: variantId1, vendorId: vendorId1, quantity: 1, unitPrice: 500 }],
      };
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'SHIPPED',
      };

      jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockVendorOrder);

      await expect(
        cancellationService.createRequest({
          customerId,
          orderId: parentOrderId,
          variantId: variantId1,
          reason: 'Found cheaper elsewhere',
        }),
      ).rejects.toThrow('cannot be cancelled');
    });
  });

  describe('approveRequest (Seller approval & Real refund)', () => {
    it('approves request, restores inventory, initiates real refund, and isolates vendor orders', async () => {
      const mockRequest = {
        _id: requestId1,
        orderId: parentOrderId,
        vendorOrderId: vendorOrderId1,
        customerId,
        vendorId: vendorId1,
        productId: productId1,
        variantId: variantId1,
        productName: 'Clay Vase',
        quantity: 1,
        refundAmount: 500,
        reason: 'Ordered by mistake',
        status: 'PENDING',
        save: jest.fn().mockResolvedValue(true),
        toObject: function () { return this; },
      };

      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
        inventoryDecremented: true,
        items: [{ productId: productId1, variantId: variantId1, quantity: 1 }],
        save: jest.fn().mockResolvedValue(true),
      };

      const mockParentOrder = {
        _id: parentOrderId,
        orderNumber: 'RUP-1001',
        customerId,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        save: jest.fn().mockResolvedValue(true),
      };

      const mockPayment = {
        _id: paymentId,
        orderId: parentOrderId,
        status: 'CAPTURED',
      };

      jest.spyOn(CancellationRequest, 'findById').mockResolvedValue(mockRequest);
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Order, 'findById').mockResolvedValue(mockParentOrder);
      jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
      jest.spyOn(inventoryService, 'increaseStock').mockResolvedValue({ success: true });
      jest.spyOn(refundService, 'createRefund').mockResolvedValue({ _id: new mongoose.Types.ObjectId(), status: 'PROCESSING' });

      // Sibling vendor orders
      jest.spyOn(CancellationRequest, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ vendorOrderId: vendorOrderId1, variantId: variantId1, status: 'APPROVED' }]),
      });
      jest.spyOn(VendorOrder, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: vendorOrderId1, status: 'CANCELLED' }]),
      });
      jest.spyOn(cancellationService, 'notifyPartiesApproval').mockResolvedValue(true);

      const result = await cancellationService.approveRequest({
        requestId: requestId1,
        vendorId: vendorId1,
        reviewerUserId: vendorUserId1,
      });

      expect(result.request.status).toBe('APPROVED');
      expect(mockRequest.status).toBe('APPROVED');
      expect(mockRequest.save).toHaveBeenCalled();
      expect(inventoryService.increaseStock).toHaveBeenCalledWith(variantId1, 1, expect.any(Object));
      expect(refundService.createRefund).toHaveBeenCalledWith(expect.objectContaining({
        refundData: expect.objectContaining({
          orderId: parentOrderId,
          vendorOrderId: vendorOrderId1,
          paymentId,
          amount: 500,
        }),
      }));
      expect(mockVendorOrder.status).toBe('CANCELLED');
      expect(mockParentOrder.status).toBe('CANCELLED');
      expect(cancellationService.notifyPartiesApproval).toHaveBeenCalled();
    });

    it('enforces vendor isolation: rejects approval from non-owner vendor', async () => {
      const mockRequest = {
        _id: requestId1,
        vendorId: vendorId1,
        status: 'PENDING',
      };
      jest.spyOn(CancellationRequest, 'findById').mockResolvedValue(mockRequest);

      await expect(
        cancellationService.approveRequest({
          requestId: requestId1,
          vendorId: unauthorizedVendorId,
          reviewerUserId: new mongoose.Types.ObjectId(),
        }),
      ).rejects.toThrow('You do not own this cancellation request');
    });

    it('rejects approval if request is not PENDING', async () => {
      const mockRequest = {
        _id: requestId1,
        vendorId: vendorId1,
        status: 'APPROVED',
      };
      jest.spyOn(CancellationRequest, 'findById').mockResolvedValue(mockRequest);

      await expect(
        cancellationService.approveRequest({
          requestId: requestId1,
          vendorId: vendorId1,
          reviewerUserId: vendorUserId1,
        }),
      ).rejects.toThrow('Cancellation request is already APPROVED');
    });
  });

  describe('rejectRequest (Seller rejection)', () => {
    it('rejects cancellation request, keeps order active, and notifies customer', async () => {
      const mockRequest = {
        _id: requestId1,
        vendorId: vendorId1,
        productName: 'Clay Vase',
        status: 'PENDING',
        save: jest.fn().mockResolvedValue(true),
        toObject: function () { return this; },
      };

      jest.spyOn(CancellationRequest, 'findById').mockResolvedValue(mockRequest);
      jest.spyOn(cancellationService, 'notifyCustomerRejection').mockResolvedValue(true);

      const result = await cancellationService.rejectRequest({
        requestId: requestId1,
        vendorId: vendorId1,
        reviewerUserId: vendorUserId1,
        rejectionReason: 'Item is already in packaging phase',
      });

      expect(result.status).toBe('REJECTED');
      expect(mockRequest.status).toBe('REJECTED');
      expect(mockRequest.rejectionReason).toBe('Item is already in packaging phase');
      expect(mockRequest.save).toHaveBeenCalled();
      expect(cancellationService.notifyCustomerRejection).toHaveBeenCalled();
    });

    it('enforces vendor isolation on rejection', async () => {
      const mockRequest = {
        _id: requestId1,
        vendorId: vendorId1,
        status: 'PENDING',
      };
      jest.spyOn(CancellationRequest, 'findById').mockResolvedValue(mockRequest);

      await expect(
        cancellationService.rejectRequest({
          requestId: requestId1,
          vendorId: unauthorizedVendorId,
          reviewerUserId: new mongoose.Types.ObjectId(),
          rejectionReason: 'Invalid',
        }),
      ).rejects.toThrow('You do not own this cancellation request');
    });
  });
});
