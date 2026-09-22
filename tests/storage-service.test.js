import { describe, expect, it, jest } from '@jest/globals';
import { StorageService } from '../app/services/storage.service.js';

describe('private S3-compatible document storage', () => {
  const service = () => {
    const instance = new StorageService();
    instance.s3Configured = true;
    instance.s3 = { send: jest.fn().mockResolvedValue({ Body: 'document' }) };
    return instance;
  };

  it('uploads an in-memory invoice PDF using its private key', async () => {
    const storage = service();
    const result = await storage.upload({ key: 'invoices/order-1/INV-1.pdf', body: Buffer.from('%PDF'), contentType: 'application/pdf' });
    expect(result).toEqual({ storageKey: 'invoices/order-1/INV-1.pdf', storageProvider: 's3' });
    expect(storage.s3.send).toHaveBeenCalledTimes(1);
  });

  it('supports private existence, retrieval, and deletion operations', async () => {
    const storage = service();
    await expect(storage.exists('invoices/order-1/INV-1.pdf')).resolves.toBe(true);
    await expect(storage.get('invoices/order-1/INV-1.pdf')).resolves.toEqual({ Body: 'document' });
    await expect(storage.delete('invoices/order-1/INV-1.pdf')).resolves.toBe(true);
    expect(storage.s3.send).toHaveBeenCalledTimes(3);
  });
});
