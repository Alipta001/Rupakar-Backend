import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
    replacedByHash: { type: String, default: null },
    revokeReason: { type: String, default: null },
  },
  { timestamps: true },
);

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

export const RefreshSession = model('RefreshSession', refreshSessionSchema);
