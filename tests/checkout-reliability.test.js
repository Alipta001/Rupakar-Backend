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
import { OrderStatusHistory } from '../app/models/order-status-history.model.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { OrderService } from '../app/services/order.service.js';
import { env } from '../app/config/env.js';

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
    const originalShippingEnabled = env.SHIPPING_ENABLED;
    env.SHIPPING_ENABLED = true;
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

    try {
      const summary = await pricingService.buildPriceSummary({
        userId: customerId,
        items: [{ productId, variantId, quantity: 1 }],
        shippingAddressId: 'address-1',
      });

      expect(summary.shipping).toBe(0);
      expect(summary.total).toBe(summary.subtotal + summary.tax + summary.shipping - summary.discount);
    } finally {
      env.SHIPPING_ENABLED = originalShippingEnabled;
    }
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
    const originalShippingEnabled = env.SHIPPING_ENABLED;
    const originalShippingFee = env.SHIPPING_BASE_FEE;
    env.SHIPPING_ENABLED = true;
    env.SHIPPING_BASE_FEE = 50;
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

    try {
      const summary = await pricingService.buildPriceSummary({
        items: [{ productId, variantId, quantity: 1 }],
      });

      expect(summary.subtotal).toBe(0.5);
      expect(summary.shipping).toBe(50);
      expect(summary.discount).toBe(0);
      expect(summary.tax).toBe(0);
      expect(summary.total).toBe(50.5);
    } finally {
      env.SHIPPING_ENABLED = originalShippingEnabled;
      env.SHIPPING_BASE_FEE = originalShippingFee;
    }
  });

  it('supports configured free shipping for a ₹1 test product without payment mocks', async () => {
    const { productId, variantId } = ids();
    const originalShippingEnabled = env.SHIPPING_ENABLED;
    const originalShippingFee = env.SHIPPING_BASE_FEE;
    env.SHIPPING_ENABLED = false;
    env.SHIPPING_BASE_FEE = 200;

    try {
      jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
        _id: variantId,
        productId,
        price: 1,
        sku: 'SKU-100',
        status: 'ACTIVE',
      });
      jest.spyOn(Product, 'findOne').mockResolvedValue({
        _id: productId,
        name: 'One rupee test product',
        status: 'PUBLISHED',
        deletedAt: null,
        tax: { taxable: false },
      });
      jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(5);

      const summary = await pricingService.buildPriceSummary({
        items: [{ productId, variantId, quantity: 1 }],
        shippingAddress: { state: 'West Bengal', postalCode: '700001' },
      });

      expect(summary.subtotal).toBe(1);
      expect(summary.shipping).toBe(0);
      expect(summary.discount).toBe(0);
      expect(summary.tax).toBe(0);
      expect(summary.total).toBe(1);
    } finally {
      env.SHIPPING_ENABLED = originalShippingEnabled;
      env.SHIPPING_BASE_FEE = originalShippingFee;
    }
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
    expect(vendorUpdateSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenLastCalledWith(
      'order-1',
      { $set: { status: 'FAILED', paymentStatus: 'FAILED' } },
    );
  });

  it('applies ₹0 customer delivery charge by default for single and multi-item orders across states', async () => {
    const { productId, variantId } = ids();
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      price: 499,
      sku: 'SKU-499',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      name: 'Artisan Clay Pot',
      status: 'PUBLISHED',
      deletedAt: null,
      tax: { taxable: false },
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);

    // 1 item in West Bengal
    const summaryWB = await pricingService.buildPriceSummary({
      items: [{ productId, variantId, quantity: 1 }],
      shippingAddress: { state: 'West Bengal', city: 'Kolkata', postalCode: '700001' },
    });
    expect(summaryWB.shipping).toBe(0);
    expect(summaryWB.total).toBe(499);

    // 3 items outside West Bengal
    const summaryMH = await pricingService.buildPriceSummary({
      items: [{ productId, variantId, quantity: 3 }],
      shippingAddress: { state: 'Maharashtra', city: 'Mumbai', postalCode: '400001' },
    });
    expect(summaryMH.shipping).toBe(0);
    expect(summaryMH.total).toBe(499 * 3);
  });

  it('applies ₹0 customer delivery charge by default for Cash on Delivery (COD) checkout', async () => {
    const { customerId, productId, variantId, vendorId } = ids();
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      price: 750,
      sku: 'SKU-750',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      name: 'Handwoven Textile',
      status: 'PUBLISHED',
      deletedAt: null,
      tax: { taxable: false },
      toObject: () => ({ _id: productId, vendorId, name: 'Handwoven Textile', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } }),
    });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ variantId, availableQuantity: 5, deletedAt: null });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(5);
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-cod', orderId: 'order-cod', variantId, status: 'ACTIVE' });
    jest.spyOn(inventoryReservationService, 'consumeOrderReservations').mockResolvedValue(true);
    jest.spyOn(paymentService, 'createPayment').mockResolvedValue({
      _id: new mongoose.Types.ObjectId().toHexString(),
      status: 'PENDING',
      method: 'cod',
    });
    jest.spyOn(paymentService, 'ensureCapturedOrderArtifacts').mockResolvedValue({ vendorOrders: [{ _id: 'vo-cod' }] });

    const mockOrderId = new mongoose.Types.ObjectId();
    let createdOrder = null;
    jest.spyOn(Order, 'create').mockImplementation((data) => {
      createdOrder = { ...data, _id: mockOrderId, toObject: () => ({ ...data, _id: mockOrderId }) };
      return Promise.resolve(createdOrder);
    });

    const service = new OrderService();
    const result = await service.createOrder({
      customerId,
      items: [{ productId, variantId, quantity: 1 }],
      paymentMethod: 'cod',
      shippingAddress: { state: 'West Bengal', city: 'Kolkata', postalCode: '700001' },
    });

    expect(result.shipping).toBe(0);
    expect(result.total).toBe(750);
  });

  it('allocates ₹0 delivery charge across multiple vendors in multi-vendor checkout', async () => {
    const { customerId } = ids();
    const vendor1 = new mongoose.Types.ObjectId().toHexString();
    const vendor2 = new mongoose.Types.ObjectId().toHexString();
    const prod1 = new mongoose.Types.ObjectId().toHexString();
    const prod2 = new mongoose.Types.ObjectId().toHexString();
    const var1 = new mongoose.Types.ObjectId().toHexString();
    const var2 = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(ProductVariant, 'findOne').mockImplementation(({ _id }) => {
      if (String(_id) === var1) return Promise.resolve({ _id: var1, productId: prod1, price: 500, sku: 'SKU-V1', status: 'ACTIVE' });
      if (String(_id) === var2) return Promise.resolve({ _id: var2, productId: prod2, price: 1000, sku: 'SKU-V2', status: 'ACTIVE' });
      return Promise.resolve(null);
    });

    jest.spyOn(Product, 'findOne').mockImplementation(({ _id }) => {
      if (String(_id) === prod1) return Promise.resolve({ _id: prod1, vendorId: vendor1, name: 'Vendor 1 Product', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } });
      if (String(_id) === prod2) return Promise.resolve({ _id: prod2, vendorId: vendor2, name: 'Vendor 2 Product', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } });
      return Promise.resolve(null);
    });

    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items: [
        { productId: prod1, variantId: var1, quantity: 1 },
        { productId: prod2, variantId: var2, quantity: 1 },
      ],
      shippingAddress: { state: 'Karnataka', city: 'Bengaluru', postalCode: '560001' },
    });

    expect(summary.shipping).toBe(0);
    expect(summary.subtotal).toBe(1500);
    expect(summary.total).toBe(1500);
  });
});

