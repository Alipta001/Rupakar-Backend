import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { swaggerSpec } from '../app/docs/swagger.js';

describe('Swagger / OpenAPI Documentation', () => {
  it('serves OpenAPI JSON specification at /api/docs.json', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Rupakar Marketplace API');
    expect(res.body.components.securitySchemes.BearerAuth).toBeDefined();
    expect(res.body.components.securitySchemes.BearerAuth.scheme).toBe('bearer');
  });

  it('serves OpenAPI JSON specification at /api-docs.json for backward compatibility', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
  });

  it('serves Swagger UI HTML documentation at /api/docs/', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('serves Swagger UI HTML documentation at /api-docs/', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('contains comprehensive documentation for core marketplace domains', () => {
    const paths = Object.keys(swaggerSpec.paths);

    // Verify key modules are present
    expect(paths).toContain('/auth/login');
    expect(paths).toContain('/auth/register');
    expect(paths).toContain('/users/me');
    expect(paths).toContain('/products');
    expect(paths).toContain('/products/{slug}');
    expect(paths).toContain('/categories');
    expect(paths).toContain('/vendors/apply');
    expect(paths).toContain('/cart');
    expect(paths).toContain('/cart/items');
    expect(paths).toContain('/wishlist');
    expect(paths).toContain('/checkout/preview');
    expect(paths).toContain('/orders');
    expect(paths).toContain('/payments/config');
    expect(paths).toContain('/shipments/{id}/tracking');
    expect(paths).toContain('/reviews');
    expect(paths).toContain('/invoices');
    expect(paths).toContain('/notifications');
    expect(paths).toContain('/vendor/inventory');
    expect(paths).toContain('/vendor/finance/ledger');
    expect(paths).toContain('/support/tickets');
    expect(paths).toContain('/health');
  });

  it('does not expose internal secrets or credentials in the Swagger specification', () => {
    const specString = JSON.stringify(swaggerSpec);

    expect(specString).not.toContain('mongodb+srv://');
    expect(specString).not.toContain('REDIS_URL');
    expect(specString).not.toContain('JWT_SECRET');
    expect(specString).not.toContain('JWT_ACCESS_SECRET');
    expect(specString).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(specString).not.toContain('RESEND_API_KEY');
  });
});
