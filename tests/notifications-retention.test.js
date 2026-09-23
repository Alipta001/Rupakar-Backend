import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { notificationService } from '../app/services/notification.service.js';
import { Notification } from '../app/models/notification.model.js';

describe('Notification 10-Day Retention & Query Invariant', () => {
  const userId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('declares a MongoDB TTL index on createdAt expiring after 10 days (864000 seconds)', () => {
    const indexes = Notification.schema.indexes();
    const ttlIndex = indexes.find(
      ([fields, options]) => fields.createdAt === 1 && options?.expireAfterSeconds === 10 * 24 * 60 * 60
    );

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex[1].expireAfterSeconds).toBe(864000);
  });

  it('filters notifications by 10-day retention cutoff in getUserNotifications', async () => {
    const now = Date.now();
    const mockFind = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: 'notif-1', title: 'Order placed', createdAt: new Date(now - 1000) },
              { _id: 'notif-2', title: 'Order packed', createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000) },
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
    expect(filterArg.createdAt).toBeDefined();
    expect(filterArg.createdAt.$gte).toBeInstanceOf(Date);

    // Cutoff should be approximately 10 days ago
    const tenDaysAgoMs = now - 10 * 24 * 60 * 60 * 1000;
    expect(filterArg.createdAt.$gte.getTime()).toBeCloseTo(tenDaysAgoMs, -4);

    expect(result.notifications).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('excludes notifications older than 10 days from unread count', async () => {
    const now = Date.now();
    const countSpy = jest.spyOn(Notification, 'countDocuments').mockResolvedValue(3);

    const unreadCount = await notificationService.getUnreadCount(userId);

    expect(countSpy).toHaveBeenCalledTimes(1);
    const filterArg = countSpy.mock.calls[0][0];

    expect(filterArg.userId).toBe(userId);
    expect(filterArg.readAt).toBeNull();
    expect(filterArg.createdAt).toBeDefined();
    expect(filterArg.createdAt.$gte).toBeInstanceOf(Date);

    const tenDaysAgoMs = now - 10 * 24 * 60 * 60 * 1000;
    expect(filterArg.createdAt.$gte.getTime()).toBeCloseTo(tenDaysAgoMs, -4);
    expect(unreadCount).toBe(3);
  });

  it('marks only eligible non-expired notifications as read in markAllAsRead', async () => {
    const now = Date.now();
    const updateManySpy = jest.spyOn(Notification, 'updateMany').mockResolvedValue({ modifiedCount: 4 });

    const markedCount = await notificationService.markAllAsRead(userId);

    expect(updateManySpy).toHaveBeenCalledTimes(1);
    const filterArg = updateManySpy.mock.calls[0][0];

    expect(filterArg.userId).toBe(userId);
    expect(filterArg.readAt).toBeNull();
    expect(filterArg.createdAt).toBeDefined();
    expect(filterArg.createdAt.$gte).toBeInstanceOf(Date);

    const tenDaysAgoMs = now - 10 * 24 * 60 * 60 * 1000;
    expect(filterArg.createdAt.$gte.getTime()).toBeCloseTo(tenDaysAgoMs, -4);
    expect(markedCount).toBe(4);
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

    // Ensure items between page 1 and page 2 are distinct
    const ids = [...resPage1.notifications, ...resPage2.notifications].map((n) => n._id);
    expect(new Set(ids).size).toBe(3);
  });
});
