import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { env } from '../app/config/env.js';
import { authService } from '../app/services/auth.service.js';

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
});