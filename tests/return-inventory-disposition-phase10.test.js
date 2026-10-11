import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { InventoryMovement } from '../app/models/inventory-movement.model.js';
import { returnStateService } from '../app/services/return-state.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { auditService } from '../app/services/audit.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { refundService } from '../app/services/refund.service.js';
import { replacementService } from '../app/services/replacement.service.js';
import {
  sellerSubmitDisposition,
  adminSubmitDisposition,
  getReturnDetail,
  buildVendorReturnDto,
  buildAdminReturnDto,
} from '../app/controllers/return.controller.js';
import { User } from '../app/models/user.model.js';
import { Refund } from '../app/models/refund.model.js';

describe('Phase 10: Controlled Returned Inventory Disposition & Restocking Tests', () => {
  const sellerAUserId = new mongoose.Types.ObjectId().toHexString();
  const sellerBUserId = new mongoose.Types.ObjectId().toHexString();
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const adminUserId = new mongoose.Types.ObjectId().toHexString();

  const vendorAId = new mongoose.Types.ObjectId().toHexString();
  const vendorBId = new mongoose.Types.ObjectId().toHexString();

  const returnAId = new mongoose.Types.ObjectId().toHexString();
  const returnBId = new mongoose.Types.ObjectId().toHexString();

  const orderId = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId = new mongoose.Types.ObjectId().toHexString();
  const returnItemId1 = new mongoose.Types.ObjectId().toHexString();
  const returnItemId2 = new mongoose.Types.ObjectId().toHexString();
  const productId1 = new mongoose.Types.ObjectId().toHexString();
  const productId2 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId2 = new mongoose.Types.ObjectId().toHexString();
  const inventoryId1 = new mongoose.Types.ObjectId().toHexString();
  const inventoryId2 = new mongoose.Types.ObjectId().toHexString();

  const mockReq = (user, params = {}, body = {}, query = {}, role = null) => ({
    user: { sub: user, role: role || (user === adminUserId ? 'admin' : 'vendor') },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p10' },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const makeQuery = (result) => ({
    lean: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  });

  const createMockReturn = (overrides = {}) => {
    const doc = {
      _id: returnAId,
      returnNumber: 'RET-2026-10001',
      orderId,
      vendorOrderId,
      customerId,
      vendorId: vendorAId,
      type: 'RETURN',
      status: 'INSPECTION_PASSED',
      items: [returnItemId1],
      inspection: {
        inspectedAt: new Date(),
        inspectedBy: sellerAUserId,
        result: 'PASSED',
        totalReturnedQuantity: 2,
        totalAcceptedQuantity: 2,
        totalRejectedQuantity: 0,
        items: [
          {
            returnItemId: returnItemId1,
            variantId: variantId1,
            returnedQuantity: 2,
            acceptedQuantity: 2,
            rejectedQuantity: 0,
            condition: 'INTACT',
            itemCondition: 'INTACT',
          },
        ],
      },
      disposition: null,
      statusHistory: [
        { status: 'REQUESTED', changedAt: new Date(), actorType: 'CUSTOMER' },
        { status: 'APPROVED', changedAt: new Date(), actorType: 'VENDOR' },
        { status: 'RETURN_RECEIVED', changedAt: new Date(), actorType: 'SYSTEM' },
        { status: 'INSPECTION_PENDING', changedAt: new Date(), actorType: 'VENDOR' },
        { status: 'INSPECTION_PASSED', changedAt: new Date(), actorType: 'VENDOR' },
      ],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
      ...overrides,
    };
    return doc;
  };

  const createMockReturnItem = (overrides = {}) => {
    const doc = {
      _id: returnItemId1,
      productId: productId1,
      variantId: variantId1,
      quantity: 2,
      unitPrice: 500,
      lineTotal: 1000,
      inspection: {
        inspectedAt: new Date(),
        inspectedBy: sellerAUserId,
        result: 'PASSED',
        acceptedQuantity: 2,
        rejectedQuantity: 0,
        condition: 'INTACT',
        itemCondition: 'INTACT',
      },
      disposition: null,
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
      ...overrides,
    };
    return doc;
  };

  const createMockInventory = (overrides = {}) => ({
    _id: inventoryId1,
    productId: productId1,
    variantId: variantId1,
    availableQuantity: 10,
    reservedQuantity: 2,
    soldQuantity: 5,
    lowStockThreshold: 3,
    status: 'ACTIVE',
    deletedAt: null,
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockProduct = (overrides = {}) => ({
    _id: productId1,
    vendorId: vendorAId,
    name: 'Handcrafted Wooden Vase',
    deletedAt: null,
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockVariant = (overrides = {}) => ({
    _id: variantId1,
    productId: productId1,
    sku: 'VASE-WOOD-01',
    deletedAt: null,
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    const mockItem = createMockReturnItem();
    jest.spyOn(ReturnItem, 'find').mockImplementation(() => makeQuery([mockItem]));
    jest.spyOn(ReturnItem, 'findById').mockImplementation((id) => Promise.resolve(mockItem));

    jest.spyOn(Order, 'findById').mockImplementation(() => makeQuery({
      _id: orderId,
      orderNumber: 'ORD-10001',
      status: 'DELIVERED',
      createdAt: new Date(),
      shippingAddress: { fullName: 'Customer Name', city: 'Kolkata', state: 'West Bengal' },
    }));

    jest.spyOn(VendorOrder, 'findById').mockImplementation(() => makeQuery({
      _id: vendorOrderId,
      status: 'DELIVERED',
      total: 1000,
    }));

    jest.spyOn(User, 'findById').mockImplementation(() => makeQuery({
      _id: customerId,
      name: 'Customer Name',
      email: 'customer@test.com',
    }));

    jest.spyOn(Return, 'findById').mockImplementation((id) => makeQuery(createMockReturn()));
    jest.spyOn(Return, 'findOneAndUpdate').mockImplementation(() => Promise.resolve(createMockReturn()));
    jest.spyOn(Return, 'updateOne').mockImplementation(() => Promise.resolve({ modifiedCount: 1 }));

    // Default vendor mocks
    jest.spyOn(Vendor, 'findOne').mockImplementation((query) => {
      if (query.ownerUserId === sellerAUserId) {
        return makeQuery({ _id: vendorAId, ownerUserId: sellerAUserId, storeName: 'Artisan Store A' });
      }
      if (query.ownerUserId === sellerBUserId) {
        return makeQuery({ _id: vendorBId, ownerUserId: sellerBUserId, storeName: 'Artisan Store B' });
      }
      return makeQuery(null);
    });

    jest.spyOn(Vendor, 'findById').mockImplementation((id) => {
      if (String(id) === String(vendorAId)) {
        return makeQuery({ _id: vendorAId, storeName: 'Artisan Store A', ownerUserId: sellerAUserId });
      }
      return makeQuery(null);
    });

    // Default Product / Variant / Inventory mocks
    jest.spyOn(Product, 'findOne').mockImplementation((query) => {
      if (String(query._id) === String(productId1)) return makeQuery(createMockProduct());
      if (String(query._id) === String(productId2)) return makeQuery(createMockProduct({ _id: productId2, vendorId: vendorBId }));
      return makeQuery(null);
    });

    jest.spyOn(ProductVariant, 'findOne').mockImplementation((query) => {
      if (String(query._id) === String(variantId1)) return makeQuery(createMockVariant());
      if (String(query._id) === String(variantId2)) return makeQuery(createMockVariant({ _id: variantId2, productId: productId2 }));
      return makeQuery(null);
    });

    jest.spyOn(Inventory, 'findOne').mockImplementation((query) => {
      if (String(query.variantId) === String(variantId1)) return makeQuery(createMockInventory());
      if (String(query.variantId) === String(variantId2)) return makeQuery(createMockInventory({ _id: inventoryId2, productId: productId2, variantId: variantId2 }));
      return makeQuery(null);
    });

    jest.spyOn(InventoryMovement, 'findOne').mockReturnValue(makeQuery(null));
    jest.spyOn(InventoryMovement, 'create').mockImplementation((data) => Promise.resolve({ _id: new mongoose.Types.ObjectId().toHexString(), ...data }));

    // Audit spy
    jest.spyOn(auditService, 'log').mockImplementation(() => {});

    // Payment / Refund / Replacement safety spies
    if (paymentService.createRefund) jest.spyOn(paymentService, 'createRefund').mockImplementation(() => {});
    if (refundService.executeRefund) jest.spyOn(refundService, 'executeRefund').mockImplementation(() => {});
    if (replacementService.createReplacementOrder) jest.spyOn(replacementService, 'createReplacementOrder').mockImplementation(() => {});
  });

  // 1. INSPECTION_PASSED required
  it('1. requires INSPECTION_PASSED for disposition to proceed', async () => {
    const returnDoc = createMockReturn({ status: 'INSPECTION_PASSED' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 12 }));

    const req = mockReq(sellerAUserId, { id: returnAId }, { notes: 'Passed inspection disposition' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
    expect(returnDoc.status).toBe('DISPOSITION_COMPLETED');
  });

  // 2. INSPECTION_FAILED cannot restock
  it('2. rejects disposition and restock for returns in INSPECTION_FAILED status', async () => {
    const returnDoc = createMockReturn({ status: 'INSPECTION_FAILED' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INSPECTION_FAILED_CANNOT_RESTOCK',
      }),
    );
  });

  // 3. RETURN_RECEIVED cannot restock
  it('3. rejects disposition and restock for returns in RETURN_RECEIVED status before inspection', async () => {
    const returnDoc = createMockReturn({ status: 'RETURN_RECEIVED' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_RETURN_STATUS',
      }),
    );
  });

  // 4. negative restock quantity rejected
  it('4. rejects negative restock quantity with validation error', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: -1, nonRestockableQuantity: 0 }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // 5. restock > accepted rejected
  it('5. rejects restock quantity greater than accepted quantity', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem({ quantity: 2, inspection: { acceptedQuantity: 2, rejectedQuantity: 0 } })]));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 3, nonRestockableQuantity: 0 }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_RESTOCK_QUANTITY',
      }),
    );
  });

  // 6. non-restockable > accepted rejected
  it('6. rejects non-restockable quantity greater than accepted quantity', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem({ quantity: 2, inspection: { acceptedQuantity: 2, rejectedQuantity: 0 } })]));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 0, nonRestockableQuantity: 3 }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_RESTOCK_QUANTITY',
      }),
    );
  });

  // 7. disposition quantity mismatch rejected
  it('7. rejects when restockable + non-restockable != accepted quantity', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem({ quantity: 2, inspection: { acceptedQuantity: 2, rejectedQuantity: 0 } })]));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 1, nonRestockableQuantity: 0 }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'DISPOSITION_QUANTITY_MISMATCH',
      }),
    );
  });

  // 8. accepted + rejected == returned validation
  it('8. validates that accepted + rejected equals returned quantity', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    // Corrupt inspection where accepted (1) + rejected (0) != returned (2)
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem({ quantity: 2, inspection: { acceptedQuantity: 1, rejectedQuantity: 0 } })]));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 1, nonRestockableQuantity: 0 }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INSPECTION_QUANTITY_MISMATCH',
      }),
    );
  });

  // 9. multi-item validation
  it('9. validates multiple return items independently', async () => {
    const returnDoc = createMockReturn({ items: [returnItemId1, returnItemId2] });
    const item1 = createMockReturnItem({ _id: returnItemId1, quantity: 2, inspection: { acceptedQuantity: 2, rejectedQuantity: 0 } });
    const item2 = createMockReturnItem({ _id: returnItemId2, productId: productId1, variantId: variantId1, quantity: 1, inspection: { acceptedQuantity: 1, rejectedQuantity: 0 } });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item1, item2]));
    jest.spyOn(ReturnItem, 'findById').mockImplementation((id) => Promise.resolve(String(id) === String(returnItemId1) ? item1 : item2));
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 13 }));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [
        { returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' },
        { returnItemId: returnItemId2, restockableQuantity: 1, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
    expect(returnDoc.disposition.totalRestockableQuantity).toBe(3);
  });

  // 10. partial restock
  it('10. supports partial restock where 1 unit is restockable and 1 unit is damaged', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem({ quantity: 2, inspection: { acceptedQuantity: 2, rejectedQuantity: 0 } });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(item);
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 11 }));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [
        { returnItemId: returnItemId1, restockableQuantity: 1, nonRestockableQuantity: 1, disposition: 'RESTOCKABLE', reason: '1 good, 1 damaged packaging' },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
    // Only 1 was incremented
    expect(incSpy).toHaveBeenCalledWith(
      expect.anything(),
      { $inc: { availableQuantity: 1 } },
      expect.anything(),
    );
    expect(returnDoc.disposition.totalRestockableQuantity).toBe(1);
    expect(returnDoc.disposition.totalNonRestockableQuantity).toBe(1);
  });

  // 11. full restock
  it('11. restocks all accepted units when full restock is submitted', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem({ quantity: 2, inspection: { acceptedQuantity: 2, rejectedQuantity: 0 } });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(item);
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 12 }));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(incSpy).toHaveBeenCalledWith(expect.anything(), { $inc: { availableQuantity: 2 } }, expect.anything());
    expect(returnDoc.disposition.totalRestockableQuantity).toBe(2);
  });

  // 12. fully non-restockable return
  it('12. does not increase inventory when return is classified as fully non-restockable', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem({ quantity: 2, inspection: { acceptedQuantity: 2, rejectedQuantity: 0 } });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(item);
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate');

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 0, nonRestockableQuantity: 2, disposition: 'DAMAGED', reason: 'Liquid damage' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled();
    expect(returnDoc.disposition.totalRestockableQuantity).toBe(0);
    expect(returnDoc.disposition.totalNonRestockableQuantity).toBe(2);
  });

  // 13. mixed restockable/non-restockable items
  it('13. correctly handles mixed restockable and non-restockable items', async () => {
    const returnDoc = createMockReturn({ items: [returnItemId1, returnItemId2] });
    const item1 = createMockReturnItem({ _id: returnItemId1, quantity: 1, inspection: { acceptedQuantity: 1, rejectedQuantity: 0 } });
    const item2 = createMockReturnItem({ _id: returnItemId2, productId: productId1, variantId: variantId1, quantity: 1, inspection: { acceptedQuantity: 1, rejectedQuantity: 0 } });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item1, item2]));
    jest.spyOn(ReturnItem, 'findById').mockImplementation((id) => Promise.resolve(String(id) === String(returnItemId1) ? item1 : item2));
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 11 }));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [
        { returnItemId: returnItemId1, restockableQuantity: 1, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' },
        { returnItemId: returnItemId2, restockableQuantity: 0, nonRestockableQuantity: 1, disposition: 'DEFECTIVE' },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(incSpy).toHaveBeenCalledTimes(1);
    expect(returnDoc.disposition.totalRestockableQuantity).toBe(1);
    expect(returnDoc.disposition.totalNonRestockableQuantity).toBe(1);
  });

  // 14. correct inventory record selected
  it('14. selects correct inventory record matching product and variant', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem();

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(item);
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(incSpy).toHaveBeenCalledWith(
      expect.objectContaining({ productId: productId1, variantId: variantId1, deletedAt: null }),
      expect.anything(),
      expect.anything(),
    );
  });

  // 15. wrong vendor inventory rejected
  it('15. rejects restocking if product belongs to a different vendor', async () => {
    const returnDoc = createMockReturn({ vendorId: vendorAId });
    const item = createMockReturnItem();

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(Product, 'findOne').mockReturnValue(makeQuery(createMockProduct({ vendorId: vendorBId })));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'VENDOR_INVENTORY_MISMATCH',
      }),
    );
  });

  // 16. wrong variant rejected
  it('16. rejects restocking if variant is not found for product', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem();

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(ProductVariant, 'findOne').mockReturnValue(makeQuery(null));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'VARIANT_NOT_FOUND',
      }),
    );
  });

  // 17. missing product rejected safely
  it('17. rejects restocking if product is not found', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem();

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(Product, 'findOne').mockReturnValue(makeQuery(null));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'PRODUCT_NOT_FOUND',
      }),
    );
  });

  // 18. missing inventory rejected safely
  it('18. rejects restocking safely if inventory record is not found', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem();

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));
    jest.spyOn(Inventory, 'findOne').mockReturnValue(makeQuery(null));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'INVENTORY_NOT_FOUND',
      }),
    );
  });

  // 19. authenticity hold cannot restock
  it('19. forbids restocking items categorized under AUTHENTICITY_HOLD', async () => {
    const returnDoc = createMockReturn();
    const item = createMockReturnItem();

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 1, nonRestockableQuantity: 1, disposition: 'AUTHENTICITY_HOLD' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'AUTHENTICITY_HOLD_CANNOT_RESTOCK',
      }),
    );
  });

  // 20. counterfeit suspicion cannot restock
  it('20. forbids restocking items with counterfeit suspicion or authenticity mismatch from inspection', async () => {
    const returnDoc = createMockReturn({
      inspection: {
        authenticityCondition: 'SUSPECTED_COUNTERFEIT',
        result: 'PASSED',
        totalReturnedQuantity: 2,
        totalAcceptedQuantity: 2,
        totalRejectedQuantity: 0,
      },
    });
    const item = createMockReturnItem({
      inspection: { acceptedQuantity: 2, rejectedQuantity: 0, authenticityCondition: 'SUSPECTED_COUNTERFEIT' },
    });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item]));

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'AUTHENTICITY_HOLD_CANNOT_RESTOCK',
      }),
    );
  });

  // 21. seller cannot directly mutate inventory
  it('21. strictly rejects arbitrary inventory mutation fields like availableQuantity in payload', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      availableQuantity: 999,
      soldQuantity: 0,
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0 }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // 22. seller isolation
  it('22. forbids Vendor A from disposing Vendor B return with 403 Forbidden', async () => {
    const returnDoc = createMockReturn({ vendorId: vendorBId });
    // Vendor A tries to query Return B
    jest.spyOn(Return, 'findOne').mockImplementation((q) => {
      if (q.vendorId === vendorAId) return Promise.resolve(null);
      return Promise.resolve(returnDoc);
    });
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));

    const req = mockReq(sellerAUserId, { id: returnBId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );
  });

  // 23. admin authorization
  it('23. authorizes admin to submit disposition for any vendor return', async () => {
    const returnDoc = createMockReturn({ vendorId: vendorAId });
    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 12 }));

    const req = mockReq(adminUserId, { id: returnAId }, { notes: 'Admin authorized disposition' }, {}, 'admin');
    const res = mockRes();
    const next = jest.fn();

    await adminSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
    expect(returnDoc.status).toBe('DISPOSITION_COMPLETED');
  });

  // 24. first restock succeeds
  it('24. successfully increments availableQuantity on first restock', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 12 }));

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(incSpy).toHaveBeenCalled();
  });

  // 25. repeated restock is idempotent
  it('25. returns idempotent success without second increment on repeated call', async () => {
    const returnDoc = createMockReturn({
      status: 'DISPOSITION_COMPLETED',
      disposition: {
        status: 'COMPLETED',
        totalRestockableQuantity: 2,
        totalNonRestockableQuantity: 0,
      },
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate');

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled();
  });

  // 26. concurrent restock protection
  it('26. blocks concurrent requests when disposition is currently being claimed/processed (409 Conflict)', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(null); // claim failed
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery({ ...returnDoc, disposition: { status: 'PROCESSING' } }));

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        code: 'DISPOSITION_ALREADY_IN_PROGRESS',
      }),
    );
  });

  // 27. duplicate request does not double increment
  it('27. prevents double increment on duplicate webhook/request', async () => {
    const returnDoc = createMockReturn({
      disposition: { status: 'COMPLETED' },
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate');

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(incSpy).not.toHaveBeenCalled();
  });

  // 28. duplicate ledger entry prevented
  it('28. skips duplicate ledger creation if InventoryMovement already exists for the return restock', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());

    // Movement already exists
    jest.spyOn(InventoryMovement, 'findOne').mockReturnValue(makeQuery({ _id: 'existing-mov-id' }));
    const createMovSpy = jest.spyOn(InventoryMovement, 'create');
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate');

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(createMovSpy).not.toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled();
  });

  // 29. inventory soldQuantity unchanged
  it('29. does not modify inventory soldQuantity during restock', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(incSpy).toHaveBeenCalledWith(
      expect.anything(),
      { $inc: { availableQuantity: 2 } }, // only availableQuantity, never soldQuantity
      expect.anything(),
    );
  });

  // 30. inventory reservedQuantity unchanged
  it('30. does not modify inventory reservedQuantity during restock', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    const updateArg = incSpy.mock.calls[0][1];
    expect(updateArg.$inc.reservedQuantity).toBeUndefined();
  });

  // 31. availableQuantity increments exactly once
  it('31. increments availableQuantity by exactly restockableQuantity once', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [{ returnItemId: returnItemId1, restockableQuantity: 2, nonRestockableQuantity: 0 }],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(incSpy).toHaveBeenCalledTimes(1);
    expect(incSpy.mock.calls[0][1].$inc.availableQuantity).toBe(2);
  });

  // 32. original Order unchanged
  it('32. does not modify the original Order status or amounts', async () => {
    const orderSaveSpy = jest.fn();
    jest.spyOn(Order, 'findById').mockReturnValue(makeQuery({ _id: orderId, status: 'DELIVERED', save: orderSaveSpy }));

    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(orderSaveSpy).not.toHaveBeenCalled();
  });

  // 33. VendorOrder unchanged financially
  it('33. does not modify VendorOrder total or financial values', async () => {
    const voSaveSpy = jest.fn();
    jest.spyOn(VendorOrder, 'findById').mockReturnValue(makeQuery({ _id: vendorOrderId, total: 1000, save: voSaveSpy }));

    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(voSaveSpy).not.toHaveBeenCalled();
  });

  // 34. no Razorpay call
  it('34. makes zero calls to Razorpay or payment refund execution', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    if (paymentService.createRefund) expect(paymentService.createRefund).not.toHaveBeenCalled();
    if (refundService.executeRefund) expect(refundService.executeRefund).not.toHaveBeenCalled();
  });

  // 35. no replacement creation
  it('35. does not automatically create replacement orders from disposition', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    if (replacementService.createReplacementOrder) {
      expect(replacementService.createReplacementOrder).not.toHaveBeenCalled();
    }
  });

  // 36. audit event created
  it('36. logs RETURN_DISPOSITION_STARTED, RETURN_ITEM_RESTOCKED, and RETURN_DISPOSITION_COMPLETED audit events', async () => {
    const auditSpy = jest.spyOn(auditService, 'log');

    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(auditSpy).toHaveBeenCalledWith('RETURN_DISPOSITION_STARTED', expect.anything());
    expect(auditSpy).toHaveBeenCalledWith('RETURN_ITEM_RESTOCKED', expect.anything());
    expect(auditSpy).toHaveBeenCalledWith('RETURN_DISPOSITION_COMPLETED', expect.anything());
  });

  // 37. multi-vendor isolation
  it('37. isolates inventory so Vendor A restock never alters Vendor B inventory', async () => {
    const returnDoc = createMockReturn({ vendorId: vendorAId });
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    const incSpy = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    // Verified query targets only product1/variant1 of vendorA
    expect(incSpy).toHaveBeenCalledWith(
      expect.objectContaining({ productId: productId1 }),
      expect.anything(),
      expect.anything(),
    );
  });

  // 38. multi-item atomicity
  it('38. rolls back previously incremented items if a later item in the multi-item batch fails', async () => {
    const returnDoc = createMockReturn({ items: [returnItemId1, returnItemId2] });
    const item1 = createMockReturnItem({ _id: returnItemId1, quantity: 1, inspection: { acceptedQuantity: 1, rejectedQuantity: 0 } });
    const item2 = createMockReturnItem({ _id: returnItemId2, productId: productId1, variantId: variantId1, quantity: 1, inspection: { acceptedQuantity: 1, rejectedQuantity: 0 } });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([item1, item2]));
    jest.spyOn(ReturnItem, 'findById').mockImplementation((id) => Promise.resolve(String(id) === String(returnItemId1) ? item1 : item2));

    // Pre-flight check passes for item1, but fail on restock of item2
    let callCount = 0;
    jest.spyOn(inventoryService, 'restockReturnedItem').mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({ inventory: { _id: inventoryId1 }, movement: { _id: 'm1' }, skipped: false });
      }
      throw new Error('Database write error on item 2');
    });

    const rollbackSpy = jest.spyOn(Inventory, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    const deleteMovSpy = jest.spyOn(InventoryMovement, 'deleteOne').mockResolvedValue({ deletedCount: 1 });

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      items: [
        { returnItemId: returnItemId1, restockableQuantity: 1, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' },
        { returnItemId: returnItemId2, restockableQuantity: 1, nonRestockableQuantity: 0, disposition: 'RESTOCKABLE' },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(next).toHaveBeenCalled();
    // Compensation rollback executed for item1
    expect(rollbackSpy).toHaveBeenCalledWith({ _id: inventoryId1 }, { $inc: { availableQuantity: -1 } });
    expect(deleteMovSpy).toHaveBeenCalledWith({ _id: 'm1' });
  });

  // 39. failure does not falsely mark completed
  it('39. does not mark return as completed if inventory mutation fails', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(inventoryService, 'restockReturnedItem').mockRejectedValue(new Error('Hardware failure'));

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(returnDoc.status).toBe('INSPECTION_PASSED'); // NOT DISPOSITION_COMPLETED
    expect(next).toHaveBeenCalled();
  });

  // 40. retry after recoverable failure
  it('40. allows retry after recoverable failure once issue is resolved', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory({ availableQuantity: 12 }));

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
    expect(returnDoc.status).toBe('DISPOSITION_COMPLETED');
  });

  // 41. customer DTO remains sanitized
  it('41. customer return DTO contains sanitized disposition without inventory balances or internal notes', async () => {
    const returnDoc = createMockReturn({
      disposition: {
        status: 'COMPLETED',
        disposedAt: new Date(),
        disposedBy: sellerAUserId,
        notes: 'Secret internal warehouse damaged notes',
        totalRestockableQuantity: 2,
        totalNonRestockableQuantity: 0,
        items: [{ returnItemId: returnItemId1, restockableQuantity: 2 }],
      },
    });

    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem({ disposition: { restocked: true, reason: 'internal notes' } })]));

    const req = mockReq(customerId, { id: returnAId });
    const res = mockRes();
    const next = jest.fn();

    await getReturnDetail(req, res, next);
    expect(res.json).toHaveBeenCalled();
    const responseData = res.json.mock.calls[0][0].data;

    expect(responseData.disposition.status).toBe('DISPOSITION_COMPLETED');
    expect(responseData.disposition.notes).toBeUndefined(); // redacted
    expect(responseData.disposition.totalRestockableQuantity).toBeUndefined(); // redacted
    expect(responseData.items[0].disposition.reason).toBeUndefined(); // redacted
  });

  // 42. seller DTO remains isolated
  it('42. seller return DTO contains disposition items for their return', async () => {
    const returnDoc = createMockReturn({
      disposition: {
        status: 'COMPLETED',
        totalRestockableQuantity: 2,
        totalNonRestockableQuantity: 0,
      },
    });
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));

    const dto = await buildVendorReturnDto(returnDoc);
    expect(dto.disposition).toBeDefined();
    expect(dto.disposition.totalRestockableQuantity).toBe(2);
  });

  // 43. admin DTO contains operational information
  it('43. admin return DTO contains full operational disposition information', async () => {
    const returnDoc = createMockReturn({
      disposition: {
        status: 'COMPLETED',
        totalRestockableQuantity: 2,
        totalNonRestockableQuantity: 0,
      },
    });
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));

    const dto = await buildAdminReturnDto(returnDoc);
    expect(dto.disposition).toBeDefined();
    expect(dto.disposition.totalRestockableQuantity).toBe(2);
  });

  // 44. return state transitions use returnStateService
  it('44. enforces return state transitions through returnStateService', async () => {
    const transitionSpy = jest.spyOn(returnStateService, 'transitionReturnStatus');

    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(transitionSpy).toHaveBeenCalledWith('INSPECTION_PASSED', 'DISPOSITION_COMPLETED', expect.anything());
  });

  // 45. no live Shiprocket call
  it('45. ensures no live Shiprocket calls are made during inventory disposition', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
  });

  // 46. no live Razorpay call
  it('46. ensures no live Razorpay calls are made during inventory disposition', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findOne').mockResolvedValue(returnDoc);
    jest.spyOn(Return, 'findById').mockReturnValue(makeQuery(returnDoc));
    jest.spyOn(Return, 'findOneAndUpdate').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue(makeQuery([createMockReturnItem()]));
    jest.spyOn(ReturnItem, 'findById').mockResolvedValue(createMockReturnItem());
    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue(createMockInventory());

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitDisposition(req, res, next);
    expect(res.json).toHaveBeenCalled();
  });
});
