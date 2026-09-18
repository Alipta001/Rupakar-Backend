import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const movementTypeValues = ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'SALE', 'RETURN'];
const referenceTypeValues = ['INITIALIZATION', 'RESTOCK', 'SALE', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'RETURN', 'MANUAL'];

const inventoryMovementSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true, index: true },
    type: { type: String, enum: movementTypeValues, required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    previousAvailableQuantity: { type: Number, required: true, min: 0 },
    newAvailableQuantity: { type: Number, required: true, min: 0 },
    referenceType: { type: String, enum: referenceTypeValues, default: 'MANUAL', index: true },
    referenceId: { type: String, trim: true, default: null },
    reason: { type: String, trim: true, default: 'MANUAL' },
    actorId: { type: String, trim: true, default: 'system' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

inventoryMovementSchema.index({ variantId: 1, createdAt: -1 });
inventoryMovementSchema.index({ productId: 1, createdAt: -1 });
inventoryMovementSchema.index({ referenceType: 1, referenceId: 1 });

export const InventoryMovement = model('InventoryMovement', inventoryMovementSchema);
