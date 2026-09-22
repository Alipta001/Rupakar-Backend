import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { User } from '../models/user.model.js';
import { RefreshSession } from '../models/refresh-session.model.js';
import { Vendor } from '../models/vendor.model.js';
import { emailService } from './email.service.js';
import crypto from 'node:crypto';

export class AuthService {
  async register(data, options = {}) {
    const email = data.email.toLowerCase().trim();
    const forceRole = options.role === 'vendor' ? 'vendor' : 'customer';
    let user = await User.findOne({ email });

    if (user && user.isEmailVerified) {
      throw new AppError(409, 'USER_ALREADY_EXISTS', 'A user with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (user) {
      user.name = data.name.trim();
      user.password = hashedPassword;
      user.role = user.role ?? forceRole;
      if (forceRole === 'vendor') {
        user.role = 'vendor';
      }
      user.otp = otp;
      user.otpExpiresAt = otpExpiresAt;
      user.isEmailVerified = false;
      await user.save();
    } else {
      user = await User.create({
        name: data.name.trim(),
        email,
        password: hashedPassword,
        role: forceRole,
        otp,
        otpExpiresAt,
        isEmailVerified: false,
      });
    }

    try {
      await emailService.sendOtpEmail({
        email: user.email,
        name: user.name,
        otp,
      });
    } catch (emailError) {
      console.error('[AUTH REGISTER EMAIL ERROR]', emailError);
      // We don't fail registration if mail transport has transient network issue,
      // but we log it so OTP is still accessible in dev
    }

    const tokens = await this.issueTokens(user._id.toString(), user.role);
    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
      ...tokens,
      message: 'Verification code sent to your email address',
    };
  }

  async registerSeller(data) {
    const result = await this.register(
      {
        name: data.name,
        email: data.email,
        password: data.password,
      },
      { role: 'vendor' },
    );

    const userId = result.user.id;
    const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null });
    if (!vendor) {
      await Vendor.create({
        ownerUserId: userId,
        businessName: data.storeName.trim(),
        legalName: data.storeName.trim(),
        email: data.email.toLowerCase().trim(),
        phone: data.mobile?.trim() || '',
        status: 'PENDING',
        verificationStatus: 'UNVERIFIED',
      });
    }

    return {
      ...result,
      user: {
        ...result.user,
        role: 'vendor',
      },
    };
  }

  async verifyOtp({ email, otp }) {
    if (!email || !otp) {
      throw new AppError(400, 'INVALID_INPUT', 'Email and OTP are required');
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'No account found with this email');
    }

    if (!user.otp || user.otp !== String(otp).trim()) {
      throw new AppError(400, 'INVALID_OTP', 'The verification code provided is incorrect');
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new AppError(400, 'OTP_EXPIRED', 'The verification code has expired. Please request a new one');
    }

    user.isEmailVerified = true;
    user.otp = null;
    user.otpExpiresAt = null;
    user.lastLogin = new Date();
    await user.save();

    emailService.sendWelcome({ email: user.email, name: user.name }).catch((err) => {
      console.warn('[WELCOME EMAIL ERROR]', err.message);
    });

    const tokens = await this.issueTokens(user._id.toString(), user.role);
    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
      ...tokens,
      message: 'Email verified successfully',
    };
  }

  async forgotPassword({ email }) {
    if (!email) {
      throw new AppError(400, 'INVALID_INPUT', 'Email is required');
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'No account found with this email address');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await emailService.sendPasswordResetOtp({
      email: user.email,
      otp,
    });

    return {
      message: 'Password reset code sent to your email',
    };
  }

  async resetPassword({ email, otp, newPassword }) {
    if (!email || !otp || !newPassword) {
      throw new AppError(400, 'INVALID_INPUT', 'Email, OTP, and new password are required');
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'No account found with this email');
    }

    if (!user.otp || user.otp !== String(otp).trim()) {
      throw new AppError(400, 'INVALID_OTP', 'The verification code provided is incorrect');
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new AppError(400, 'OTP_EXPIRED', 'The verification code has expired. Please request a new one');
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.otp = null;
    user.otpExpiresAt = null;
    await user.save();
    await this.revokeUserSessions(user._id, 'PASSWORD_RESET');

    return {
      message: 'Password reset successfully. You can now log in with your new password.',
    };
  }

  async login(data) {
    const user = await User.findOne({ email: data.email.toLowerCase() });
    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const isValid = await bcrypt.compare(data.password, user.password);
    if (!isValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const tokens = await this.issueTokens(user._id.toString(), user.role);
    user.lastLogin = new Date();
    await user.save();

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      ...tokens,
    };
  }

  async refreshToken(refreshToken) {
    if (!refreshToken) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is required');
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch (_error) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    }

    if (decoded.type !== 'refresh' || !decoded.jti || !decoded.familyId) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
    }

    const tokenHash = this.hashToken(refreshToken);
    const session = await RefreshSession.findOne({ tokenHash });
    if (!session || session.expiresAt <= new Date()) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is expired or invalid');
    }
    if (session.revokedAt) {
      await RefreshSession.updateMany({ familyId: session.familyId, revokedAt: null }, {
        $set: { revokedAt: new Date(), revokeReason: 'REFRESH_TOKEN_REUSE' },
      });
      throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token has already been used');
    }

    const user = await User.findById(decoded.sub).select('-password');
    if (!user || !user.isActive) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'User no longer exists or is inactive');
    }

    const tokens = await this.issueTokens(user._id.toString(), user.role, session.familyId);
    const replacementHash = this.hashToken(tokens.refreshToken);
    const rotated = await RefreshSession.updateOne(
      { _id: session._id, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedByHash: replacementHash, revokeReason: 'ROTATED' } },
    );
    if (rotated.modifiedCount !== 1) {
      await this.revokeSessionFamily(session.familyId, 'REFRESH_TOKEN_REUSE');
      throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token has already been used');
    }
    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      ...tokens,
    };
  }

  async revokeRefreshToken(refreshToken, reason = 'LOGOUT') {
    if (!refreshToken) return;
    await RefreshSession.updateOne(
      { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: reason } },
    );
  }

  async revokeUserSessions(userId, reason = 'SECURITY_EVENT') {
    if (!userId) return;
    await RefreshSession.updateMany({ userId, revokedAt: null }, {
      $set: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeSessionFamily(familyId, reason = 'SECURITY_EVENT') {
    if (!familyId) return;
    await RefreshSession.updateMany({ familyId, revokedAt: null }, {
      $set: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async issueTokens(userId, role, familyId = crypto.randomUUID()) {
    const jti = crypto.randomUUID();
    const accessToken = jwt.sign(
      { sub: userId, role },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.ACCESS_TOKEN_EXPIRATION },
    );

    const refreshToken = jwt.sign(
      { sub: userId, role, type: 'refresh', jti, familyId },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.REFRESH_TOKEN_EXPIRATION },
    );

    await RefreshSession.create({
      userId,
      familyId,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_MAX_AGE_MS),
    });

    return { accessToken, refreshToken };
  }

  signTokens(userId, role) {
    return {
      accessToken: jwt.sign({ sub: userId, role }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_EXPIRATION }),
      refreshToken: jwt.sign({ sub: userId, role, type: 'refresh' }, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_EXPIRATION }),
    };
  }
}

export const authService = new AuthService();
