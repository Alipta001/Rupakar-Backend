import { describe, expect, it, jest } from '@jest/globals';
import { requireAuth, requireRole } from '../app/middleware/auth.middleware.js';
import { getAdminSettings } from '../app/controllers/admin.controller.js';

describe('Admin API Authorization and Controller Unit Tests', () => {
  const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  it('blocks unauthenticated requests with 401', () => {
    const req = { headers: {} };
    const res = mockResponse();
    const next = jest.fn();

    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    }));
  });

  it('blocks non-admin users with 403', () => {
    const req = { user: { sub: 'usr-1', role: 'customer' } };
    const res = mockResponse();
    const next = jest.fn();

    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FORBIDDEN',
    }));
  });

  it('allows authenticated admin users through requireRole', () => {
    const req = { user: { sub: 'usr-admin', role: 'admin' } };
    const res = mockResponse();
    const next = jest.fn();

    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('getAdminSettings returns safe public config without leaking credentials', async () => {
    const req = { headers: { 'x-request-id': 'req-999' } };
    const res = mockResponse();
    const next = jest.fn();

    await getAdminSettings(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const sentData = res.json.mock.calls[0][0];
    expect(sentData.success).toBe(true);
    expect(sentData.data.storeName).toBe('Rupakar');
    expect(sentData.data).not.toHaveProperty('JWT_ACCESS_SECRET');
    expect(sentData.data).not.toHaveProperty('DATABASE_URL');
    expect(sentData.data).not.toHaveProperty('MSG91_AUTH_KEY');
  });
});
