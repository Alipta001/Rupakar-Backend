import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    image: { type: String, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    level: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
    sortOrder: { type: Number, default: 0 },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 220 },
      keywords: [{ type: String, trim: true }],
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

categorySchema.index({ slug: 1, deletedAt: 1 }, { unique: true });
categorySchema.index({ parentId: 1, status: 1 });

export const Category = model('Category', categorySchema);
