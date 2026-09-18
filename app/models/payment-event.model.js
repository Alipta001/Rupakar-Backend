import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const paymentEventSchema = new Schema(
  {
    provider: { type: String, required: true, index: true },
    providerEventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    payload: { type: Object, required: true },
    processedAt: { type: Date, default: null },
    status: { type: String, enum: ['PROCESSED', 'REJECTED', 'DUPLICATE'], default: 'PROCESSED', index: true },
  },
  { timestamps: true },
);

paymentEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });

export const PaymentEvent = model('PaymentEvent', paymentEventSchema);
