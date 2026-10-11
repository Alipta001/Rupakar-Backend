import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const returnNotificationEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', required: true, index: true },
    eventType: { type: String, required: true, index: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipientRole: { type: String, enum: ['customer', 'vendor', 'admin'], required: true, index: true },
    channels: [{ type: String, enum: ['IN_APP', 'EMAIL', 'SMS'] }],
    status: { type: String, enum: ['RECORDED', 'ENQUEUED', 'PROCESSED', 'FAILED'], default: 'RECORDED', index: true },
    title: { type: String, default: null },
    message: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    processedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

returnNotificationEventSchema.index({ returnId: 1, eventType: 1, recipientRole: 1 });
returnNotificationEventSchema.index({ createdAt: -1 });

export const ReturnNotificationEvent = model('ReturnNotificationEvent', returnNotificationEventSchema);
