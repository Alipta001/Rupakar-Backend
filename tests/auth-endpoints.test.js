import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../app/config/env.js';
import { authService } from '../app/services/auth.service.js';
import { cartService } from '../app/services/cart.service.js';

describe('authenticated endpoint error handling', () => {
  it('returns 401 instead of 500 for an expired access token on /users/me', async () => {
    const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: -1 });
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 instead of 500 for a malformed access token on /users/me', async () => {
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer malformed');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns a controlled 401 when the refresh cookie is missing', async () => {
    const response = await request(app).post('/api/v1/auth/refresh');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('returns a controlled 401 when the refresh cookie is invalid', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=invalid-refresh-token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refreshes an expired access token and returns a retryable access token', async () => {
    const refreshSpy = jest.spyOn(authService, 'refreshToken').mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'fresh-access-token',
      refreshToken: 'replacement-refresh-token',
    });

    try {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'refresh_token=valid-refresh-token');

      expect(response.status).toBe(200);
      expect(response.body.data.accessToken).toBe('fresh-access-token');
      expect(response.body.data.refreshToken).toBeUndefined();
      expect(refreshSpy).toHaveBeenCalledWith('valid-refresh-token');
    } finally {
      refreshSpy.mockRestore();
    }
  });

  it('returns 401 instead of guest 200 for an expired access token on /cart', async () => {
    const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: -1 });
    const response = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 instead of guest 200 for a malformed access token on /cart', async () => {
    const response = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', 'Bearer malformed');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('allows guest access with 200 on /cart when no authorization header is provided', async () => {
    const cartSpy = jest.spyOn(cartService, 'getGuestCart').mockResolvedValue({
      guestSessionId: 'test-guest-session',
      items: [],
      subtotal: 0,
      total: 0,
      itemCount: 0,
    });
    try {
      const response = await request(app)
        .get('/api/v1/cart')
        .set('x-guest-session-id', 'test-guest-session');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('items');
    } finally {
      cartSpy.mockRestore();
    }
  });

  it('returns 401 instead of guest 200 for an expired access token on /wishlist', async () => {
    const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: -1 });
    const response = await request(app)
      .get('/api/v1/wishlist')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('allows guest access with 200 on /wishlist when no authorization header is provided', async () => {
    const response = await request(app).get('/api/v1/wishlist');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('merges guest cart for authenticated user via POST /cart/merge', async () => {
    const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: '1m' });
    const mergeSpy = jest.spyOn(cartService, 'mergeGuestCart').mockResolvedValue({ merged: true });
    const getCartSpy = jest.spyOn(cartService, 'getCartForUser').mockResolvedValue({
      userId: '507f1f77bcf86cd799439011',
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }],
      subtotal: 500,
      total: 500,
      itemCount: 2,
    });
    try {
      const response = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${token}`)
        .set('x-guest-session-id', 'test-guest-session')
        .send({ items: [] });

      expect(response.status).toBe(200);
      expect(response.body.data.itemCount).toBe(2);
      expect(mergeSpy).toHaveBeenCalled();
    } finally {
      mergeSpy.mockRestore();
      getCartSpy.mockRestore();
    }
  });
});