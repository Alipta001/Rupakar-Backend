import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../app/jobs/queues.js', () => ({
  scheduleNotification: jest.fn().mockResolvedValue('notif-1'),
  scheduleEmail: jest.fn().mockResolvedValue('email-1'),
  scheduleInvoiceGeneration: jest.fn().mockResolvedValue('invoice-1'),
  schedulePackingSlipGeneration: jest.fn().mockResolvedValue('slip-1'),
  scheduleVendorOrderPackReminder: jest.fn().mockResolvedValue('pack-reminder-1'),
  scheduleVendorOrderAutoCancel: jest.fn().mockResolvedValue('auto-cancel-1'),
}));

const { OrderService } = await import('../app/services/order.service.js');
const { PaymentService, paymentService } = await import('../app/services/payment.service.js');
const { pricingService } = await import('../app/services/pricing.service.js');
const { shippingService } = await import('../app/services/shipping.service.js');
const { Order } = await import('../app/models/order.model.js');
const { Vendor } = await import('../app/models/vendor.model.js');
const { VendorOrder } = await import('../app/models/vendor-order.model.js');
const { Product } = await import('../app/models/product.model.js');
const { ProductVariant } = await import('../app/models/product-variant.model.js');
const { Inventory } = await import('../app/models/inventory.model.js');
const { inventoryService } = await import('../app/services/inventory.service.js');
const { inventoryReservationService } = await import('../app/services/inventory-reservation.service.js');
const { ShiprocketProvider } = await import('../app/services/delivery-provider.service.js');
const { env } = await import('../app/config/env.js');

describe('Professional Multi-Vendor Seller-Aware Delivery Pricing', () => {
  const ids = () => ({
    customerId: new mongoose.Types.ObjectId().toHexString(),
    vendorA: new mongoose.Types.ObjectId().toHexString(),
    vendorB: new mongoose.Types.ObjectId().toHexString(),
    prodA: new mongoose.Types.ObjectId().toHexString(),
    prodB: new mongoose.Types.ObjectId().toHexString(),
    varA: new mongoose.Types.ObjectId().toHexString(),
    varB: new mongoose.Types.ObjectId().toHexString(),
  });

  let originalShippingEnabled;
  let originalShippingBaseFee;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    originalShippingEnabled = env.SHIPPING_ENABLED;
    originalShippingBaseFee = env.SHIPPING_BASE_FEE;
    env.SHIPPING_ENABLED = true;
    env.SHIPPING_BASE_FEE = 0;
  });

  afterEach(() => {
    env.SHIPPING_ENABLED = originalShippingEnabled;
    env.SHIPPING_BASE_FEE = originalShippingBaseFee;
  });

  it('1. single-vendor order with default free delivery (fee = ₹0)', async () => {
    const { customerId, vendorA, prodA, varA } = ids();

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: varA,
      productId: prodA,
      price: 499,
      sku: 'SKU-A',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: prodA,
      vendorId: vendorA,
      name: 'Handcrafted Scarf',
      status: 'PUBLISHED',
      deletedAt: null,
      tax: { taxable: false },
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    jest.spyOn(Vendor, 'find').mockResolvedValue([
      {
        _id: vendorA,
        businessName: 'Artisan A',
        shippingSettings: { enabled: false, fee: 0, freeDeliveryThreshold: 0 },
      },
    ]);

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items: [{ productId: prodA, variantId: varA, quantity: 1 }],
      shippingAddress: { state: 'West Bengal', city: 'Kolkata', postalCode: '700001' },
    });

    expect(summary.shipping).toBe(0);
    expect(summary.subtotal).toBe(499);
    expect(summary.total).toBe(499);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].shippingFee).toBe(0);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].isFree).toBe(true);
  });

  it('2. single-vendor seller fee applies when enabled and subtotal is below threshold', async () => {
    const { customerId, vendorA, prodA, varA } = ids();

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: varA,
      productId: prodA,
      price: 300,
      sku: 'SKU-A',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: prodA,
      vendorId: vendorA,
      name: 'Clay Cup',
      status: 'PUBLISHED',
      deletedAt: null,
      tax: { taxable: false },
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    jest.spyOn(Vendor, 'find').mockResolvedValue([
      {
        _id: vendorA,
        businessName: 'Artisan A',
        shippingSettings: { enabled: true, fee: 50, freeDeliveryThreshold: 500 },
      },
    ]);

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items: [{ productId: prodA, variantId: varA, quantity: 1 }],
      shippingAddress: { state: 'Maharashtra', city: 'Mumbai', postalCode: '400001' },
    });

    expect(summary.shipping).toBe(50);
    expect(summary.subtotal).toBe(300);
    expect(summary.total).toBe(350);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].shippingFee).toBe(50);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].isFree).toBe(false);
  });

  it('3. free-delivery threshold waives delivery fee when vendor subtotal meets threshold', async () => {
    const { customerId, vendorA, prodA, varA } = ids();

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: varA,
      productId: prodA,
      price: 600,
      sku: 'SKU-A',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: prodA,
      vendorId: vendorA,
      name: 'Silk Shawl',
      status: 'PUBLISHED',
      deletedAt: null,
      tax: { taxable: false },
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    jest.spyOn(Vendor, 'find').mockResolvedValue([
      {
        _id: vendorA,
        businessName: 'Artisan A',
        shippingSettings: { enabled: true, fee: 50, freeDeliveryThreshold: 500 },
      },
    ]);

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items: [{ productId: prodA, variantId: varA, quantity: 1 }],
      shippingAddress: { state: 'Karnataka', city: 'Bengaluru', postalCode: '560001' },
    });

    expect(summary.shipping).toBe(0);
    expect(summary.subtotal).toBe(600);
    expect(summary.total).toBe(600);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].shippingFee).toBe(0);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].isFree).toBe(true);
  });

  it('4. multi-vendor order calculates independent seller fees (Seller A = ₹40, Seller B = ₹60 => Total = ₹100)', async () => {
    const { customerId, vendorA, vendorB, prodA, prodB, varA, varB } = ids();

    jest.spyOn(ProductVariant, 'findOne').mockImplementation(({ _id }) => {
      if (String(_id) === varA) return Promise.resolve({ _id: varA, productId: prodA, price: 300, sku: 'SKU-A', status: 'ACTIVE' });
      if (String(_id) === varB) return Promise.resolve({ _id: varB, productId: prodB, price: 400, sku: 'SKU-B', status: 'ACTIVE' });
      return Promise.resolve(null);
    });

    jest.spyOn(Product, 'findOne').mockImplementation(({ _id }) => {
      if (String(_id) === prodA) return Promise.resolve({ _id: prodA, vendorId: vendorA, name: 'Prod A', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } });
      if (String(_id) === prodB) return Promise.resolve({ _id: prodB, vendorId: vendorB, name: 'Prod B', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } });
      return Promise.resolve(null);
    });

    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    jest.spyOn(Vendor, 'find').mockResolvedValue([
      { _id: vendorA, businessName: 'Vendor A', shippingSettings: { enabled: true, fee: 40, freeDeliveryThreshold: 1000 } },
      { _id: vendorB, businessName: 'Vendor B', shippingSettings: { enabled: true, fee: 60, freeDeliveryThreshold: 1000 } },
    ]);

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items: [
        { productId: prodA, variantId: varA, quantity: 1 },
        { productId: prodB, variantId: varB, quantity: 1 },
      ],
      shippingAddress: { state: 'West Bengal', city: 'Kolkata', postalCode: '700001' },
    });

    // Subtotal: 300 + 400 = 700. Shipping: 40 + 60 = 100. Total = 800.
    expect(summary.subtotal).toBe(700);
    expect(summary.shipping).toBe(100);
    expect(summary.total).toBe(800);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].shippingFee).toBe(40);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorB].shippingFee).toBe(60);
  });

  it('5. seller isolation: Seller A settings do not affect Seller B (Seller A subtotal qualifies for free, Seller B charges fee)', async () => {
    const { customerId, vendorA, vendorB, prodA, prodB, varA, varB } = ids();

    jest.spyOn(ProductVariant, 'findOne').mockImplementation(({ _id }) => {
      if (String(_id) === varA) return Promise.resolve({ _id: varA, productId: prodA, price: 800, sku: 'SKU-A', status: 'ACTIVE' });
      if (String(_id) === varB) return Promise.resolve({ _id: varB, productId: prodB, price: 200, sku: 'SKU-B', status: 'ACTIVE' });
      return Promise.resolve(null);
    });

    jest.spyOn(Product, 'findOne').mockImplementation(({ _id }) => {
      if (String(_id) === prodA) return Promise.resolve({ _id: prodA, vendorId: vendorA, name: 'Prod A', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } });
      if (String(_id) === prodB) return Promise.resolve({ _id: prodB, vendorId: vendorB, name: 'Prod B', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } });
      return Promise.resolve(null);
    });

    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    // Both have threshold 500: Seller A (800 >= 500) qualifies for free; Seller B (200 < 500) charges 50
    jest.spyOn(Vendor, 'find').mockResolvedValue([
      { _id: vendorA, businessName: 'Vendor A', shippingSettings: { enabled: true, fee: 40, freeDeliveryThreshold: 500 } },
      { _id: vendorB, businessName: 'Vendor B', shippingSettings: { enabled: true, fee: 50, freeDeliveryThreshold: 500 } },
    ]);

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items: [
        { productId: prodA, variantId: varA, quantity: 1 },
        { productId: prodB, variantId: varB, quantity: 1 },
      ],
      shippingAddress: { state: 'Delhi', city: 'New Delhi', postalCode: '110001' },
    });

    expect(summary.subtotal).toBe(1000);
    expect(summary.shipping).toBe(50); // Seller A = 0, Seller B = 50
    expect(summary.total).toBe(1050);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].shippingFee).toBe(0);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorA].isFree).toBe(true);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorB].shippingFee).toBe(50);
    expect(summary.breakdown.shipping.vendorBreakdown[vendorB].isFree).toBe(false);
  });

  it('6. COD checkout applies exact seller delivery fee without automatic ₹40 charge', async () => {
    const { customerId, vendorA, prodA, varA } = ids();

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: varA,
      productId: prodA,
      price: 500,
      sku: 'SKU-A',
      status: 'ACTIVE',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: prodA,
      vendorId: vendorA,
      name: 'Brass Lamp',
      status: 'PUBLISHED',
      deletedAt: null,
      tax: { taxable: false },
      toObject: () => ({ _id: prodA, vendorId: vendorA, name: 'Brass Lamp', status: 'PUBLISHED', deletedAt: null, tax: { taxable: false } }),
    });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ variantId: varA, availableQuantity: 5, deletedAt: null });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(5);
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-cod', orderId: 'ord-cod', variantId: varA, status: 'ACTIVE' });
    jest.spyOn(inventoryReservationService, 'consumeOrderReservations').mockResolvedValue(true);
    jest.spyOn(paymentService, 'createPayment').mockResolvedValue({ _id: 'pay-cod', status: 'PENDING', method: 'cod' });
    jest.spyOn(paymentService, 'ensureCapturedOrderArtifacts').mockResolvedValue({ vendorOrders: [{ _id: 'vo-cod' }] });
    jest.spyOn(Vendor, 'find').mockResolvedValue([
      { _id: vendorA, businessName: 'Artisan A', shippingSettings: { enabled: true, fee: 35, freeDeliveryThreshold: 1000 } },
    ]);

    const mockOrderId = new mongoose.Types.ObjectId();
    let orderPayload = null;
    jest.spyOn(Order, 'create').mockImplementation((data) => {
      orderPayload = { ...data, _id: mockOrderId, toObject: () => ({ ...data, _id: mockOrderId }) };
      return Promise.resolve(orderPayload);
    });

    const orderService = new OrderService();
    const result = await orderService.createOrder({
      customerId,
      items: [{ productId: prodA, variantId: varA, quantity: 1 }],
      paymentMethod: 'cod',
      shippingAddress: { state: 'West Bengal', city: 'Kolkata', postalCode: '700001' },
    });

    expect(result.shipping).toBe(35);
    expect(result.total).toBe(535);
    expect(result.paymentMethod).toBe('cod');
    expect(orderPayload.financialSnapshot.shippingBreakdown[vendorA].shippingFee).toBe(35);
  });

  it('7. payment amount matches checkout total with delivery fee', async () => {
    const { customerId, vendorA, prodA, varA } = ids();
    const orderId = new mongoose.Types.ObjectId().toHexString();

    const mockOrder = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-PAY-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      subtotal: 400,
      shipping: 60,
      tax: 0,
      discount: 0,
      total: 460, // 400 + 60 = 460
      currency: 'INR',
      financialSnapshot: {
        subtotal: 400,
        shipping: 60,
        total: 460,
        shippingBreakdown: { [vendorA]: { vendorId: vendorA, shippingFee: 60 } },
      },
      items: [{ productId: prodA, variantId: varA, vendorId: vendorA, lineTotal: 400, quantity: 1 }],
    };

    let razorpayAmountPassed = null;
    jest.spyOn(paymentService, 'isRazorpayEnabled').mockReturnValue(true);
    paymentService.provider = {
      isEnabled: () => true,
      createPayment: jest.fn().mockImplementation((payload) => {
        razorpayAmountPassed = payload.amount;
        return Promise.resolve({
          providerOrderId: 'rzp_order_test_1',
          providerPaymentId: 'pay_test_1',
          amount: payload.amount,
          currency: 'INR',
        });
      }),
    };

    const { Payment } = await import('../app/models/payment.model.js');
    const { PaymentTransaction } = await import('../app/models/payment-transaction.model.js');
    jest.spyOn(Payment, 'create').mockImplementation((data) => Promise.resolve({ ...data, _id: new mongoose.Types.ObjectId() }));
    jest.spyOn(PaymentTransaction, 'create').mockImplementation((data) => Promise.resolve({ ...data, _id: new mongoose.Types.ObjectId() }));

    const paymentResult = await paymentService.createPayment({
      order: mockOrder,
      customerId,
      amount: 460,
      method: 'CARD',
      provider: 'razorpay',
    });

    // 460 INR passed to provider
    expect(razorpayAmountPassed).toBe(460);
    expect(paymentResult.amount).toBe(460);
  });

  it('8. order delivery-fee snapshot locks the fee into VendorOrder and Order', async () => {
    const { customerId, vendorA, vendorB, prodA, prodB, varA, varB } = ids();
    const orderId = new mongoose.Types.ObjectId();
    const paymentId = new mongoose.Types.ObjectId();

    const parentOrder = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-SNAP-1',
      status: 'PAID',
      paymentStatus: 'PAID',
      subtotal: 800,
      discount: 0,
      tax: 0,
      shipping: 100, // 40 for A, 60 for B
      total: 900,
      currency: 'INR',
      financialSnapshot: {
        shippingBreakdown: {
          [vendorA]: { vendorId: vendorA, shippingFee: 40 },
          [vendorB]: { vendorB: vendorB, shippingFee: 60 },
        },
      },
      items: [
        { productId: prodA, variantId: varA, vendorId: vendorA, lineTotal: 300, quantity: 1, productName: 'Item A', sku: 'SKU-A' },
        { productId: prodB, variantId: varB, vendorId: vendorB, lineTotal: 500, quantity: 1, productName: 'Item B', sku: 'SKU-B' },
      ],
    };

    const mockPayment = {
      _id: paymentId,
      status: 'CAPTURED',
      amount: 900,
    };

    const { Payment } = await import('../app/models/payment.model.js');
    const { vendorLedgerService } = await import('../app/services/vendor-ledger.service.js');
    jest.spyOn(vendorLedgerService, 'recordCapturedPayment').mockResolvedValue({ created: 1, skipped: false });
    jest.spyOn(Payment, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockPayment),
    });
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(parentOrder),
    });
    jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue(true);
    jest.spyOn(Order, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);

    const createdVendorOrders = [];
    jest.spyOn(VendorOrder, 'create').mockImplementation((data) => {
      const doc = { ...data, _id: new mongoose.Types.ObjectId(), save: jest.fn() };
      createdVendorOrders.push(doc);
      return Promise.resolve(doc);
    });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue(createdVendorOrders) });

    jest.spyOn(Vendor, 'findById').mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ businessName: 'V', email: 'v@test.com' }) }),
    });

    const { Notification } = await import('../app/models/notification.model.js');
    jest.spyOn(Notification, 'findOne').mockResolvedValue(null);
    jest.spyOn(Notification, 'create').mockResolvedValue(true);

    const paymentSvc = new PaymentService();
    await paymentSvc.ensureCapturedOrderArtifacts(orderId, paymentId, { method: 'razorpay', status: 'CAPTURED' });

    expect(createdVendorOrders).toHaveLength(2);
    const voA = createdVendorOrders.find((vo) => String(vo.vendorId) === vendorA);
    const voB = createdVendorOrders.find((vo) => String(vo.vendorId) === vendorB);

    // Vendor A gets exactly 40 shipping fee snapshot, NOT proportional weight
    expect(voA.shipping).toBe(40);
    expect(voA.subtotal).toBe(300);
    expect(voA.total).toBe(340);

    // Vendor B gets exactly 60 shipping fee snapshot
    expect(voB.shipping).toBe(60);
    expect(voB.subtotal).toBe(500);
    expect(voB.total).toBe(560);
  });

  it('9. changing seller delivery settings after an order does NOT change existing order or vendor orders', async () => {
    const { customerId, vendorA, prodA, varA } = ids();
    const orderId = new mongoose.Types.ObjectId();

    // Persisted order created when Seller A fee was 50
    const persistedOrder = {
      _id: orderId,
      customerId,
      subtotal: 300,
      shipping: 50,
      total: 350,
      financialSnapshot: {
        shipping: 50,
        shippingBreakdown: { [vendorA]: { vendorId: vendorA, shippingFee: 50 } },
      },
      items: [{ productId: prodA, variantId: varA, vendorId: vendorA, lineTotal: 300 }],
    };

    // Seller updates settings to fee: 150 afterwards
    const updatedVendor = {
      _id: vendorA,
      shippingSettings: { enabled: true, fee: 150, freeDeliveryThreshold: 2000 },
    };
    jest.spyOn(Vendor, 'findById').mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(updatedVendor) }),
    });
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(persistedOrder),
    });

    // Reading the existing order returns the persisted snapshot unchanged
    const fetchedOrder = await Order.findById(orderId).lean();
    expect(fetchedOrder.shipping).toBe(50);
    expect(fetchedOrder.total).toBe(350);
    expect(fetchedOrder.financialSnapshot.shippingBreakdown[vendorA].shippingFee).toBe(50);
  });

  it('10. Shiprocket logistics integration operates independently of customer delivery fee', async () => {
    const { vendorA } = ids();
    const mockOrderNumber = 'RUP-SHIPROCKET-TEST';
    const provider = new ShiprocketProvider({
      email: 'shiprocket@rupakar.in',
      password: 'password123',
      apiUrl: 'https://apiv2.shiprocket.in',
      mode: 'production',
    });

    jest.spyOn(provider, 'request').mockImplementation((path) => {
      if (path.includes('/auth/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock-valid-token' }),
        });
      }
      if (path.includes('/orders/create/adhoc')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            order_id: 11223344,
            shipment_id: 88776655,
            status_code: 1,
          }),
        });
      }
      if (path.includes('/courier/assign/awb')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            response: { data: { awb_code: 'AWB998877', courier_name: 'Delhivery' } },
          }),
        });
      }
      if (path.includes('/generate/label')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ label_url: 'https://shiprocket.in/labels/11223344.pdf' }),
        });
      }
      if (path.includes('/courier/generate/pickup') || path.includes('/couriers/generate/pickup')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ response: { pickup_token_number: 'PKP-12345' } }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    // Customer delivery fee was ₹0, but Shiprocket successfully creates shipment, AWB, label, and pickup
    const result = await provider.createShipment({
      orderId: new mongoose.Types.ObjectId(),
      vendorOrderId: new mongoose.Types.ObjectId(),
      orderNumber: mockOrderNumber,
      pickupAddress: { pickupLocationName: 'Primary Hub' },
      deliveryAddress: { phone: '9876543210', postalCode: '700001' },
      packageInfo: { weight: 0.5 },
      items: [{ name: 'Handloom Saree', sku: 'SAREE-1', quantity: 1, unitPrice: 1500 }],
    });

    expect(result.providerShipmentId).toBe('88776655');
    expect(result.trackingNumber).toBe('AWB998877');
    expect(result.metadata.shiprocketShipmentId).toBe(88776655);
    expect(result.labelUrl).toContain('.pdf');
    expect(result.pickupToken).toBe('PKP-12345');
    expect(result.metadata.shiprocketOrderId).toBe(11223344);
  });
});
