import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    channel: { type: String, enum: ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'], default: 'IN_APP', index: true },
    status: { type: String, enum: ['PENDING', 'SENT', 'FAILED', 'BOUNCED'], default: 'PENDING', index: true },
    recipient: { type: String, default: null },
    metadata: { type: Object, default: {} },
    readAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1, _id: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });

export const Notification = model('Notification', notificationSchema);
