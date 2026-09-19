import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { CartService } from '../app/services/cart.service.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Cart } from '../app/models/cart.model.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { OrderService } from '../app/services/order.service.js';

describe('cart and checkout request contracts', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects malformed product and variant ids as controlled 4xx errors', async () => {
    const service = new CartService();

    await expect(service.addItem({ userId: '507f1f77bcf86cd799439010', productId: 'bad-product', variantId: 'bad-variant', quantity: 1 }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PRODUCT_ID' });
  });

  it('rejects invalid quantities before database access', async () => {
    const service = new CartService();

    await expect(service.addItem({ userId: '507f1f77bcf86cd799439010', productId: '507f1f77bcf86cd799439011', variantId: '507f1f77bcf86cd799439012', quantity: 0 }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_QUANTITY' });
  });

  it('adds a valid in-stock item with the authoritative variant price', async () => {
    const service = new CartService();
    const productId = '507f1f77bcf86cd799439011';
    const variantId = '507f1f77bcf86cd799439012';
    jest.spyOn(Cart, 'findOne').mockResolvedValue(null);
    jest.spyOn(Product, 'findOne')
      .mockResolvedValueOnce({ _id: productId, name: 'Vase', status: 'PUBLISHED', deletedAt: null })
      .mockResolvedValueOnce({ name: 'Vase', images: [] });
    jest.spyOn(ProductVariant, 'findOne')
      .mockResolvedValueOnce({ _id: variantId, productId, sku: 'VASE-1', price: 500, status: 'ACTIVE' })
      .mockResolvedValueOnce({ _id: variantId, sku: 'VASE-1', price: 500 });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(4);
    jest.spyOn(Cart, 'create').mockResolvedValue({ userId: 'user-1', items: [{ productId, variantId, quantity: 1 }] });

    const result = await service.addItem({ userId: '507f1f77bcf86cd799439010', productId, variantId, quantity: 1 });

    expect(result.items[0]).toMatchObject({ productId, variantId, quantity: 1, price: 500 });
  });

  it('rejects checkout when the authenticated cart is empty', async () => {
    jest.spyOn(Cart, 'findOne').mockResolvedValue({ userId: '507f1f77bcf86cd799439010', items: [] });

    await expect(new OrderService().createOrder({
      customerId: '507f1f77bcf86cd799439010',
      paymentMethod: 'cod',
    })).rejects.toMatchObject({ statusCode: 400, code: 'EMPTY_CART' });
  });
});