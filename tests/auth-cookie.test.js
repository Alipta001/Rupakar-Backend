import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';
import app from '../app.js';
import { authService } from '../app/services/auth.service.js';
import { getRefreshCookieOptions } from '../app/routers/auth.routes.js';

describe('cross-origin refresh authentication', () => {
  it('uses cross-site-safe production refresh cookie attributes', () => {
    expect(getRefreshCookieOptions('production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/v1/auth',
    });
  });

  it('keeps local refresh cookies usable without HTTPS', () => {
    expect(getRefreshCookieOptions('development')).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  });

  it('sets the refresh cookie and allows the production frontend origin', async () => {
    const loginSpy = jest.spyOn(authService, 'login').mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://rupakar-frontend.vercel.app')
      .send({ email: 'customer@example.com', password: 'password123' });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://rupakar-frontend.vercel.app');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['set-cookie'][0]).toContain('refresh_token=refresh-token');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(loginSpy).toHaveBeenCalledTimes(1);
    loginSpy.mockRestore();
  });

  it('passes the refresh cookie to the refresh service', async () => {
    const refreshSpy = jest.spyOn(authService, 'refreshToken').mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://rupakar-frontend.vercel.app')
      .set('Cookie', 'refresh_token=refresh-token');

    expect(response.status).toBe(200);
    expect(refreshSpy).toHaveBeenCalledWith('refresh-token');
    expect(response.body.data.accessToken).toBe('new-access-token');
    refreshSpy.mockRestore();
  });
});