import { describe, expect, it, jest } from '@jest/globals';
import { errorHandler } from '../app/middleware/error-handler.js';
import { AppError } from '../app/utils/app-error.js';
import { z } from 'zod';

describe('Global Error Handler Middleware', () => {
  const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  it('formats AppError with correct status code, business code, human-readable message, and requestId', () => {
    const err = new AppError(409, 'ORDER_ALREADY_PACKED', 'This order can no longer be cancelled because it has already been packed');
    const req = { headers: { 'x-request-id': 'req-test-123' }, url: '/api/v1/orders/1/cancel' };
    const res = mockResponse();
    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: {
        code: 'ORDER_ALREADY_PACKED',
        message: 'This order can no longer be cancelled because it has already been packed',
      },
      requestId: 'req-test-123',
    }));
  });

  it('formats Zod validation error with 400 and clear message', () => {
    const schema = z.object({ reason: z.string().min(3, 'Reason must be at least 3 characters') });
    let zodError;
    try {
      schema.parse({ reason: 'no' });
    } catch (e) {
      zodError = e;
    }

    const req = { headers: { 'x-request-id': 'req-zod-456' }, url: '/api/v1/orders/1/cancel' };
    const res = mockResponse();
    const next = jest.fn();

    errorHandler(zodError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('Reason must be at least 3 characters'),
      }),
      requestId: 'req-zod-456',
    }));
  });

  it('returns safe message and status 500 for unexpected errors without leaking stack traces in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const unexpectedError = new TypeError('Cannot read properties of undefined (reading save)');
      const req = { headers: { 'x-request-id': 'req-prod-789' }, url: '/api/v1/orders/1/cancel', method: 'POST' };
      const res = mockResponse();
      const next = jest.fn();

      errorHandler(unexpectedError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An internal server error occurred',
        },
        requestId: 'req-prod-789',
      });

      // Console error must log requestId and root cause for Render debugging
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SERVER_ERROR] [requestId=req-prod-789]'),
        expect.stringContaining('TypeError: Cannot read properties of undefined')
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      consoleErrorSpy.mockRestore();
    }
  });
});
