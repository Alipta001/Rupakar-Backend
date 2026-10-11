import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const returnShipmentStatus = [
  'PENDING',
  'READY_FOR_PICKUP',
  'AWB_ASSIGNED',
  'LABEL_GENERATED',
  'PICKUP_REQUESTED',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PICKUP_FAILED',
  'DELIVERY_FAILED',
  'CANCELLED',
];

const pickupStatusValues = [
  'PENDING',
  'REQUESTED',
  'SCHEDULED',
  'PICKED_UP',
  'FAILED',
  'CANCELLED',
];

const returnShipmentItemSchema = new Schema(
  {
    returnItemId: { type: Schema.Types.ObjectId, ref: 'ReturnItem', default: null },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const returnShipmentSchema = new Schema(
  {
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    shipmentNumber: { type: String, required: true, unique: true, index: true },
    channelOrderId: { type: String, default: null, index: true },
    direction: { type: String, enum: ['RETURN'], default: 'RETURN', required: true },
    provider: { type: String, default: null },
    providerShipmentId: { type: String, default: null },
    providerOrderId: { type: Schema.Types.Mixed, default: null },
    providerAwb: { type: String, default: null, index: true },
    carrier: { type: String, default: null },
    trackingNumber: { type: String, default: null },
    trackingUrl: { type: String, default: null },
    labelUrl: { type: String, default: null },
    pickupStatus: {
      type: String,
      enum: pickupStatusValues,
      default: 'PENDING',
      index: true,
    },
    awbAssignedAt: { type: Date, default: null },
    labelGeneratedAt: { type: Date, default: null },
    pickupRequestedAt: { type: Date, default: null },
    pickupScheduledAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },
    inTransitAt: { type: Date, default: null },
    outForDeliveryAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    awbError: { type: Object, default: null },
    labelError: { type: Object, default: null },
    pickupError: { type: Object, default: null },
    trackingError: { type: Object, default: null },
    trackingEvents: { type: Array, default: [] },
    packageInfo: {
      weight: { type: Number, required: true, min: 0.0001 },
      length: { type: Number, required: true, min: 0.0001 },
      width: { type: Number, required: true, min: 0.0001 },
      height: { type: Number, required: true, min: 0.0001 },
      unit: { type: String, default: 'kg' },
      dimensionUnit: { type: String, default: 'cm' },
    },
    pickupAddressSnapshot: { type: Object, required: true },
    returnAddressSnapshot: { type: Object, required: true },
    items: [returnShipmentItemSchema],
    metadata: { type: Object, default: {} },
    idempotencyKey: { type: String, default: null, index: true },
    status: {
      type: String,
      enum: returnShipmentStatus,
      default: 'PENDING',
      index: true,
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        previousStatus: { type: String, default: null },
        changedAt: { type: Date, default: Date.now },
        timestamp: { type: Date, default: Date.now },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        actorType: { type: String, enum: ['CUSTOMER', 'VENDOR', 'ADMIN', 'SYSTEM'], default: 'SYSTEM' },
        actorRole: { type: String, default: 'SYSTEM' },
        reason: { type: String, default: null },
        notes: { type: String, default: null },
      },
    ],
  },
  { timestamps: true },
);

returnShipmentSchema.index(
  { returnId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: 'CANCELLED' } },
  },
);
returnShipmentSchema.index({ customerId: 1, createdAt: -1 });
returnShipmentSchema.index({ vendorId: 1, createdAt: -1 });
returnShipmentSchema.index({ orderId: 1, createdAt: -1 });

export const ReturnShipment = model('ReturnShipment', returnShipmentSchema);
