import mongoose from 'mongoose';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { previewCheckout } from '../app/controllers/checkout.controller.js';
import { checkoutService } from '../app/services/checkout.service.js';
import { pricingService } from '../app/services/pricing.service.js';
import { userAddressService } from '../app/services/user-address.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Cart } from '../app/models/cart.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Payment } from '../app/models/payment.model.js';
import { OrderStatusHistory } from '../app/models/order-status-history.model.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { OrderService } from '../app/services/order.service.js';

const ids = () => ({
  customerId: new mongoose.Types.ObjectId().toHexString(),
  productId: new mongoose.Types.ObjectId().toHexString(),
  variantId: new mongoose.Types.ObjectId().toHexString(),
  vendorId: new mongoose.Types.ObjectId().toHexString(),
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('checkout reliability', () => {
  it('forwards the selected address to checkout preview', async () => {
    const previewSpy = jest.spyOn(checkoutService, 'preview').mockResolvedValue({ total: 100 });
    const json = jest.fn();
    const next = jest.fn();

    await previewCheckout({
      body: { items: [{ productId: 'product-1', variantId: 'variant-1', quantity: 1 }], shippingAddressId: 'address-1' },
      user: { sub: 'customer-1' },
      headers: {},
    }, { status: () => ({ json }) }, next);

    expect(previewSpy).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'customer-1',
      shippingAddressId: 'address-1',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a saved address that does not belong to the customer', async () => {
    const { productId, variantId, customerId } = ids();
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      price: 100,
      sku: 'SKU-1',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      name: 'Test product',
      status: 'PUBLISHED',
      deletedAt: null,
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    jest.spyOn(userAddressService, 'getAddress').mockResolvedValue(null);

    await expect(pricingService.buildPriceSummary({
      userId: customerId,
      items: [{ productId, variantId, quantity: 1 }],
      shippingAddressId: 'another-customers-address',
    })).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });

  it('uses the selected address when calculating server totals', async () => {
    const { productId, variantId, customerId } = ids();
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      price: 100,
      sku: 'SKU-1',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      name: 'Test product',
      status: 'PUBLISHED',
      deletedAt: null,
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    jest.spyOn(userAddressService, 'getAddress').mockResolvedValue({
      _id: 'address-1',
      state: 'West Bengal',
      city: 'Kolkata',
    });

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items: [{ productId, variantId, quantity: 1 }],
      shippingAddressId: 'address-1',
    });

    expect(summary.shipping).toBe(40);
    expect(summary.total).toBe(summary.subtotal + summary.tax + summary.shipping - summary.discount);
  });

  it('calculates a non-zero subtotal from the persisted variant price and quantity', async () => {
    const { productId, variantId } = ids();
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      price: 2199,
      sku: 'SKU-2199',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      name: 'Persisted product',
      status: 'PUBLISHED',
      deletedAt: null,
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(5);

    const summary = await pricingService.buildPriceSummary({
      items: [{ productId, variantId, quantity: 1 }],
    });

    expect(summary.subtotal).toBe(2199);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.items[0]).toMatchObject({ productId, variantId, unitPrice: 2199, lineTotal: 2199 });
  });

  it('rejects malformed product and variant ids before Mongoose queries', async () => {
    await expect(pricingService.buildPriceSummary({
      items: [{ productId: 'product-1', variantId: 'variant-1', quantity: 1 }],
    })).rejects.toMatchObject({ code: 'INVALID_PRODUCT_ID', statusCode: 400 });
  });

  it('keeps ₹0.50 checkout money in rupees and applies configured shipping once', async () => {
    const { productId, variantId } = ids();
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      price: 0.5,
      sku: 'SKU-050',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      name: 'Half rupee product',
      status: 'PUBLISHED',
      deletedAt: null,
      tax: { taxable: false },
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(5);

    const summary = await pricingService.buildPriceSummary({
      items: [{ productId, variantId, quantity: 1 }],
    });

    expect(summary.subtotal).toBe(0.5);
    expect(summary.shipping).toBe(50);
    expect(summary.discount).toBe(0);
    expect(summary.tax).toBe(0);
    expect(summary.total).toBe(50.5);
  });

  it('fails the order, vendor order, and reservations when payment creation fails', async () => {
    const { customerId, productId, variantId, vendorId } = ids();
    const paymentError = new Error('payment provider unavailable');
    const releaseSpy = jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({ status: 'RELEASED' });

    jest.spyOn(Cart, 'findOne').mockResolvedValue({ userId: customerId, items: [{ productId, variantId, quantity: 1 }] });
    jest.spyOn(Order, 'findOne').mockResolvedValue(null);
    jest.spyOn(pricingService, 'buildPriceSummary').mockResolvedValue({
      subtotal: 100,
      discount: 0,
      tax: 0,
      shipping: 0,
      total: 100,
      currency: 'INR',
      items: [{ productId, variantId, quantity: 1, unitPrice: 100, lineTotal: 100 }],
      shippingAddress: null,
    });
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      vendorId,
      sku: 'SKU-1',
      price: 100,
      status: 'ACTIVE',
      toObject: () => ({ _id: variantId, productId, vendorId, sku: 'SKU-1', price: 100, status: 'ACTIVE' }),
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      name: 'Test product',
      categoryId: null,
      status: 'PUBLISHED',
      deletedAt: null,
      toObject: () => ({ _id: productId, vendorId, name: 'Test product', categoryId: null, status: 'PUBLISHED', deletedAt: null }),
    });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ variantId, availableQuantity: 5, deletedAt: null });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'reservation-1', orderId: 'order-1', variantId, status: 'ACTIVE' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vendor-order-1' });
    jest.spyOn(Order, 'create').mockResolvedValue({
      _id: 'order-1',
      customerId,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      total: 100,
      items: [{ productId, variantId, vendorId, quantity: 1, unitPrice: 100, lineTotal: 100, productName: 'Test product', sku: 'SKU-1' }],
      toObject: () => ({ _id: 'order-1', customerId, status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', total: 100, items: [] }),
    });
    const updateSpy = jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({ _id: 'order-1', status: 'FAILED', paymentStatus: 'FAILED' });
    jest.spyOn(OrderStatusHistory, 'create').mockResolvedValue({ _id: 'history-1' });
    const vendorUpdateSpy = jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(paymentService, 'isRazorpayEnabled').mockReturnValue(true);
    jest.spyOn(paymentService, 'createPayment').mockRejectedValue(paymentError);

    const service = new OrderService();
    await expect(service.createOrder({
      customerId,
      paymentMethod: 'razorpay',
      idempotencyKey: 'failed-payment-1',
    })).rejects.toBe(paymentError);

    expect(releaseSpy).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', variantId }));
    expect(vendorUpdateSpy).toHaveBeenCalledWith(
      { _id: { $in: ['vendor-order-1'] } },
      { $set: { status: 'FAILED' } },
    );
    expect(updateSpy).toHaveBeenLastCalledWith(
      'order-1',
      { $set: { status: 'FAILED', paymentStatus: 'FAILED' } },
    );
  });
});
