import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { notificationService } from '../app/services/notification.service.js';
import { Notification } from '../app/models/notification.model.js';
import { env } from '../app/config/env.js';

describe('Notification 15-Day Read Retention & Preservation of Unread', () => {
  const userId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('does NOT have an indiscriminate TTL index on createdAt', () => {
    const indexes = Notification.schema.indexes();
    const indiscriminateTtl = indexes.find(
      ([fields, options]) => fields.createdAt === 1 && typeof options?.expireAfterSeconds === 'number'
    );
    expect(indiscriminateTtl).toBeUndefined();
  });

  it('has dedicated indexes on readAt and compound (userId, readAt, createdAt) for efficient cleanup and retrieval', () => {
    const indexes = Notification.schema.indexes();
    const readAtIndex = indexes.find(([fields]) => fields.readAt === 1);
    const compoundIndex = indexes.find(
      ([fields]) => fields.userId === 1 && fields.readAt === 1 && fields.createdAt === -1
    );

    expect(readAtIndex).toBeDefined();
    expect(compoundIndex).toBeDefined();
  });

  it('preserves unread notifications regardless of age in getUserNotifications', async () => {
    const mockFind = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: 'notif-unread-old', title: 'Unread 60 days old', readAt: null, createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
              { _id: 'notif-read-recent', title: 'Read 2 days ago', readAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
            ]),
          }),
        }),
      }),
    });

    jest.spyOn(Notification, 'find').mockImplementation(mockFind);
    jest.spyOn(Notification, 'countDocuments').mockResolvedValue(2);

    const result = await notificationService.getUserNotifications(userId, { page: 1, limit: 20 });

    expect(mockFind).toHaveBeenCalled();
    const filterArg = mockFind.mock.calls[0][0];

    expect(filterArg.userId).toBe(userId);
    // Must contain $or to retain unread notifications (readAt: null) and read notifications >= cutoff
    expect(filterArg.$or).toBeDefined();
    expect(filterArg.$or).toEqual(
      expect.arrayContaining([
        { readAt: null },
        expect.objectContaining({ readAt: expect.objectContaining({ $gte: expect.any(Date) }) }),
      ])
    );

    expect(result.notifications).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('counts ALL unread notifications in getUnreadCount without dropping old unread items', async () => {
    const countSpy = jest.spyOn(Notification, 'countDocuments').mockResolvedValue(7);

    const unreadCount = await notificationService.getUnreadCount(userId);

    expect(countSpy).toHaveBeenCalledTimes(1);
    const filterArg = countSpy.mock.calls[0][0];

    expect(filterArg.userId).toBe(userId);
    expect(filterArg.readAt).toBeNull();
    // Must NOT have a createdAt restriction that expires unread notifications
    expect(filterArg.createdAt).toBeUndefined();
    expect(unreadCount).toBe(7);
  });

  it('cleanupExpiredReadNotifications deletes ONLY read notifications older than retention days and leaves unread intact', async () => {
    const deleteManySpy = jest.spyOn(Notification, 'deleteMany').mockResolvedValue({ deletedCount: 12 });

    const result = await notificationService.cleanupExpiredReadNotifications({ retentionDays: 15 });

    expect(deleteManySpy).toHaveBeenCalledTimes(1);
    const deleteFilter = deleteManySpy.mock.calls[0][0];

    // Filter must explicitly target readAt: { $ne: null, $lt: cutoff }
    expect(deleteFilter.readAt).toBeDefined();
    expect(deleteFilter.readAt.$ne).toBeNull();
    expect(deleteFilter.readAt.$lt).toBeInstanceOf(Date);

    const fifteenDaysAgoMs = Date.now() - 15 * 24 * 60 * 60 * 1000;
    expect(deleteFilter.readAt.$lt.getTime()).toBeCloseTo(fifteenDaysAgoMs, -4);
    expect(result.deletedCount).toBe(12);
  });

  it('respects configurable retention days from environment / arguments', async () => {
    const deleteManySpy = jest.spyOn(Notification, 'deleteMany').mockResolvedValue({ deletedCount: 5 });

    await notificationService.cleanupExpiredReadNotifications({ retentionDays: 30 });

    const deleteFilter = deleteManySpy.mock.calls[0][0];
    const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(deleteFilter.readAt.$lt.getTime()).toBeCloseTo(thirtyDaysAgoMs, -4);
  });

  it('marks unread notifications as read across any age in markAllAsRead', async () => {
    const updateManySpy = jest.spyOn(Notification, 'updateMany').mockResolvedValue({ modifiedCount: 3 });

    const markedCount = await notificationService.markAllAsRead(userId);

    expect(updateManySpy).toHaveBeenCalledTimes(1);
    const filterArg = updateManySpy.mock.calls[0][0];

    expect(filterArg.userId).toBe(userId);
    expect(filterArg.readAt).toBeNull();
    expect(filterArg.createdAt).toBeUndefined();
    expect(markedCount).toBe(3);
  });

  it('supports pagination without duplicating notifications across pages', async () => {
    const page1Items = [{ _id: 'n-1' }, { _id: 'n-2' }];
    const page2Items = [{ _id: 'n-3' }];

    jest.spyOn(Notification, 'find')
      .mockReturnValueOnce({
        sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => page1Items }) }) }),
      })
      .mockReturnValueOnce({
        sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => page2Items }) }) }),
      });
    jest.spyOn(Notification, 'countDocuments').mockResolvedValue(3);

    const resPage1 = await notificationService.getUserNotifications(userId, { page: 1, limit: 2 });
    const resPage2 = await notificationService.getUserNotifications(userId, { page: 2, limit: 2 });

    expect(resPage1.notifications.map((n) => n._id)).toEqual(['n-1', 'n-2']);
    expect(resPage2.notifications.map((n) => n._id)).toEqual(['n-3']);

    const ids = [...resPage1.notifications, ...resPage2.notifications].map((n) => n._id);
    expect(new Set(ids).size).toBe(3);
  });
});
