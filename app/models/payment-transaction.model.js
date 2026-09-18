import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const paymentTransactionSchema = new Schema(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    provider: { type: String, required: true, index: true },
    providerEventId: { type: String, default: null, index: true },
    type: { type: String, enum: ['CREATE', 'CAPTURE', 'VERIFY', 'REFUND', 'WEBHOOK'], required: true },
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING', index: true },
    requestPayload: { type: Object, default: {} },
    responsePayload: { type: Object, default: {} },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true },
);

paymentTransactionSchema.index({ paymentId: 1, providerEventId: 1 }, { unique: false });

export const PaymentTransaction = model('PaymentTransaction', paymentTransactionSchema);
