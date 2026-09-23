import { afterEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { getVendorAnalytics } from '../app/controllers/vendor.controller.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';

const response = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json }, status, json, next: jest.fn() };
};

afterEach(() => jest.restoreAllMocks());

describe('Vendor Analytics Controller', () => {
  const mockVendor = {
    _id: 'vendor-123',
    ownerUserId: 'user-123',
    status: 'APPROVED',
  };

  it('rejects if vendor profile is not found', async () => {
    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const ctx = response();
    await getVendorAnalytics(
      { user: { sub: 'user-123' }, query: {}, headers: {} },
      ctx.res,
      ctx.next
    );

    expect(ctx.next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VENDOR_NOT_FOUND', statusCode: 404 })
    );
  });

  it('returns zero-filled analytics for a 7d range with no orders', async () => {
    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockVendor),
    });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const ctx = response();
    await getVendorAnalytics(
      { user: { sub: 'user-123' }, query: { range: '7d' }, headers: {} },
      ctx.res,
      ctx.next
    );

    expect(ctx.next).not.toHaveBeenCalled();
    expect(ctx.status).toHaveBeenCalledWith(200);
    expect(ctx.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          range: '7d',
          summary: {
            revenue: 0,
            orders: 0,
            unitsSold: 0,
            averageOrderValue: 0,
            customerCount: 0,
          },
          salesTrend: expect.any(Array),
          statusBreakdown: [],
          topProducts: [],
        }),
      })
    );

    const callData = ctx.json.mock.calls[0][0].data;
    // 7 days should generate 7 or 8 points depending on timezone hours
    expect(callData.salesTrend.length).toBeGreaterThanOrEqual(7);
    for (const point of callData.salesTrend) {
      expect(point.revenue).toBe(0);
      expect(point.orders).toBe(0);
      expect(point.units).toBe(0);
    }
  });

  it('correctly aggregates real orders across days, status, and products for 30d range', async () => {
    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockVendor),
    });

    const todayStr = new Date().toISOString();
    const mockOrders = [
      {
        _id: 'vo-1',
        total: 1200,
        status: 'DELIVERED',
        customerId: 'cust-1',
        createdAt: todayStr,
        items: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            productName: 'Terracotta Vase',
            sku: 'TERRA-1',
            quantity: 2,
            lineTotal: 1200,
          },
        ],
      },
      {
        _id: 'vo-2',
        total: 800,
        status: 'SHIPPED',
        customerId: 'cust-2',
        createdAt: todayStr,
        items: [
          {
            productId: 'prod-2',
            variantId: 'var-2',
            productName: 'Clay Lamp',
            sku: 'LAMP-1',
            quantity: 1,
            lineTotal: 800,
          },
        ],
      },
      {
        _id: 'vo-3',
        total: 600,
        status: 'DELIVERED',
        customerId: 'cust-1', // Repeat customer
        createdAt: todayStr,
        items: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            productName: 'Terracotta Vase',
            sku: 'TERRA-1',
            quantity: 1,
            lineTotal: 600,
          },
        ],
      },
    ];

    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockOrders),
    });

    const ctx = response();
    await getVendorAnalytics(
      { user: { sub: 'user-123' }, query: { range: '30d' }, headers: {} },
      ctx.res,
      ctx.next
    );

    expect(ctx.next).not.toHaveBeenCalled();
    const data = ctx.json.mock.calls[0][0].data;

    // Summary assertions
    expect(data.summary.revenue).toBe(2600);
    expect(data.summary.orders).toBe(3);
    expect(data.summary.unitsSold).toBe(4);
    expect(data.summary.customerCount).toBe(2);
    expect(data.summary.averageOrderValue).toBe(Number((2600 / 3).toFixed(2)));

    // Status breakdown assertions
    expect(data.statusBreakdown).toEqual(
      expect.arrayContaining([
        { status: 'DELIVERED', count: 2, revenue: 1800 },
        { status: 'SHIPPED', count: 1, revenue: 800 },
      ])
    );

    // Top products ranking
    expect(data.topProducts[0].productName).toBe('Terracotta Vase');
    expect(data.topProducts[0].revenue).toBe(1800);
    expect(data.topProducts[0].unitsSold).toBe(3);
    expect(data.topProducts[1].productName).toBe('Clay Lamp');
    expect(data.topProducts[1].revenue).toBe(800);
    expect(data.topProducts[1].unitsSold).toBe(1);
  });

  it('guarantees vendor isolation by scoping orders strictly to the authenticated vendor profile', async () => {
    const vendorA = { _id: 'vendor-A', ownerUserId: 'user-A', status: 'APPROVED' };
    const findVendorSpy = jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(vendorA),
    });
    const findOrdersSpy = jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const ctx = response();
    await getVendorAnalytics(
      { user: { sub: 'user-A' }, query: { range: '30d' }, headers: {} },
      ctx.res,
      ctx.next
    );

    expect(findVendorSpy).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'user-A', deletedAt: null }));
    expect(findOrdersSpy).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'vendor-A',
      deletedAt: null,
    }));
    // Proves it does not query any other vendor
    expect(findOrdersSpy).not.toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'vendor-B' }));
  });

  it('verifies GET /api/v1/vendor/analytics route is registered and protected by auth', async () => {
    const unauthenticatedRes = await request(app).get('/api/v1/vendor/analytics');
    expect(unauthenticatedRes.status).toBe(401);
  });

  it('supports 90d and 1y range queries returning correct range in payload', async () => {
    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockVendor),
    });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    for (const range of ['90d', '1y']) {
      const ctx = response();
      await getVendorAnalytics(
        { user: { sub: 'user-123' }, query: { range }, headers: {} },
        ctx.res,
        ctx.next
      );
      expect(ctx.status).toHaveBeenCalledWith(200);
      expect(ctx.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ range }),
        })
      );
    }
  });
});
