import { describe, it, expect, jest } from '@jest/globals';
import { getQueueConnection, ensureQueueConnection, getEmailQueue } from '../app/jobs/queues.js';
import { env } from '../app/config/env.js';

describe('Redis & BullMQ Queue Resilience', () => {
  it('queue connection is initialized with resilient retryStrategy and maxRetriesPerRequest: null', () => {
    const connection = getQueueConnection();
    expect(connection).toBeDefined();
    expect(connection.options.maxRetriesPerRequest).toBeNull();
    expect(typeof connection.options.retryStrategy).toBe('function');

    // Verify retry strategy returns exponential backoff delay instead of null
    const delay1 = connection.options.retryStrategy(1);
    const delay2 = connection.options.retryStrategy(10);
    expect(delay1).toBeGreaterThanOrEqual(100);
    expect(delay2).toBeGreaterThanOrEqual(1000);
    expect(delay2).toBeLessThanOrEqual(3000);
  });

  it('ensureQueueConnection reconnects if connection status is not ready', async () => {
    const connection = getQueueConnection();
    const originalStatus = connection.status;
    const connectSpy = jest.spyOn(connection, 'connect').mockResolvedValue(true);

    try {
      connection.status = 'wait';
      await ensureQueueConnection();
      expect(connectSpy).toHaveBeenCalled();
    } finally {
      connection.status = originalStatus;
      connectSpy.mockRestore();
    }
  });

  it('email queue correctly registers BullMQ job structure', () => {
    const queue = getEmailQueue();
    expect(queue.name).toBe('email');
    expect(queue.opts.connection).toBeDefined();
  });
});
