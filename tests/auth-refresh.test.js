import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthService } from '../app/services/auth.service.js';
import { RefreshSession } from '../app/models/refresh-session.model.js';
import { User } from '../app/models/user.model.js';
import { env } from '../app/config/env.js';

const userId = '507f1f77bcf86cd799439011';

const userQuery = (user) => ({
  select: jest.fn().mockResolvedValue(user),
});

const createRefreshToken = (overrides = {}) => jwt.sign({
  sub: userId,
  role: 'customer',
  type: 'refresh',
  jti: 'refresh-jti',
  familyId: 'family-1',
  ...overrides,
}, env.JWT_REFRESH_SECRET, { expiresIn: overrides.exp ? undefined : '7d' });

describe('refresh token sessions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('rotates a valid refresh token and persists its replacement', async () => {
    const service = new AuthService();
    const token = createRefreshToken();
    jest.spyOn(RefreshSession, 'findOne').mockResolvedValue({
      _id: 'session-1',
      userId,
      familyId: 'family-1',
      tokenHash: service.hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    jest.spyOn(RefreshSession, 'create').mockResolvedValue({});
    jest.spyOn(RefreshSession, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(User, 'findById').mockReturnValue(userQuery({ _id: userId, role: 'customer', isActive: true }));

    const result = await service.refreshToken(token);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshToken).not.toBe(token);
    expect(RefreshSession.updateOne).toHaveBeenCalledWith(
      { _id: 'session-1', revokedAt: null },
      expect.objectContaining({ $set: expect.objectContaining({ revokeReason: 'ROTATED' }) }),
    );
  });

  it('rejects expired refresh tokens', async () => {
    const service = new AuthService();
    const token = jwt.sign({ sub: userId, role: 'customer', type: 'refresh', jti: 'expired', familyId: 'family-1' }, env.JWT_REFRESH_SECRET, { expiresIn: -1 });
    await expect(service.refreshToken(token)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });

  it('replaces an expired access token with a new access token from the refresh session', async () => {
    const service = new AuthService();
    const expiredAccessToken = jwt.sign({ sub: userId, role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: -1 });
    const refreshToken = createRefreshToken();
    jest.spyOn(RefreshSession, 'findOne').mockResolvedValue({
      _id: 'session-1',
      userId,
      familyId: 'family-1',
      tokenHash: service.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    jest.spyOn(RefreshSession, 'create').mockResolvedValue({});
    jest.spyOn(RefreshSession, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(User, 'findById').mockReturnValue(userQuery({ _id: userId, role: 'customer', isActive: true }));

    expect(() => jwt.verify(expiredAccessToken, env.JWT_ACCESS_SECRET)).toThrow();
    const result = await service.refreshToken(refreshToken);
    expect(() => jwt.verify(result.accessToken, env.JWT_ACCESS_SECRET)).not.toThrow();
    expect(result.accessToken).not.toBe(expiredAccessToken);
  });

  it('allows only one of simultaneous refreshes to rotate the same session', async () => {
    const service = new AuthService();
    const token = createRefreshToken();
    jest.spyOn(RefreshSession, 'findOne').mockResolvedValue({
      _id: 'session-1',
      userId,
      familyId: 'family-1',
      tokenHash: service.hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    jest.spyOn(RefreshSession, 'create').mockResolvedValue({});
    let updateCount = 0;
    jest.spyOn(RefreshSession, 'updateOne').mockImplementation(async () => {
      updateCount += 1;
      return { modifiedCount: updateCount === 1 ? 1 : 0 };
    });
    jest.spyOn(RefreshSession, 'updateMany').mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(User, 'findById').mockReturnValue(userQuery({ _id: userId, role: 'customer', isActive: true }));

    const results = await Promise.allSettled([
      service.refreshToken(token),
      service.refreshToken(token),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
  });

  it('revokes only the reused refresh-token family after a rotation race', async () => {
    const service = new AuthService();
    const token = createRefreshToken();
    jest.spyOn(RefreshSession, 'findOne').mockResolvedValue({
      _id: 'session-1',
      userId,
      familyId: 'family-1',
      tokenHash: service.hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    jest.spyOn(RefreshSession, 'create').mockResolvedValue({});
    jest.spyOn(RefreshSession, 'updateOne').mockResolvedValue({ modifiedCount: 0 });
    const revokeFamilySpy = jest.spyOn(RefreshSession, 'updateMany').mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(User, 'findById').mockReturnValue(userQuery({ _id: userId, role: 'customer', isActive: true }));

    await expect(service.refreshToken(token)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

    expect(revokeFamilySpy).toHaveBeenCalledWith(
      { familyId: 'family-1', revokedAt: null },
      expect.objectContaining({ $set: expect.objectContaining({ revokeReason: 'REFRESH_TOKEN_REUSE' }) }),
    );
  });

  it('rejects revoked tokens and revokes the rest of the token family on reuse', async () => {
    const service = new AuthService();
    const token = createRefreshToken();
    jest.spyOn(RefreshSession, 'findOne').mockResolvedValue({
      _id: 'session-1',
      userId,
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
    });
    const revokeSpy = jest.spyOn(RefreshSession, 'updateMany').mockResolvedValue({ modifiedCount: 1 });

    await expect(service.refreshToken(token)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(revokeSpy).toHaveBeenCalledWith(
      { familyId: 'family-1', revokedAt: null },
      expect.objectContaining({ $set: expect.objectContaining({ revokeReason: 'REFRESH_TOKEN_REUSE' }) }),
    );
  });

  it('invalidates a refresh token during logout', async () => {
    const service = new AuthService();
    const token = createRefreshToken();
    const revokeSpy = jest.spyOn(RefreshSession, 'updateOne').mockResolvedValue({ modifiedCount: 1 });

    await service.revokeRefreshToken(token, 'LOGOUT');

    expect(revokeSpy).toHaveBeenCalledWith(
      { tokenHash: service.hashToken(token), revokedAt: null },
      { $set: expect.objectContaining({ revokeReason: 'LOGOUT' }) },
    );
  });

  it('invalidates all sessions after password reset', async () => {
    const service = new AuthService();
    const password = await bcrypt.hash('old-password', 4);
    jest.spyOn(User, 'findOne').mockResolvedValue({
      _id: userId,
      password,
      otp: '123456',
      otpExpiresAt: new Date(Date.now() + 60_000),
      save: jest.fn().mockResolvedValue(true),
    });
    const revokeSpy = jest.spyOn(RefreshSession, 'updateMany').mockResolvedValue({ modifiedCount: 2 });

    await service.resetPassword({ email: 'customer@example.com', otp: '123456', newPassword: 'new-password' });

    expect(revokeSpy).toHaveBeenCalledWith(
      { userId, revokedAt: null },
      expect.objectContaining({ $set: expect.objectContaining({ revokeReason: 'PASSWORD_RESET' }) }),
    );
  });
});
