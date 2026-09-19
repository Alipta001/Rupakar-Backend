import { afterEach, describe, expect, it, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { CartService } from '../app/services/cart.service.js';
import { Cart } from '../app/models/cart.model.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { inventoryService } from '../app/services/inventory.service.js';

afterEach(() => jest.restoreAllMocks());

describe('cart auth lifecycle', () => {
  it('persists removal across logout and login cart hydration', async () => {
    const service = new CartService();
    const productId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();
    const userCart = {
      _id: 'user-cart',
      userId: 'user-1',
      items: [{ productId, variantId, quantity: 1 }],
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Cart, 'findOne').mockResolvedValue(userCart);
    jest.spyOn(service, 'formatCart').mockImplementation(async (cart) => ({
      items: cart.items.map((item) => ({ variantId: String(item.variantId), quantity: item.quantity })),
    }));

    await service.removeItem({ userId: 'user-1', variantId: variantId.toHexString() });
    const hydratedCart = await service.getCartForUser('user-1');

    expect(userCart.items).toEqual([]);
    expect(userCart.save).toHaveBeenCalledTimes(1);
    expect(hydratedCart.items).toEqual([]);
  });

  it('does not resurrect an explicitly emptied guest cart during merge', async () => {
    const service = new CartService();
    const userId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const guestCart = { _id: 'guest-cart', items: [], deleteMarker: true };
    const userCart = { _id: 'user-cart', items: [], save: jest.fn(), toObject: () => ({ items: [] }) };

    jest.spyOn(Cart, 'findOne')
      .mockResolvedValueOnce(guestCart)
      .mockResolvedValueOnce(userCart);
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({ _id: variantId, productId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({ status: 'PUBLISHED', deletedAt: null });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    const deleteSpy = jest.spyOn(Cart, 'deleteOne').mockResolvedValue({ acknowledged: true });

    const result = await service.mergeGuestCart({ userId, guestSessionId: 'guest-1' });

    expect(result.cart.items).toEqual([]);
    expect(userCart.save).toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith({ _id: 'guest-cart' });
  });
});