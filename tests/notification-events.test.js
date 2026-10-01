import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { notificationService } from '../app/services/notification.service.js';
import { Notification } from '../app/models/notification.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { User } from '../app/models/user.model.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { Inventory } from '../app/models/inventory.model.js';
import { InventoryMovement } from '../app/models/inventory-movement.model.js';
import { Product } from '../app/models/product.model.js';
import { supportTicketService } from '../app/services/support-ticket.service.js';
import { SupportTicket } from '../app/models/support-ticket.model.js';
import { settlementService } from '../app/services/settlement.service.js';
import { VendorPayout } from '../app/models/vendor-payout.model.js';
import { VendorLedgerEntry } from '../app/models/vendor-ledger-entry.model.js';

describe('Notification Event Triggers & Recipient Isolation', () => {
  const vendorId1 = new mongoose.Types.ObjectId();
  const vendorId2 = new mongoose.Types.ObjectId();
  const ownerUserId1 = new mongoose.Types.ObjectId();
  const ownerUserId2 = new mongoose.Types.ObjectId();
  const adminUserId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('notifyVendor & Recipient Isolation', () => {
    it('routes vendor notification to the vendor owner user ID and isolates from other vendors', async () => {
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: vendorId1, ownerUserId: ownerUserId1 }),
      });

      const createSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await notificationService.notifyVendor({
        vendorId: vendorId1,
        type: 'PRODUCT_APPROVED',
        title: 'Product Approved',
        message: 'Your product is approved.',
        metadata: { productId: 'prod-123' },
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArg = createSpy.mock.calls[0][0];
      expect(callArg.userId).toEqual(ownerUserId1);
      expect(callArg.type).toBe('PRODUCT_APPROVED');
      expect(callArg.metadata.productId).toBe('prod-123');
      // Must not leak to vendor 2
      expect(callArg.userId).not.toEqual(ownerUserId2);
    });

    it('routes admin notifications with forAdmin: true so they are not treated as seller notifications', async () => {
      jest.spyOn(User, 'find').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: adminUserId }]),
      });

      const createSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await notificationService.notifyAdmins({
        type: 'ADMIN_VENDOR_REGISTERED',
        title: 'New Vendor Registration',
        message: 'A new artisan has registered.',
        metadata: { vendorId: vendorId1 },
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArg = createSpy.mock.calls[0][0];
      expect(callArg.type).toBe('ADMIN_VENDOR_REGISTERED');
      expect(callArg.metadata.forAdmin).toBe(true);
      expect(callArg.userId).toEqual(adminUserId);
    });
  });

  describe('Inventory Low & Out of Stock Alerts', () => {
    it('dispatches notifications to both vendor and admin when inventory reaches 0', async () => {
      const productId = new mongoose.Types.ObjectId();
      const variantId = new mongoose.Types.ObjectId();
      const inventoryId = new mongoose.Types.ObjectId();

      const mockInventoryDoc = {
        _id: inventoryId,
        productId,
        variantId,
        availableQuantity: 0,
        reservedQuantity: 0,
        lowStockThreshold: 5,
        save: jest.fn().mockResolvedValue({}),
        toObject: () => ({ _id: inventoryId, productId, variantId, availableQuantity: 0 }),
      };

      jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(mockInventoryDoc);
      jest.spyOn(InventoryMovement, 'create').mockResolvedValue({});

      jest.spyOn(Product, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: productId,
          title: 'Silk Scarf',
          vendorId: vendorId1,
          variants: [{ _id: variantId, sku: 'SILK-SCARF-RED' }],
        }),
      });

      const notifyVendorSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});
      const notifyAdminsSpy = jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue([]);

      await inventoryService.decreaseStock(variantId, 5, { reason: 'ORDER_FULFILLED' });

      // 1. Vendor out of stock alert
      expect(notifyVendorSpy).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: vendorId1,
        type: 'INVENTORY_OUT_OF_STOCK',
        title: 'Out of Stock Alert',
      }));

      // 2. Admin out of stock alert
      expect(notifyAdminsSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ADMIN_INVENTORY_OUT_OF_STOCK',
        title: 'Product Out of Stock',
        metadata: expect.objectContaining({ productId: String(productId) }),
      }));
    });
  });

  describe('Support Ticket Lifecycle Notifications', () => {
    it('notifies admin and seller when a seller creates a support ticket', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({
        _id: vendorId1,
        ownerUserId: ownerUserId1,
        businessName: 'Bengal Crafts',
      });

      jest.spyOn(SupportTicket, 'create').mockResolvedValue({
        _id: ticketId,
        ticketNumber: 'TCK-2026-0001',
        subject: 'Need help with payout',
        vendorId: vendorId1,
        userId: ownerUserId1,
        status: 'OPEN',
      });

      const createNotifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const notifyAdminsSpy = jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue([]);

      await supportTicketService.create(ownerUserId1, {
        subject: 'Need help with payout',
        message: 'Details here',
      });

      // Seller receives confirmation
      expect(createNotifSpy).toHaveBeenCalledWith(expect.objectContaining({
        userId: ownerUserId1,
        type: 'SUPPORT_TICKET_CREATED',
      }));

      // Admin receives notification
      expect(notifyAdminsSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ADMIN_SUPPORT_TICKET_CREATED',
        metadata: expect.objectContaining({ vendorId: String(vendorId1) }),
      }));
    });
  });

  describe('Payout & Settlement Notifications', () => {
    it('notifies vendor when manual payout is confirmed and settled', async () => {
      const payoutId = new mongoose.Types.ObjectId();
      const mockPayout = {
        _id: payoutId,
        payoutNumber: 'PO-20261001-TEST-101',
        vendorId: vendorId1,
        amountPaise: 500000,
        requestedAmount: 5000,
        status: 'READY',
        currency: 'INR',
        ledgerEntryIds: [],
        save: jest.fn().mockResolvedValue({}),
      };

      jest.spyOn(VendorPayout, 'findById').mockResolvedValue(mockPayout);
      jest.spyOn(VendorLedgerEntry, 'updateMany').mockResolvedValue({});

      const notifyVendorSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});
      const notifyAdminsSpy = jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue([]);

      await settlementService.confirmManualPayout(payoutId, {
        referenceId: 'UTR-123456789',
        adminUserId,
      });

      // Vendor receives settlement notification
      expect(notifyVendorSpy).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: vendorId1,
        type: 'PAYOUT_SETTLED',
        metadata: expect.objectContaining({ payoutId: String(payoutId) }),
      }));

      // Admin receives payout settled notification
      expect(notifyAdminsSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ADMIN_PAYOUT_SETTLED',
        metadata: expect.objectContaining({ payoutId: String(payoutId) }),
      }));
    });
  });
});
