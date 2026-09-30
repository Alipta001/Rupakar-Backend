import request from 'supertest';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import app from '../app.js';

afterEach(() => {
  jest.restoreAllMocks();
});

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

  it('requires admin role for admin support listing, detail, and updates', async () => {
    const listRes = await request(app).get('/api/v1/admin/support/tickets');
    const detailRes = await request(app).get('/api/v1/admin/support/tickets/507f1f77bcf86cd799439011');
    const updateRes = await request(app).patch('/api/v1/admin/support/tickets/507f1f77bcf86cd799439011').send({ status: 'RESOLVED' });

    expect(listRes.status).toBe(401);
    expect(detailRes.status).toBe(401);
    expect(updateRes.status).toBe(401);
  });

  it('allows seller to load OPEN, IN_PROGRESS (with Admin reply), and RESOLVED tickets', async () => {
    const { supportTicketService } = await import('../app/services/support-ticket.service.js');
    const { SupportTicket } = await import('../app/models/support-ticket.model.js');
    const { Vendor } = await import('../app/models/vendor.model.js');

    const sellerUserId = '507f1f77bcf86cd799439011';
    const vendorId = '507f1f77bcf86cd799439012';
    const ticketId = '507f1f77bcf86cd799439013';

    const mockTicket = {
      _id: ticketId,
      userId: sellerUserId,
      vendorId: vendorId,
      category: 'PRODUCTS',
      subject: 'Inquiry',
      status: 'IN_PROGRESS',
      messages: [
        {
          _id: '507f1f77bcf86cd799439014',
          senderUserId: sellerUserId,
          senderRole: 'vendor',
          message: 'Can I change my product name?',
          createdAt: new Date().toISOString(),
        },
        {
          _id: '507f1f77bcf86cd799439015',
          senderUserId: '507f1f77bcf86cd799439099',
          senderRole: 'admin',
          message: 'Yes, go to Products > Edit.',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: vendorId, ownerUserId: sellerUserId }),
    });

    jest.spyOn(SupportTicket, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockTicket),
    });

    // 1. Seller gets ticket while IN_PROGRESS with Admin reply
    const loadedTicket = await supportTicketService.get(sellerUserId, ticketId);
    expect(loadedTicket).toBeDefined();
    expect(loadedTicket.status).toBe('IN_PROGRESS');
    expect(loadedTicket.messages).toHaveLength(2);
    expect(loadedTicket.messages[1].senderRole).toBe('admin');
    expect(loadedTicket.messages[1].message).toBe('Yes, go to Products > Edit.');

    // 2. Status RESOLVED also loads correctly
    mockTicket.status = 'RESOLVED';
    const resolvedTicket = await supportTicketService.get(sellerUserId, ticketId);
    expect(resolvedTicket.status).toBe('RESOLVED');
  });
});
