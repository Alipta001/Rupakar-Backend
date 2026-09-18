import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

const reservationExpiryQueueName = 'reservation-expiry';

export function getReservationExpiryQueue() {
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  connection.on('error', () => {});

  return new Queue(reservationExpiryQueueName, { connection });
}

export async function scheduleReservationExpiry({ reservationId, expiresAt }) {
  if (!reservationId || !expiresAt) return null;

  try {
    const queue = getReservationExpiryQueue();
    const delayMs = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    await queue.add('expire-reservation', { reservationId }, { delay: delayMs, attempts: 3 });
    await queue.close();
    return true;
  } catch (_error) {
    return null;
  }
}

export async function processReservationExpiry({ reservationId, reservationService }) {
  if (!reservationId || !reservationService) return false;

  try {
    const released = await reservationService.releaseReservation({ orderId: reservationId, variantId: reservationId });
    return Boolean(released);
  } catch (_error) {
    return false;
  }
}
