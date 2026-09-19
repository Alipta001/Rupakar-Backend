import request from 'supertest';
import { afterEach, jest } from '@jest/globals';
import app from '../app.js';
import { env } from '../app/config/env.js';

describe('readiness dependencies', () => {
  afterEach(() => {
    env.REDIS_ENABLED = false;
    env.WORKER_ENABLED = true;
    app.locals.redis = null;
    jest.restoreAllMocks();
  });

  it('reports Redis and worker disabled in local mode', async () => {
    env.REDIS_ENABLED = false;
    env.WORKER_ENABLED = false;
    app.locals.redis = null;
    const response = await request(app).get('/api/v1/health/ready');

    expect(response.body.data.redis).toBe('disabled');
    expect(response.body.data.worker).toBe('disabled');
  });

  it('reports unavailable Redis and worker when Redis is required but disconnected', async () => {
    env.REDIS_ENABLED = true;
    env.WORKER_ENABLED = true;
    app.locals.redis = { status: 'end' };

    const response = await request(app).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.data.redis).toBe('not-ready');
    expect(response.body.data.worker).toBe('not-ready');
  });

  it('reports a worker ready only when the heartbeat exists', async () => {
    env.REDIS_ENABLED = true;
    env.WORKER_ENABLED = true;
    app.locals.redis = {
      status: 'ready',
      get: jest.fn().mockResolvedValue('heartbeat'),
    };

    const response = await request(app).get('/api/v1/health/ready');

    expect(response.body.data.redis).toBe('ready');
    expect(response.body.data.worker).toBe('ready');
    expect(app.locals.redis.get).toHaveBeenCalledWith('rupakar:worker:heartbeat');
  });

  it('reports Redis ready and worker disabled when WORKER_ENABLED=false', async () => {
    env.REDIS_ENABLED = true;
    env.WORKER_ENABLED = false;
    app.locals.redis = { status: 'ready', get: jest.fn() };

    const response = await request(app).get('/api/v1/health/ready');

    expect(response.body.data.redis).toBe('ready');
    expect(response.body.data.worker).toBe('disabled');
    expect(app.locals.redis.get).not.toHaveBeenCalled();
  });
});
