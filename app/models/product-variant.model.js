import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const productVariantSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    sku: { type: String, required: true, trim: true, unique: true, index: true },
    barcode: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0, default: null },
    costPrice: { type: Number, min: 0, default: null },
    weight: { type: Number, min: 0, default: null },
    dimensions: {
      length: { type: Number, min: 0 },
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 },
    },
    attributes: { type: Map, of: String, default: {} },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

productVariantSchema.index({ productId: 1, sku: 1 }, { unique: true });

export const ProductVariant = model('ProductVariant', productVariantSchema);
