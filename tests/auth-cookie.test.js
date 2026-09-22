import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';
import app from '../app.js';
import { authService } from '../app/services/auth.service.js';
import { getRefreshCookieOptions, REFRESH_TOKEN_COOKIE_NAME } from '../app/routers/auth.routes.js';
import { env } from '../app/config/env.js';

describe('cross-origin refresh authentication', () => {
  it('uses cross-site-safe production refresh cookie attributes', () => {
    expect(getRefreshCookieOptions('production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
  });

  it('keeps local refresh cookies usable without HTTPS', () => {
    const originalFrontendUrl = env.FRONTEND_URL;
    env.FRONTEND_URL = 'http://localhost:3000';

    try {
      expect(getRefreshCookieOptions('development')).toMatchObject({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      });
    } finally {
      env.FRONTEND_URL = originalFrontendUrl;
    }
  });

  it('uses cross-site-safe cookies when an HTTPS frontend is configured', () => {
    const originalFrontendUrl = env.FRONTEND_URL;
    env.FRONTEND_URL = 'https://rupakar-frontend.vercel.app';

    try {
      expect(getRefreshCookieOptions('development')).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
      });
    } finally {
      env.FRONTEND_URL = originalFrontendUrl;
    }
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
    expect(response.body.data.accessToken).toBe('access-token');
    expect(response.body.data.refreshToken).toBeUndefined();
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

  it('clears the same refresh cookie on logout', async () => {
    const revokeSpy = jest.spyOn(authService, 'revokeRefreshToken').mockResolvedValue();

    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://rupakar-frontend.vercel.app')
      .set('Cookie', 'refresh_token=refresh-token');

    expect(response.status).toBe(200);
    expect(revokeSpy).toHaveBeenCalledWith('refresh-token', 'LOGOUT');
    expect(response.headers['set-cookie'][0]).toContain('refresh_token=;');
    expect(response.headers['set-cookie'][0]).toContain('Path=/');
    revokeSpy.mockRestore();
  });

  it('uses one refresh cookie name and exact same scope for login, refresh rotation, and logout', async () => {
    const loginSpy = jest.spyOn(authService, 'login').mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token-v1',
    });

    const refreshSpy = jest.spyOn(authService, 'refreshToken').mockResolvedValue({
      user: { id: 'user-1' },
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-v2',
    });

    const logoutSpy = jest.spyOn(authService, 'revokeRefreshToken').mockResolvedValue();

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://rupakar-frontend.vercel.app')
      .send({ email: 'customer@example.com', password: 'password123' });

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://rupakar-frontend.vercel.app')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE_NAME}=refresh-token-v1`);

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://rupakar-frontend.vercel.app')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE_NAME}=refresh-token-v2`);

    const loginCookie = loginRes.headers['set-cookie'][0];
    const refreshCookie = refreshRes.headers['set-cookie'][0];
    const logoutCookie = logoutRes.headers['set-cookie'][0];

    expect(loginCookie).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=refresh-token-v1`);
    expect(loginCookie).toContain('Path=/');
    expect(refreshCookie).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=refresh-token-v2`);
    expect(refreshCookie).toContain('Path=/');
    expect(logoutCookie).toContain(`${REFRESH_TOKEN_COOKIE_NAME}=;`);
    expect(logoutCookie).toContain('Path=/');

    expect(loginCookie.match(new RegExp(`${REFRESH_TOKEN_COOKIE_NAME}`, 'g'))).toHaveLength(1);
    expect(refreshCookie.match(new RegExp(`${REFRESH_TOKEN_COOKIE_NAME}`, 'g'))).toHaveLength(1);
    expect(logoutCookie.match(new RegExp(`${REFRESH_TOKEN_COOKIE_NAME}`, 'g'))).toHaveLength(1);

    loginSpy.mockRestore();
    refreshSpy.mockRestore();
    logoutSpy.mockRestore();
  });
});
