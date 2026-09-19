import request from 'supertest';
import app from '../app.js';

describe('Health endpoints', () => {
  it('should return health status', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.api).toBe('ok');
  });

  it('should return live status', async () => {
    const response = await request(app).get('/api/v1/health/live');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('live');
  });

  it('should return not found for unknown route', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it('should protect the user and vendor routes behind authentication', async () => {
    const userResponse = await request(app).get('/api/v1/users/me');
    const vendorResponse = await request(app).get('/api/v1/vendors/me');

    expect(userResponse.status).toBe(401);
    expect(vendorResponse.status).toBe(401);
  });

  it('should protect checkout behind authentication', async () => {
    const response = await request(app).post('/api/v1/checkout').send({ paymentMethod: 'cod' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});
