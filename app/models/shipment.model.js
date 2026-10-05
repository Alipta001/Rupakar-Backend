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
      enum: [
        'PENDING',
        'CREATED',
        'LABEL_GENERATED',
        'READY_TO_SHIP',
        'PACKED',
        'PICKUP_REQUESTED',
        'PICKED_UP',
        'SHIPPED',
        'IN_TRANSIT',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'DELIVERY_FAILED',
        'RTO_INITIATED',
        'RTO_IN_TRANSIT',
        'RTO_DELIVERED',
        'CANCELLED',
        'RETURN_REQUESTED',
        'RETURN_IN_TRANSIT',
        'RETURNED',
      ],
      default: 'PENDING',
      index: true,
    },
    pickupAddress: { type: Object, default: {} },
    deliveryAddress: { type: Object, default: {} },
    packageInfo: { type: Object, default: {} },
    providerShipmentId: { type: String, default: null },
    labelUrl: { type: String, default: null },
    pickupStatus: {
      type: String,
      enum: ['PENDING', 'REQUESTED', 'SCHEDULED', 'PICKED_UP', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    pickupToken: { type: String, default: null },
    pickupScheduledAt: { type: Date, default: null },
    shippingCost: { type: Number, default: 0 },
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
