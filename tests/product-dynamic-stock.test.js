import mongoose from 'mongoose';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { productService } from '../app/services/product.service.js';
import { Product } from '../app/models/product.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { Vendor } from '../app/models/vendor.model.js';

afterEach(() => jest.restoreAllMocks());

describe('Product Dynamic Stock Resolution', () => {
  const userId = new mongoose.Types.ObjectId();
  const vendorId = new mongoose.Types.ObjectId();
  const prodId = new mongoose.Types.ObjectId();
  const varId1 = new mongoose.Types.ObjectId();
  const varId2 = new mongoose.Types.ObjectId();

  it('enriches product and variants with real inventory data in listForVendor', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: userId,
      status: 'APPROVED',
    });

    const mockProduct = {
      _id: prodId,
      vendorId,
      name: 'Dokra Brass Figurine',
      variants: [
        { _id: varId1, sku: 'DOKRA-S', price: 1500 },
        { _id: varId2, sku: 'DOKRA-L', price: 2500 },
      ],
      createdAt: new Date(),
    };

    const mockInventories = [
      { variantId: varId1, availableQuantity: 12, reservedQuantity: 3, soldQuantity: 5 },
      { variantId: varId2, availableQuantity: 4, reservedQuantity: 1, soldQuantity: 2 },
    ];

    const queryMock = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([mockProduct]),
    };

    jest.spyOn(Product, 'find').mockReturnValue(queryMock);
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(Inventory, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockInventories),
    });

    const result = await productService.listForVendor(userId, { page: 1, limit: 10 });

    expect(result.data.length).toBe(1);
    const prod = result.data[0];

    // Parent product aggregated stock
    expect(prod.availableStock).toBe(16); // 12 + 4
    expect(prod.reservedStock).toBe(4);   // 3 + 1
    expect(prod.soldStock).toBe(7);       // 5 + 2
    expect(prod.stock).toBe(16);

    // Variants dynamic stock
    expect(prod.variants[0].availableStock).toBe(12);
    expect(prod.variants[0].reservedStock).toBe(3);
    expect(prod.variants[0].soldStock).toBe(5);

    expect(prod.variants[1].availableStock).toBe(4);
    expect(prod.variants[1].reservedStock).toBe(1);
    expect(prod.variants[1].soldStock).toBe(2);
  });

  it('enriches product and variants with real inventory data in getForVendor', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: userId,
      status: 'APPROVED',
    });

    const mockProduct = {
      _id: prodId,
      vendorId,
      name: 'Dokra Brass Figurine',
      variants: [
        { _id: varId1, sku: 'DOKRA-S', price: 1500 },
      ],
      createdAt: new Date(),
    };

    const mockInventories = [
      { variantId: varId1, availableQuantity: 0, reservedQuantity: 2, soldQuantity: 10 },
    ];

    const queryMock = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(mockProduct),
    };

    jest.spyOn(Product, 'findOne').mockReturnValue(queryMock);
    jest.spyOn(Inventory, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockInventories),
    });

    const prod = await productService.getForVendor(userId, prodId.toHexString());

    // Handles zero stock correctly
    expect(prod.availableStock).toBe(0);
    expect(prod.stock).toBe(0);
    expect(prod.reservedStock).toBe(2);
    expect(prod.soldStock).toBe(10);
    expect(prod.variants[0].availableStock).toBe(0);
    expect(prod.variants[0].stock).toBe(0);
    expect(prod.variants[0].reservedStock).toBe(2);
  });
});
