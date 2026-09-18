import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const orderStatusHistorySchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', default: null, index: true },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, required: true },
    reason: { type: String, default: null },
    actorType: { type: String, enum: ['CUSTOMER', 'SYSTEM', 'ADMIN', 'VENDOR'], default: 'SYSTEM' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const OrderStatusHistory = model('OrderStatusHistory', orderStatusHistorySchema);
