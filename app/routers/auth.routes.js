import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authService } from '../services/auth.service.js';

const router = Router();

export const getRefreshCookieOptions = (nodeEnv = env.NODE_ENV) => ({
  httpOnly: true,
  secure: nodeEnv === 'production' || /^https:\/\//.test(env.FRONTEND_URL),
  sameSite: nodeEnv === 'production' || /^https:\/\//.test(env.FRONTEND_URL) ? 'none' : 'lax',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

const setRefreshCookie = (res, refreshToken) => {
  res.cookie('refresh_token', refreshToken, getRefreshCookieOptions());
};

const clearRefreshCookie = (res) => {
  const options = getRefreshCookieOptions();
  res.clearCookie('refresh_token', {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  });
};

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4).max(8),
  newPassword: z.string().min(8).max(128),
});

router.get('/status', (_req, res) => {
  res.status(200).json({
    success: true,
    data: { auth: 'ready' },
    message: 'Auth module ready',
    requestId: String(_req.headers['x-request-id'] ?? ''),
  });
});

router.post('/register', async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);
    const result = await authService.register(payload);
    setRefreshCookie(res, result.refreshToken);
    delete result.refreshToken;
    res.status(201).json({
      success: true,
      data: result,
      message: 'User registered successfully. Verification code sent to email.',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const payload = verifyOtpSchema.parse(req.body);
    const result = await authService.verifyOtp(payload);
    setRefreshCookie(res, result.refreshToken);
    delete result.refreshToken;
    res.status(200).json({
      success: true,
      data: result,
      message: 'Email verified successfully',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const payload = forgotPasswordSchema.parse(req.body);
    const result = await authService.forgotPassword(payload);
    res.status(200).json({
      success: true,
      data: result,
      message: 'Password reset code sent to your email',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const payload = resetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword(payload);
    res.status(200).json({
      success: true,
      data: result,
      message: 'Password reset successfully',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const result = await authService.login(payload);
    setRefreshCookie(res, result.refreshToken);
    delete result.refreshToken;
    res.status(200).json({
      success: true,
      data: result,
      message: 'Login successful',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    const result = await authService.refreshToken(refreshToken);
    setRefreshCookie(res, result.refreshToken);
    delete result.refreshToken;
    res.status(200).json({
      success: true,
      data: result,
      message: 'Token refreshed successfully',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await authService.revokeRefreshToken(req.cookies?.refresh_token, 'LOGOUT');
    clearRefreshCookie(res);

    res.status(200).json({
      success: true,
      data: { loggedOut: true },
      message: 'Logged out successfully',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
