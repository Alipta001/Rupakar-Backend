import request from 'supertest';
import app from '../app.js';

describe('Seller support endpoints', () => {
  it('requires authentication for ticket listing and creation', async () => {
    const listResponse = await request(app).get('/api/v1/support/tickets');
    const createResponse = await request(app).post('/api/v1/support/tickets').send({
      category: 'PRODUCTS',
      subject: 'Catalog help',
      message: 'I need help updating a product description.',
    });

    expect(listResponse.status).toBe(401);
    expect(createResponse.status).toBe(401);
    expect(listResponse.body.error.code).toBe('UNAUTHORIZED');
    expect(createResponse.body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires authentication for ticket detail and replies', async () => {
    const detailResponse = await request(app).get('/api/v1/support/tickets/507f1f77bcf86cd799439011');
    const messageResponse = await request(app).post('/api/v1/support/tickets/507f1f77bcf86cd799439011/messages').send({ message: 'Following up.' });

    expect(detailResponse.status).toBe(401);
    expect(messageResponse.status).toBe(401);
  });
});
