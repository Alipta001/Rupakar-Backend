import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { authService } from '../app/services/auth.service.js';
import { User } from '../app/models/user.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Order } from '../app/models/order.model.js';
import { Payment } from '../app/models/payment.model.js';
import { Invoice } from '../app/models/invoice.model.js';
import { Cart } from '../app/models/cart.model.js';
import { Wishlist } from '../app/models/wishlist.model.js';
import { RefreshSession } from '../app/models/refresh-session.model.js';
import { emailService } from '../app/services/email.service.js';
import { env } from '../app/config/env.js';

describe('registration and verification lifecycle', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registration creates user with PENDING_VERIFICATION and hashed OTP expiring in 5 minutes', async () => {
    const userId = new mongoose.Types.ObjectId();
    let createdUserDoc = null;

    jest.spyOn(User, 'findOne').mockResolvedValue(null);
    jest.spyOn(User, 'create').mockImplementation(async (data) => {
      createdUserDoc = {
        _id: userId,
        ...data,
        save: jest.fn().mockResolvedValue(true),
      };
      return createdUserDoc;
    });
    jest.spyOn(RefreshSession, 'create').mockResolvedValue({});
    jest.spyOn(authService, 'issueTokens').mockResolvedValue({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
    });
    const emailSpy = jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({ messageId: 'msg-1' });

    const before = Date.now();
    const result = await authService.register({
      name: 'Rohan Sharma',
      email: 'rohan@example.com',
      password: 'Password123!',
    });
    const after = Date.now();

    expect(createdUserDoc).not.toBeNull();
    expect(createdUserDoc.verificationStatus).toBe('PENDING_VERIFICATION');
    expect(createdUserDoc.isEmailVerified).toBe(false);
    expect(result.user.verificationStatus).toBe('PENDING_VERIFICATION');
    expect(result.user.isEmailVerified).toBe(false);

    // Verify OTP is hashed with sha256 (64 hex characters) and never stored as plaintext
    expect(createdUserDoc.otp).toMatch(/^[0-9a-f]{64}$/);

    // Verify 5-minute expiration
    const expiryTime = createdUserDoc.otpExpiresAt.getTime();
    expect(expiryTime).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(expiryTime).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 1000);

    // Verify email was sent with plaintext OTP
    expect(emailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'rohan@example.com',
        otp: expect.stringMatching(/^\d{6}$/),
      })
    );
  });

  it('successful verification transitions user to VERIFIED and clears temporary OTP & TTL', async () => {
    const rawOtp = '456789';
    const hashedOtp = authService.hashOtp(rawOtp);
    const userDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Rohan Sharma',
      email: 'rohan@example.com',
      role: 'customer',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
      otp: hashedOtp,
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      pendingExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(userDoc);
    jest.spyOn(emailService, 'sendWelcome').mockResolvedValue({});
    jest.spyOn(authService, 'issueTokens').mockResolvedValue({
      accessToken: 'verified-access',
      refreshToken: 'verified-refresh',
    });

    const result = await authService.verifyOtp({ email: 'rohan@example.com', otp: rawOtp });

    expect(userDoc.verificationStatus).toBe('VERIFIED');
    expect(userDoc.isEmailVerified).toBe(true);
    expect(userDoc.otp).toBeNull();
    expect(userDoc.otpExpiresAt).toBeNull();
    expect(userDoc.pendingExpiresAt).toBeNull();
    expect(userDoc.save).toHaveBeenCalled();
    expect(result.user.verificationStatus).toBe('VERIFIED');
    expect(result.user.isEmailVerified).toBe(true);
  });

  it('rejects an incorrect OTP without verifying', async () => {
    const rawOtp = '111222';
    const userDoc = {
      _id: new mongoose.Types.ObjectId(),
      email: 'rohan@example.com',
      otp: authService.hashOtp(rawOtp),
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(userDoc);

    await expect(authService.verifyOtp({ email: 'rohan@example.com', otp: '999999' })).rejects.toMatchObject({
      code: 'INVALID_OTP',
    });
    expect(userDoc.isEmailVerified).toBeUndefined();
  });

  it('expired OTP is rejected, invalidates old OTP, automatically sends a new OTP, and notifies with exact UI message', async () => {
    const oldRawOtp = '123456';
    const userDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Rohan Sharma',
      email: 'rohan@example.com',
      role: 'customer',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
      otp: authService.hashOtp(oldRawOtp),
      otpExpiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(userDoc);
    const emailSpy = jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({ messageId: 'msg-fresh' });

    let caughtError = null;
    try {
      await authService.verifyOtp({ email: 'rohan@example.com', otp: oldRawOtp });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.code).toBe('OTP_EXPIRED_NEW_SENT');
    expect(caughtError.message).toBe('Your previous OTP has expired. A new OTP has been sent to your email.');

    // Verify email was dispatched with a new, different OTP
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const sentOtp = emailSpy.mock.calls[0][0].otp;
    expect(sentOtp).not.toBe(oldRawOtp);

    // Verify user document has updated to new hashed OTP and fresh 5-minute timer
    expect(userDoc.otp).toBe(authService.hashOtp(sentOtp));
    expect(userDoc.otpExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('resend OTP generates fresh OTP, invalidates old OTP, resets 5-minute timer, and enforces rate-limiting', async () => {
    const oldOtp = '112233';
    const userDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Rohan Sharma',
      email: 'rohan@example.com',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
      otp: authService.hashOtp(oldOtp),
      otpExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
      otpResendAvailableAt: new Date(Date.now() - 1000), // Cooldown elapsed
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(userDoc);
    const emailSpy = jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({ messageId: 'msg-resend' });

    const before = Date.now();
    const resendResult = await authService.resendOtp({ email: 'rohan@example.com' });
    const after = Date.now();

    expect(resendResult.message).toContain('fresh verification code');
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const newOtp = emailSpy.mock.calls[0][0].otp;
    expect(newOtp).not.toBe(oldOtp);

    // Old OTP must now be rejected
    expect(userDoc.otp).not.toBe(authService.hashOtp(oldOtp));
    expect(userDoc.otp).toBe(authService.hashOtp(newOtp));

    // Expiry timer reset to 5 minutes
    expect(userDoc.otpExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(userDoc.otpExpiresAt.getTime()).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 1000);

    // Immediate rapid resend attempt is rate-limited
    await expect(authService.resendOtp({ email: 'rohan@example.com' })).rejects.toMatchObject({
      code: 'RESEND_COOLDOWN',
    });

    // New OTP successfully verifies
    jest.spyOn(authService, 'issueTokens').mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    jest.spyOn(emailService, 'sendWelcome').mockResolvedValue({});
    const verifyResult = await authService.verifyOtp({ email: 'rohan@example.com', otp: newOtp });
    expect(verifyResult.user.verificationStatus).toBe('VERIFIED');
  });

  it('fails safely and allows retry when email provider rejects request during resend', async () => {
    const userDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Rohan Sharma',
      email: 'rohan@example.com',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
      otp: authService.hashOtp('123456'),
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      otpResendAvailableAt: null,
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(userDoc);
    jest.spyOn(emailService, 'sendOtpEmail').mockRejectedValue(new Error('Resend API key quota exceeded'));

    await expect(authService.resendOtp({ email: 'rohan@example.com' })).rejects.toMatchObject({
      code: 'EMAIL_SEND_FAILED',
    });
  });

  it('duplicate pending registration updates the existing account instead of creating duplicates', async () => {
    const existingPendingUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Old Name',
      email: 'rohan@example.com',
      role: 'customer',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(existingPendingUser);
    const createSpy = jest.spyOn(User, 'create');
    jest.spyOn(emailService, 'sendOtpEmail').mockResolvedValue({ messageId: 'm' });
    jest.spyOn(authService, 'issueTokens').mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    await authService.register({
      name: 'Updated Rohan',
      email: 'rohan@example.com',
      password: 'NewPassword123!',
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(existingPendingUser.name).toBe('Updated Rohan');
    expect(existingPendingUser.verificationStatus).toBe('PENDING_VERIFICATION');
    expect(existingPendingUser.save).toHaveBeenCalled();
  });

  it('verified user registration is protected and rejected with 409 conflict', async () => {
    const existingVerifiedUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Verified Customer',
      email: 'verified@example.com',
      verificationStatus: 'VERIFIED',
      isEmailVerified: true,
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(existingVerifiedUser);

    await expect(
      authService.register({
        name: 'Another User',
        email: 'verified@example.com',
        password: 'Password123!',
      })
    ).rejects.toMatchObject({
      code: 'USER_ALREADY_EXISTS',
    });
  });

  it('login blocks unverified pending accounts until email verification is complete', async () => {
    const unverifiedUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'rohan@example.com',
      password: '$2a$12$abcdefg',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(unverifiedUser);
    const bcrypt = await import('bcryptjs');
    jest.spyOn(bcrypt.default, 'compare').mockResolvedValue(true);

    await expect(
      authService.login({ email: 'rohan@example.com', password: 'Password123!' })
    ).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('cleanupPendingRegistrations cleans up expired unverified users while protecting verified and business users', async () => {
    const now = new Date();
    const expiredPendingUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'abandoned@example.com',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
      pendingExpiresAt: new Date(now.getTime() - 1000),
    };

    const businessPendingUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'has-order@example.com',
      verificationStatus: 'PENDING_VERIFICATION',
      isEmailVerified: false,
      pendingExpiresAt: new Date(now.getTime() - 1000),
    };

    const verifiedUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'verified@example.com',
      verificationStatus: 'VERIFIED',
      isEmailVerified: true,
      pendingExpiresAt: new Date(now.getTime() - 1000),
    };

    jest.spyOn(User, 'find').mockResolvedValue([expiredPendingUser, businessPendingUser, verifiedUser]);

    // Mock business records: businessPendingUser has an existing order
    jest.spyOn(Order, 'exists').mockImplementation(async ({ userId }) => {
      return String(userId) === String(businessPendingUser._id);
    });
    jest.spyOn(Payment, 'exists').mockResolvedValue(false);
    jest.spyOn(Invoice, 'exists').mockResolvedValue(false);
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(null);

    const deleteCartSpy = jest.spyOn(Cart, 'deleteMany').mockResolvedValue({ acknowledged: true });
    const deleteWishlistSpy = jest.spyOn(Wishlist, 'deleteMany').mockResolvedValue({ acknowledged: true });
    const deleteSessionSpy = jest.spyOn(RefreshSession, 'deleteMany').mockResolvedValue({ acknowledged: true });
    const deleteUserSpy = jest.spyOn(User, 'deleteOne').mockResolvedValue({ acknowledged: true });

    const result = await authService.cleanupPendingRegistrations({ now });

    expect(result.deletedCount).toBe(1);
    expect(result.skippedCount).toBe(2);

    // Only the genuinely abandoned user was deleted
    expect(deleteUserSpy).toHaveBeenCalledWith({ _id: expiredPendingUser._id });
    expect(deleteUserSpy).not.toHaveBeenCalledWith({ _id: businessPendingUser._id });
    expect(deleteUserSpy).not.toHaveBeenCalledWith({ _id: verifiedUser._id });

    // Cleanup idempotency: running again with no matches yields 0 deletions
    jest.spyOn(User, 'find').mockResolvedValue([]);
    const idempotentResult = await authService.cleanupPendingRegistrations({ now });
    expect(idempotentResult.deletedCount).toBe(0);
    expect(idempotentResult.skippedCount).toBe(0);
  });
});
