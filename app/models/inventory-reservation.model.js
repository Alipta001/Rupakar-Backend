import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const inventoryReservationSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED'], default: 'ACTIVE', index: true },
    expiresAt: { type: Date, default: null, index: true },
    releasedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

inventoryReservationSchema.index({ orderId: 1, variantId: 1, status: 1 });
inventoryReservationSchema.index({ expiresAt: 1, status: 1 });

export const InventoryReservation = model('InventoryReservation', inventoryReservationSchema);
