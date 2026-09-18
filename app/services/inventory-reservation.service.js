import { Inventory } from '../models/inventory.model.js';
import { InventoryReservation } from '../models/inventory-reservation.model.js';
import { AppError } from '../utils/app-error.js';
import { scheduleReservationExpiry } from '../jobs/reservation-expiry.js';

export class InventoryReservationService {
  async validateReservationQuantity(availableQuantity, requestedQuantity) {
    const safeAvailable = Number(availableQuantity) || 0;
    const safeRequested = Number(requestedQuantity) || 0;

    if (!Number.isInteger(safeRequested) || safeRequested <= 0) {
      throw new AppError(400, 'INVALID_QUANTITY', 'Reservation quantity must be a positive integer');
    }
    if (safeRequested > safeAvailable) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock available to reserve');
    }
    return safeRequested;
  }

  async createReservation({ orderId, variantId, productId, quantity, expiresAt, createdBy = null }) {
    const inventory = await Inventory.findOne({ variantId, deletedAt: null });
    if (!inventory) {
      throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found for reservation');
    }

    await this.validateReservationQuantity(inventory.availableQuantity, quantity);

    const existingActive = await InventoryReservation.findOne({
      orderId,
      variantId,
      status: 'ACTIVE',
    });
    if (existingActive) {
      return existingActive.toObject ? existingActive.toObject() : existingActive;
    }

    const updated = await Inventory.findOneAndUpdate(
      { _id: inventory._id, availableQuantity: { $gte: quantity } },
      { $inc: { availableQuantity: -quantity, reservedQuantity: quantity } },
      { new: true, runValidators: true },
    );

    if (!updated) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Inventory changed while reserving stock');
    }

    const reservation = await InventoryReservation.create({
      orderId,
      variantId,
      productId,
      quantity,
      status: 'ACTIVE',
      expiresAt: expiresAt || new Date(Date.now() + 15 * 60 * 1000),
      createdBy,
    });

    await scheduleReservationExpiry({ reservationId: reservation._id, expiresAt: reservation.expiresAt });

    return reservation.toObject ? reservation.toObject() : reservation;
  }

  async releaseReservation({ orderId, variantId, reason = 'RELEASE', actorId = null }) {
    const reservation = await InventoryReservation.findOne({ orderId, variantId, status: 'ACTIVE' });
    if (!reservation) return null;

    const inventory = await Inventory.findOne({ variantId, deletedAt: null });
    if (!inventory) {
      throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found while releasing reservation');
    }

    if (inventory.reservedQuantity < reservation.quantity) {
      throw new AppError(409, 'INVENTORY_UPDATE_FAILED', 'Cannot release more stock than reserved');
    }

    await Inventory.findOneAndUpdate(
      { _id: inventory._id },
      { $inc: { availableQuantity: reservation.quantity, reservedQuantity: -reservation.quantity } },
      { new: true },
    );

    reservation.status = 'RELEASED';
    reservation.releasedAt = new Date();
    await reservation.save();

    return reservation.toObject ? reservation.toObject() : reservation;
  }

  async consumeReservation({ orderId, variantId }) {
    const reservation = await InventoryReservation.findOne({ orderId, variantId, status: 'ACTIVE' });
    if (!reservation) return null;

    reservation.status = 'CONSUMED';
    reservation.consumedAt = new Date();
    await reservation.save();
    return reservation.toObject ? reservation.toObject() : reservation;
  }

  async consumeOrderReservations({ orderId, items = [] }) {
    return Promise.all((items || []).map((item) => this.consumeReservation({
      orderId,
      variantId: item.variantId,
    })));
  }

  async releaseOrderReservations({ orderId, items = [], reason = 'RELEASE', actorId = null }) {
    return Promise.all((items || []).map((item) => this.releaseReservation({
      orderId,
      variantId: item.variantId,
      reason,
      actorId,
    })));
  }
}

export const inventoryReservationService = new InventoryReservationService();
