import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { authService } from '../services/auth.service.js';
import { cartService } from '../services/cart.service.js';

const router = Router();
export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

export const getRefreshCookieOptions = (nodeEnv = env.NODE_ENV, origin = null) => {
  const isLocalOrigin = Boolean(origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  const isProd = nodeEnv === 'production';
  const hasHttpsFrontend = !isLocalOrigin && (isProd || /^https:\/\//.test(origin || env.FRONTEND_URL));
  const crossSite = hasHttpsFrontend && env.COOKIE_SAMESITE !== 'lax';

  return {
    httpOnly: true,
    secure: hasHttpsFrontend,
    sameSite: crossSite ? 'none' : 'lax',
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    maxAge: env.REFRESH_TOKEN_MAX_AGE_MS,
  };
};

const getRefreshCookieScope = (req = null) => getRefreshCookieOptions(env.NODE_ENV, req?.headers?.origin);

const setRefreshCookie = (res, refreshToken, req = null) => {
  const options = getRefreshCookieScope(req);
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, options);
};

const clearRefreshCookie = (res, req = null) => {
  const options = getRefreshCookieScope(req);
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
    ...(options.domain ? { domain: options.domain } : {}),
    expires: new Date(0),
  });
};

const registerSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), password: z.string().min(8).max(128) });
const registerSellerSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), password: z.string().min(8).max(128), storeName: z.string().trim().min(2).max(160), mobile: z.string().trim().min(7).max(20).optional().or(z.literal('')) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });
const verifyOtpSchema = z.object({ email: z.string().email(), otp: z.string().min(4).max(8) });
const forgotPasswordSchema = z.object({ email: z.string().email() });
const resetPasswordSchema = z.object({ email: z.string().email(), otp: z.string().min(4).max(8), newPassword: z.string().min(8).max(128) });

const safeRedirectUrl = (input) => {
  if (!input || typeof input !== 'string') return `${env.FRONTEND_URL}/account`;
  try {
    const nextUrl = new URL(input, env.FRONTEND_URL);
    if (nextUrl.origin === new URL(env.FRONTEND_URL).origin) return nextUrl.toString();
  } catch {
    // ignore invalid redirects and fall back to the default safe URL
  }
  return `${env.FRONTEND_URL}/account`;
};

router.get('/status', (_req, res) => {
  res.status(200).json({ success: true, data: { auth: 'ready' }, message: 'Auth module ready', requestId: String(_req.headers['x-request-id'] ?? '') });
});

router.get('/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const redirect = safeRedirectUrl(req.query.redirect || req.query.returnTo || undefined);
  const callbackUrl = env.GOOGLE_REDIRECT_URI || `${env.BACKEND_URL}/api/v1/auth/google/callback`;
  const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID || '');
  googleUrl.searchParams.set('redirect_uri', callbackUrl);
  googleUrl.searchParams.set('response_type', 'code');
  googleUrl.searchParams.set('scope', 'openid email profile');
  googleUrl.searchParams.set('state', state);
  googleUrl.searchParams.set('prompt', 'consent');
  googleUrl.searchParams.set('access_type', 'offline');
  const cookieOpts = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
  res.cookie('google_oauth_state', state, cookieOpts);
  res.cookie('google_oauth_redirect', redirect, cookieOpts);
  res.redirect(googleUrl.toString());
});

router.get('/google/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const storedState = req.cookies?.google_oauth_state;
    const storedRedirect = req.cookies?.google_oauth_redirect || `${env.FRONTEND_URL}/account`;
    const clearCookieOpts = {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    };
    res.clearCookie('google_oauth_state', clearCookieOpts);
    res.clearCookie('google_oauth_redirect', clearCookieOpts);

    if (error) {
      return res.redirect(`${env.FRONTEND_URL}/login?authError=${encodeURIComponent('Google sign-in was cancelled or unavailable.')}`);
    }
    if (!code || !state || !storedState || state !== storedState) {
      return res.redirect(`${env.FRONTEND_URL}/login?authError=${encodeURIComponent('Google sign-in could not be verified. Please try again.')}`);
    }

    const callbackUrl = env.GOOGLE_REDIRECT_URI || `${env.BACKEND_URL}/api/v1/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.id_token) {
      throw new Error(tokenPayload.error_description || tokenPayload.error || 'Google token exchange failed');
    }

    const verifiedProfile = await authService.verifyGoogleIdToken(tokenPayload.id_token);

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const profilePayload = await profileResponse.json();
    if (!profileResponse.ok || !profilePayload.email) {
      throw new Error(profilePayload.error || 'Google profile request failed');
    }

    if (
      profilePayload.email?.toLowerCase().trim() !== verifiedProfile.email?.toLowerCase().trim() ||
      String(profilePayload.sub || '').trim() !== String(verifiedProfile.sub || '').trim()
    ) {
      throw new Error('Google profile data does not match the verified ID token');
    }

    const result = await authService.handleGoogleUser({
      ...profilePayload,
      ...verifiedProfile,
      email_verified: verifiedProfile.email_verified,
    });
    setRefreshCookie(res, result.refreshToken, req);
    const accessToken = result.accessToken;
    delete result.refreshToken;
    const redirectTarget = safeRedirectUrl(storedRedirect);
    const targetUrl = new URL(redirectTarget);
    if (accessToken) {
      targetUrl.searchParams.set('token', accessToken);
    }
    return res.redirect(targetUrl.toString());
  } catch (error) {
    next(error);
  }
});

const googleAuthSchema = z.object({
  credential: z.string().optional(),
  idToken: z.string().optional(),
  token: z.string().optional(),
}).refine((data) => data.credential || data.idToken || data.token, {
  message: 'Credential or idToken is required',
});

router.post('/google', async (req, res, next) => {
  try {
    const payload = googleAuthSchema.parse(req.body);
    const idToken = payload.credential || payload.idToken || payload.token;
    const verifiedProfile = await authService.verifyGoogleIdToken(idToken);
    const result = await authService.handleGoogleUser(verifiedProfile);
    setRefreshCookie(res, result.refreshToken, req);
    delete result.refreshToken;

    const guestSessionId = req.headers['x-guest-session-id'] || req.body?.guestSessionId;
    if (guestSessionId && result.user?.id) {
      try {
        await cartService.mergeGuestCart({ userId: result.user.id, guestSessionId });
      } catch (mergeErr) {
        console.warn('[GOOGLE_LOGIN_CART_MERGE_WARNING]', mergeErr.message);
      }
    }

    res.status(200).json({
      success: true,
      data: result,
      message: 'Google login successful',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);
    const result = await authService.register(payload);
    setRefreshCookie(res, result.refreshToken, req);
    delete result.refreshToken;
    res.status(201).json({ success: true, data: result, message: 'User registered successfully. Verification code sent to email.', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

router.post('/register-seller', async (req, res, next) => {
  try {
    const payload = registerSellerSchema.parse(req.body);
    const result = await authService.registerSeller(payload);
    setRefreshCookie(res, result.refreshToken, req);
    delete result.refreshToken;
    res.status(201).json({ success: true, data: result, message: 'Seller registered successfully. Verification code sent to email.', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const payload = verifyOtpSchema.parse(req.body);
    const result = await authService.verifyOtp(payload);
    setRefreshCookie(res, result.refreshToken, req);
    delete result.refreshToken;
    res.status(200).json({ success: true, data: result, message: 'Email verified successfully', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const payload = forgotPasswordSchema.parse(req.body);
    const result = await authService.forgotPassword(payload);
    res.status(200).json({ success: true, data: result, message: 'Password reset code sent to your email', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const payload = resetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword(payload);
    res.status(200).json({ success: true, data: result, message: 'Password reset successfully', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

router.post('/login', async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const result = await authService.login(payload);
    setRefreshCookie(res, result.refreshToken, req);
    delete result.refreshToken;

    const guestSessionId = req.headers['x-guest-session-id'] || req.body?.guestSessionId;
    if (guestSessionId && result.user?.id) {
      try {
        await cartService.mergeGuestCart({ userId: result.user.id, guestSessionId });
      } catch (mergeErr) {
        console.warn('[LOGIN_CART_MERGE_WARNING]', mergeErr.message);
      }
    }

    res.status(200).json({ success: true, data: result, message: 'Login successful', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    const result = await authService.refreshToken(refreshToken);
    setRefreshCookie(res, result.refreshToken, req);
    delete result.refreshToken;
    res.status(200).json({ success: true, data: result, message: 'Token refreshed successfully', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

router.post('/logout', async (req, res, next) => {
  try {
    await authService.revokeRefreshToken(req.cookies?.refresh_token, 'LOGOUT');
    clearRefreshCookie(res, req);
    res.status(200).json({ success: true, data: { loggedOut: true }, message: 'Logged out successfully', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
});

export default router;
