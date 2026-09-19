import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { getPaymentConfig } from '../app/controllers/payment.controller.js';
import { paymentService } from '../app/services/payment.service.js';

afterEach(() => jest.restoreAllMocks());

describe('payment configuration endpoint', () => {
  it('returns only frontend-safe payment configuration', async () => {
    jest.spyOn(paymentService, 'isRazorpayEnabled').mockReturnValue(true);
    const json = jest.fn();

    await getPaymentConfig({}, { status: () => ({ json }) }, jest.fn());

    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        razorpayEnabled: true,
        publicKey: expect.any(String),
      }),
    }));
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('RAZORPAY_KEY_SECRET');
  });

  it('returns a controlled 503 when payment configuration cannot be read', async () => {
    jest.spyOn(paymentService, 'isRazorpayEnabled').mockImplementation(() => {
      throw new Error('provider configuration failure');
    });
    const next = jest.fn();

    await getPaymentConfig({}, { status: () => ({ json: jest.fn() }) }, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PAYMENT_CONFIGURATION_UNAVAILABLE',
      statusCode: 503,
    }));
  });
});