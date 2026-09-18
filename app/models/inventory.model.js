import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const inventorySchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, unique: true, index: true },
    availableQuantity: { type: Number, required: true, min: 0, default: 0 },
    reservedQuantity: { type: Number, required: true, min: 0, default: 0 },
    soldQuantity: { type: Number, required: true, min: 0, default: 0 },
    lowStockThreshold: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'LOW_STOCK'], default: 'ACTIVE', index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

inventorySchema.index({ productId: 1, variantId: 1 }, { unique: true });
inventorySchema.index({ productId: 1, status: 1 });

export const Inventory = model('Inventory', inventorySchema);
