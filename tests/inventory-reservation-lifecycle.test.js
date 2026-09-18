import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Inventory } from '../app/models/inventory.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';

describe('inventory reservation lifecycle', () => {
  afterEach(() => jest.restoreAllMocks());

  it('consumes an active reservation exactly once', async () => {
    const save = jest.fn().mockResolvedValue(true);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({
      status: 'ACTIVE',
      consumedAt: null,
      releasedAt: null,
      save,
      toObject: () => ({ status: 'CONSUMED', consumedAt: true, releasedAt: null }),
    });

    const result = await inventoryReservationService.consumeReservation({ orderId: 'order-1', variantId: 'variant-1' });

    expect(result).toMatchObject({ status: 'CONSUMED', releasedAt: null });
    expect(save).toHaveBeenCalled();
  });

  it('does not consume released or already consumed reservations', async () => {
    const findSpy = jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);

    await expect(inventoryReservationService.consumeReservation({ orderId: 'order-1', variantId: 'variant-1' })).resolves.toBeNull();
    expect(findSpy).toHaveBeenCalledWith({ orderId: 'order-1', variantId: 'variant-1', status: 'ACTIVE' });
  });

  it('releases active inventory once and never restores twice', async () => {
    const save = jest.fn().mockResolvedValue(true);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({
      quantity: 2,
      status: 'ACTIVE',
      save,
      toObject: () => ({ status: 'RELEASED', releasedAt: true, consumedAt: null }),
    });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ reservedQuantity: 2 });
    const inventoryUpdate = jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue({});

    const result = await inventoryReservationService.releaseReservation({ orderId: 'order-1', variantId: 'variant-1' });

    expect(result).toMatchObject({ status: 'RELEASED', consumedAt: null });
    expect(inventoryUpdate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
