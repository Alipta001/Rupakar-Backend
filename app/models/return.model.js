import mongoose from 'mongoose';
import { ReturnItem } from './return-item.model.js';

const { Schema, model } = mongoose;

const returnSchema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    reason: { type: String, default: 'DAMAGED_OR_DEFECTIVE' },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTING', 'APPROVED_FOR_REFUND', 'REJECTED_AFTER_INSPECTION', 'COMPLETED', 'CANCELLED'],
      default: 'REQUESTED',
      index: true,
    },
    items: [{ type: Schema.Types.ObjectId, ref: 'ReturnItem', default: [] }],
    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

returnSchema.index({ orderId: 1, vendorOrderId: 1 });
returnSchema.index({ customerId: 1, createdAt: -1 });
returnSchema.index({ status: 1, createdAt: -1 });

export const Return = model('Return', returnSchema);
export { ReturnItem };
