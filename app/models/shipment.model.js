import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const shipmentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shipmentNumber: { type: String, required: true, unique: true },
    carrier: { type: String, default: 'mock-carrier' },
    provider: { type: String, default: 'mock-provider' },
    trackingNumber: { type: String, default: null },
    trackingUrl: { type: String, default: null },
    shippingMethod: { type: String, default: 'standard' },
    status: {
      type: String,
      enum: ['PENDING', 'READY_TO_SHIP', 'PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED'],
      default: 'PENDING',
      index: true,
    },
    packageInfo: { type: Object, default: {} },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    estimatedDeliveryAt: { type: Date, default: null },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

shipmentSchema.index({ vendorOrderId: 1, createdAt: -1 });
shipmentSchema.index({ vendorId: 1, createdAt: -1 });
shipmentSchema.index({ trackingNumber: 1 }, { unique: true, sparse: true });

export const Shipment = model('Shipment', shipmentSchema);
