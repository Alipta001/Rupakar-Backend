import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const shipmentTrackingEventSchema = new Schema(
  {
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true, index: true },
    status: { type: String, required: true },
    location: { type: String, default: null },
    description: { type: String, default: null },
    provider: { type: String, default: 'mock-provider' },
    providerEventId: { type: String, default: null },
    timestamp: { type: Date, default: Date.now, index: true },
    rawMetadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

shipmentTrackingEventSchema.index({ shipmentId: 1, timestamp: -1 });
shipmentTrackingEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true, sparse: true });

export const ShipmentTrackingEvent = model('ShipmentTrackingEvent', shipmentTrackingEventSchema);
