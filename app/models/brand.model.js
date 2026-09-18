import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    logo: { type: String, trim: true },
    website: { type: String, trim: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 220 },
      keywords: [{ type: String, trim: true }],
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

brandSchema.index({ status: 1, createdAt: -1 });

export const Brand = model('Brand', brandSchema);
