import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const refundSchema = new Schema(
  {
    refundNumber: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', default: null, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', default: null, index: true },
    cancellationRequestId: { type: Schema.Types.ObjectId, ref: 'CancellationRequest', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    reason: { type: String, default: null },
    status: {
      type: String,
      enum: ['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'],
      default: 'REQUESTED',
      index: true,
    },
    providerRefundId: { type: String, default: null },
  },
  { timestamps: true },
);

refundSchema.index({ orderId: 1, paymentId: 1 });
refundSchema.index({ providerRefundId: 1 }, { unique: true, sparse: true });

export const Refund = model('Refund', refundSchema);
