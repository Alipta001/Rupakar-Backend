import mongoose from 'mongoose';
import { ProductVariant } from './product-variant.model.js';

const { Schema, model } = mongoose;

const productStatus = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'];

const productImageSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', default: null },
    storageKey: { type: String, trim: true, required: true },
    url: { type: String, trim: true, required: true },
    altText: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
    width: { type: Number, min: 1, default: null },
    height: { type: Number, min: 1, default: null },
    fileSize: { type: Number, min: 0, default: null },
    mimeType: { type: String, trim: true, default: null },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

const productSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 220 },
    slug: { type: String, required: true, trim: true, lowercase: true, index: true },
    shortDescription: { type: String, trim: true, maxlength: 500 },
    description: { type: String, trim: true, maxlength: 5000 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', index: true },
    tags: [{ type: String, trim: true, lowercase: true }],
    attributes: { type: Map, of: [String], default: {} },
    variants: [{ type: Schema.Types.ObjectId, ref: 'ProductVariant' }],
    images: [{ type: Schema.Types.ObjectId, ref: 'ProductImage' }],
    status: { type: String, enum: productStatus, default: 'DRAFT', index: true },
    featured: { type: Boolean, default: false },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 220 },
      keywords: [{ type: String, trim: true }],
    },
    authenticity: {
      reference: { type: String, trim: true },
      status: { type: String, enum: ['VERIFIED', 'UNVERIFIED', 'PENDING'], default: 'UNVERIFIED' },
    },
    shipping: {
      originState: { type: String, trim: true },
      originDistrict: { type: String, trim: true },
      deliveryDays: { type: Number, min: 1 },
      freeShipping: { type: Boolean, default: false },
    },
    tax: {
      taxable: { type: Boolean, default: true },
      taxCode: { type: String, trim: true },
      gstIncluded: { type: Boolean, default: false },
    },
    publishedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
productSchema.index({ categoryId: 1, status: 1, createdAt: -1 });
productSchema.index({ brandId: 1, status: 1, createdAt: -1 });
productSchema.index({ slug: 1, deletedAt: 1 }, { unique: true });
productSchema.index({ name: 'text', shortDescription: 'text', description: 'text', tags: 'text' });

export const Product = model('Product', productSchema);
export const ProductImage = model('ProductImage', productImageSchema);
export { ProductVariant };
