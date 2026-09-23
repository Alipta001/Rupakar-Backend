import { AppError } from '../utils/app-error.js';
import { Brand } from '../models/brand.model.js';
import { Category } from '../models/category.model.js';
import { Product, ProductImage } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { Inventory } from '../models/inventory.model.js';
import { Vendor } from '../models/vendor.model.js';
import { auditService } from './audit.service.js';
import { inventoryService } from './inventory.service.js';
import { storageService } from './storage.service.js';
import crypto from 'node:crypto';

const normalizeSlug = (value) => {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return slug || 'product';
};

const normalizeSku = (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '-');

const skuAbbreviation = (value, fallback = 'PRD') => {
  const words = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  const abbreviation = words.length > 1 ? words.map((word) => word[0]).join('') : words[0].slice(0, 3);
  return (abbreviation || fallback).slice(0, 6);
};

const generatedSkuBase = (productName, categoryName, variant, index) => {
  const category = skuAbbreviation(categoryName, 'GEN');
  const product = skuAbbreviation(productName, 'PRD');
  const variantValue = variant?.attributes && Object.values(variant.attributes).find(Boolean);
  const variantPart = variantValue ? `${skuAbbreviation(variantValue, `V${index + 1}`)}-` : '';
  return `RPK-${category}-${product}-${variantPart}`;
};

const generatedSku = (base) => `${base}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const buildUniqueProductSlug = async (base, excludeId = null) => {
  const root = normalizeSlug(base);
  let slug = root;
  let suffix = 1;
  while (suffix <= 100) {
    const existing = await Product.findOne({ slug, deletedAt: null, _id: { $ne: excludeId } });
    if (!existing) return slug;
    slug = `${root}-${suffix}`;
    suffix += 1;
  }
  throw new AppError(409, 'PRODUCT_SLUG_EXISTS', 'Product slug already exists');
};

const buildUniqueSku = async (sku, excludeId = null) => {
  const normalized = normalizeSku(sku);
  if (!normalized) throw new AppError(400, 'INVALID_SKU', 'Variant SKU is required');

  let candidate = normalized;
  let count = 1;
  while (count <= 100) {
    const existing = await ProductVariant.findOne({ sku: candidate, _id: { $ne: excludeId } });
    if (!existing) return candidate;
    candidate = `${normalized}-${count}`;
    count += 1;
  }

  throw new AppError(409, 'SKU_ALREADY_EXISTS', 'Variant SKU already exists');
};

const buildGeneratedSku = async (base) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generatedSku(base);
    const existing = await ProductVariant.findOne({ sku: candidate });
    if (!existing) return candidate;
  }
  throw new AppError(409, 'SKU_GENERATION_FAILED', 'Unable to generate a unique variant SKU');
};

const parsePrice = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new AppError(400, 'INVALID_PRICE', 'Product price must be greater than zero');
  }
  return number;
};

const MAX_PRODUCT_IMAGES = 20;

const findProductWithVariants = (productId) => {
  let query = Product.findById(productId);
  if (typeof query.populate === 'function') {
    query = query
      .populate('variants')
      .populate('images')
      .populate('categoryId', 'name slug')
      .populate('brandId', 'name slug');
  }
  return query.lean();
};

export class ProductService {
  async resolveVendorIdForUser(userId) {
    const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_NOT_ALLOWED', 'Only approved vendors can manage products');
    return vendor._id;
  }

  async ensureVendor(vendorId) {
    const vendor = await Vendor.findOne({ _id: vendorId, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_NOT_ALLOWED', 'Only approved vendors can manage products');
    return vendor;
  }

  async assertVendorOwnsProduct(userId, productId) {
    const vendorId = await this.resolveVendorIdForUser(userId);
    const product = await Product.findOne({ _id: productId, vendorId, deletedAt: null });

    if (!product || String(product.vendorId) !== String(vendorId)) {
      throw new AppError(403, 'VENDOR_PRODUCT_MISMATCH', 'This product does not belong to the authenticated vendor');
    }

    return { vendorId, product };
  }

  async uploadProductImage(userId, productId, file, metadata = {}) {
    const { product } = await this.assertVendorOwnsProduct(userId, productId);

    if (!file) {
      throw new AppError(400, 'IMAGE_REQUIRED', 'An image file is required');
    }

    try {
      storageService.validateImageFile(file);
    } catch (error) {
      throw new AppError(400, 'INVALID_IMAGE_FILE', error.message);
    }
    const activeImageCount = await ProductImage.countDocuments({ productId: product._id, status: 'ACTIVE' });
    if (activeImageCount >= MAX_PRODUCT_IMAGES) {
      throw new AppError(400, 'IMAGE_LIMIT_REACHED', 'A product cannot have more than 20 images');
    }

    let uploadMetadata;
    try {
      uploadMetadata = await storageService.uploadImage({
        file,
        folder: `products/${String(product._id)}`,
        altText: metadata.altText ?? '',
      });
    } catch (error) {
      throw new AppError(502, 'IMAGE_UPLOAD_FAILED', error.message || 'Cloudinary image upload failed');
    }

    if (!uploadMetadata.storageKey || !uploadMetadata.url) {
      throw new AppError(502, 'IMAGE_UPLOAD_FAILED', 'Cloudinary returned incomplete image metadata');
    }

    const existingPrimaryResult = await ProductImage.findOne({ productId: product._id, isPrimary: true, status: 'ACTIVE' });
    const existingPrimary = existingPrimaryResult && typeof existingPrimaryResult.lean === 'function'
      ? await existingPrimaryResult.lean()
      : existingPrimaryResult;
    const nextIsPrimary = existingPrimary ? Boolean(metadata.isPrimary) : true;
    let newImage;
    try {
      newImage = await ProductImage.create({
        productId: product._id,
        variantId: metadata.variantId ?? null,
        storageKey: uploadMetadata.storageKey,
        url: uploadMetadata.url,
        altText: uploadMetadata.altText || metadata.altText || '',
        sortOrder: Number(metadata.sortOrder ?? 0),
        isPrimary: nextIsPrimary,
        width: uploadMetadata.width,
        height: uploadMetadata.height,
        fileSize: uploadMetadata.fileSize,
        mimeType: uploadMetadata.mimeType,
        status: 'ACTIVE',
      });
    } catch (error) {
      await storageService.deleteImage(uploadMetadata.storageKey).catch(() => undefined);
      throw error;
    }

    try {
      if (existingPrimary && nextIsPrimary) {
        await ProductImage.updateMany(
          { productId: product._id, _id: { $ne: newImage._id }, status: 'ACTIVE' },
          { $set: { isPrimary: false } },
        );
      }

      if (!Array.isArray(product.images)) {
        product.images = [];
      }
      product.images.push(newImage._id);
      await product.save();
    } catch (error) {
      await ProductImage.deleteOne({ _id: newImage._id, productId: product._id }).catch(() => undefined);
      await storageService.deleteImage(uploadMetadata.storageKey).catch(() => undefined);
      throw error;
    }

    return newImage.toObject();
  }

  async deleteProductImage(userId, productId, imageId) {
    const { product } = await this.assertVendorOwnsProduct(userId, productId);

    const image = await ProductImage.findOne({ _id: imageId, productId: product._id });
    if (!image) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', 'Product image not found');
    }

    try {
      const deleted = await storageService.deleteImage(image.storageKey);
      if (!deleted && image.storageKey) {
        throw new AppError(502, 'IMAGE_DELETE_FAILED', 'Cloudinary image deletion failed');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'IMAGE_DELETE_FAILED', 'Cloudinary image deletion failed');
    }

    await ProductImage.deleteOne({ _id: imageId, productId: product._id });
    product.images = (product.images || []).filter((item) => String(item) !== String(imageId));
    await product.save();

    return { deleted: true, imageId: String(imageId) };
  }

  async updateProductImage(userId, productId, imageId, payload = {}) {
    const { product } = await this.assertVendorOwnsProduct(userId, productId);

    const image = await ProductImage.findOne({ _id: imageId, productId: product._id });
    if (!image) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', 'Product image not found');
    }

    if (payload.altText !== undefined) image.altText = String(payload.altText).trim().slice(0, 160);
    if (payload.sortOrder !== undefined) image.sortOrder = Number(payload.sortOrder) || 0;
    if (payload.isPrimary === true) {
      await ProductImage.updateMany({ productId: product._id, _id: { $ne: imageId } }, { $set: { isPrimary: false } });
      image.isPrimary = true;
    } else if (payload.isPrimary === false) {
      image.isPrimary = false;
    }

    await image.save();
    if (typeof image.toObject === 'function') {
      return image.toObject();
    }

    return {
      ...image,
      _id: image._id,
    };
  }

  async createProduct(userId, input) {
    const vendorId = await this.resolveVendorIdForUser(userId);
    await this.ensureVendor(vendorId);
    const categoryId = input.categoryId ?? null;
    const brandId = input.brandId ?? null;
    let categoryName = '';
    if (categoryId) {
      const category = await Category.findOne({ _id: categoryId, deletedAt: null, status: 'ACTIVE' });
      if (!category) throw new AppError(400, 'INVALID_CATEGORY', 'Category does not exist or is inactive');
      categoryName = category.name || category.slug || '';
    }
    if (brandId) {
      const brand = await Brand.findOne({ _id: brandId, deletedAt: null, status: 'ACTIVE' });
      if (!brand) throw new AppError(400, 'INVALID_BRAND', 'Brand does not exist or is inactive');
    }

    try {
      const slug = await buildUniqueProductSlug(input.name);
      const product = await Product.create({
        vendorId,
        name: input.name,
        slug,
        shortDescription: input.shortDescription,
        description: input.description,
        categoryId,
        subcategoryId: input.subcategoryId ?? null,
        brandId,
        tags: input.tags ?? [],
        attributes: input.attributes ?? {},
        status: 'DRAFT',
        featured: input.featured ?? false,
        seo: input.seo ?? {},
        authenticity: input.authenticity ?? { status: 'UNVERIFIED' },
        shipping: input.shipping ?? {},
        tax: input.tax ?? { taxable: true },
      });

      if (input.variants && input.variants.length > 0) {
        const savedVariants = await Promise.all(input.variants.map(async (variant, index) => {
          const hasExplicitSku = Boolean(variant.sku?.trim());
          const normalizedVariant = {
            ...variant,
            price: parsePrice(variant.price),
            compareAtPrice: variant.compareAtPrice == null ? null : Number(variant.compareAtPrice),
            costPrice: variant.costPrice == null ? null : Number(variant.costPrice),
            weight: variant.weight == null ? null : Number(variant.weight),
          };
          const base = generatedSkuBase(input.name, categoryName, variant, index);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const sku = hasExplicitSku ? await buildUniqueSku(variant.sku) : await buildGeneratedSku(base);
            try {
              return await ProductVariant.create({ productId: product._id, ...normalizedVariant, sku });
            } catch (error) {
              if (!hasExplicitSku && error?.code === 11000) continue;
              throw error;
            }
          }
          throw new AppError(409, 'SKU_GENERATION_FAILED', 'Unable to generate a unique variant SKU');
        }));
        product.variants = savedVariants.map((item) => item._id);
        await product.save();
        await Promise.all(savedVariants.map((variant) => inventoryService.initializeInventory({
          productId: product._id,
          variantId: variant._id,
          actorId: userId,
        })));
      }

      if (input.images && input.images.length > 0) {
        const savedImages = await Promise.all(input.images.map((image) => ProductImage.create({
          productId: product._id,
          ...image,
          isPrimary: Boolean(image.isPrimary),
          sortOrder: Number(image.sortOrder ?? 0),
          width: image.width == null ? null : Number(image.width),
          height: image.height == null ? null : Number(image.height),
          fileSize: image.fileSize == null ? null : Number(image.fileSize),
        })));
        product.images = savedImages.map((image) => image._id);
        await product.save();
      }

      auditService.log('PRODUCT_CREATED', { productId: product._id.toString(), vendorId, status: product.status });
      return findProductWithVariants(product._id);
    } catch (error) {
      if (error && (error.code === 11000 || error.keyPattern?.sku || error.keyPattern?.slug || error.message?.toLowerCase().includes('sku'))) {
        throw new AppError(409, 'SKU_ALREADY_EXISTS', 'Variant SKU already exists');
      }
      throw error;
    }
  }

  async listForVendor(userId, { page = 1, limit = 20, status, search } = {}) {
    const vendorId = await this.resolveVendorIdForUser(userId);
    const query = { vendorId, deletedAt: null };
    if (status) query.status = status;
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.name = { $regex: escaped, $options: 'i' };
    }
    let queryChain = Product.find(query);
    if (typeof queryChain.populate === 'function') {
      queryChain = queryChain
        .populate('variants')
        .populate('images')
        .populate('categoryId', 'name slug')
        .populate('brandId', 'name slug');
    }
    const data = await queryChain.sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const total = await Product.countDocuments(query);

    const variantIds = data.flatMap((p) => (p.variants || []).map((v) => v._id).filter(Boolean));
    const inventories = variantIds.length
      ? await Inventory.find({ variantId: { $in: variantIds }, deletedAt: null }).lean()
      : [];
    const invMap = new Map(inventories.map((inv) => [String(inv.variantId), inv]));

    const enrichedData = data.map((p) => {
      let productAvailableStock = 0;
      let productReservedStock = 0;
      let productSoldStock = 0;

      const enrichedVariants = (p.variants || []).map((v) => {
        const inv = invMap.get(String(v._id));
        const available = typeof inv?.availableQuantity === 'number' ? inv.availableQuantity : 0;
        const reserved = typeof inv?.reservedQuantity === 'number' ? inv.reservedQuantity : 0;
        const sold = typeof inv?.soldQuantity === 'number' ? inv.soldQuantity : 0;
        productAvailableStock += available;
        productReservedStock += reserved;
        productSoldStock += sold;
        return {
          ...v,
          stock: available,
          availableStock: available,
          reservedStock: reserved,
          soldStock: sold,
        };
      });

      return {
        ...p,
        id: (p._id ?? p.id)?.toString(),
        variantId: p.variants?.[0]?._id?.toString(),
        variants: enrichedVariants,
        stock: productAvailableStock,
        availableStock: productAvailableStock,
        reservedStock: productReservedStock,
        soldStock: productSoldStock,
      };
    });

    return {
      data: enrichedData,
      page,
      limit,
      total,
    };
  }

  async getForVendor(userId, productId) {
    const vendorId = await this.resolveVendorIdForUser(userId);
    let queryChain = Product.findOne({ _id: productId, vendorId, deletedAt: null });
    if (typeof queryChain.populate === 'function') {
      queryChain = queryChain
        .populate('variants')
        .populate('images')
        .populate('categoryId', 'name slug')
        .populate('brandId', 'name slug');
    }
    const product = await queryChain.lean();
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

    const variantIds = (product.variants || []).map((v) => v._id).filter(Boolean);
    const inventories = variantIds.length
      ? await Inventory.find({ variantId: { $in: variantIds }, deletedAt: null }).lean()
      : [];
    const invMap = new Map(inventories.map((inv) => [String(inv.variantId), inv]));

    let productAvailableStock = 0;
    let productReservedStock = 0;
    let productSoldStock = 0;

    const enrichedVariants = (product.variants || []).map((v) => {
      const inv = invMap.get(String(v._id));
      const available = typeof inv?.availableQuantity === 'number' ? inv.availableQuantity : 0;
      const reserved = typeof inv?.reservedQuantity === 'number' ? inv.reservedQuantity : 0;
      const sold = typeof inv?.soldQuantity === 'number' ? inv.soldQuantity : 0;
      productAvailableStock += available;
      productReservedStock += reserved;
      productSoldStock += sold;
      return {
        ...v,
        stock: available,
        availableStock: available,
        reservedStock: reserved,
        soldStock: sold,
      };
    });

    return {
      ...product,
      id: (product._id ?? product.id)?.toString(),
      variantId: product.variants?.[0]?._id?.toString(),
      variants: enrichedVariants,
      stock: productAvailableStock,
      availableStock: productAvailableStock,
      reservedStock: productReservedStock,
      soldStock: productSoldStock,
    };
  }

  async updateProduct(userId, productId, input) {
    const vendorId = await this.resolveVendorIdForUser(userId);
    const product = await Product.findOne({ _id: productId, vendorId, deletedAt: null });
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    if (product.status === 'APPROVED' || product.status === 'PUBLISHED') throw new AppError(403, 'PRODUCT_LOCKED', 'Approved or published products cannot be edited by vendors');
    if (input.name) {
      const nextSlug = normalizeSlug(input.name);
      if (nextSlug !== product.slug) { product.slug = await buildUniqueProductSlug(input.name, productId); }
      product.name = input.name;
    }
    if (input.categoryId !== undefined) {
      const category = await Category.findOne({ _id: input.categoryId, deletedAt: null, status: 'ACTIVE' });
      if (!category) throw new AppError(400, 'INVALID_CATEGORY', 'Category does not exist or is inactive');
      product.categoryId = input.categoryId;
    }
    if (input.brandId !== undefined) {
      const brand = await Brand.findOne({ _id: input.brandId, deletedAt: null, status: 'ACTIVE' });
      if (!brand) throw new AppError(400, 'INVALID_BRAND', 'Brand does not exist or is inactive');
      product.brandId = input.brandId;
    }
    const allowed = ['shortDescription', 'description', 'subcategoryId', 'tags', 'attributes', 'featured', 'seo', 'authenticity', 'shipping', 'tax'];
    for (const field of allowed) {
      if (input[field] !== undefined) product[field] = input[field];
    }
    if (input.status && input.status !== product.status) {
      const allowedTransitions = {
        DRAFT: ['SUBMITTED'],
        REJECTED: ['DRAFT', 'SUBMITTED'],
        UNPUBLISHED: ['DRAFT', 'SUBMITTED'],
      };
      if (!(allowedTransitions[product.status] ?? []).includes(input.status)) {
        throw new AppError(400, 'INVALID_PRODUCT_STATUS', `Cannot transition from ${product.status} to ${input.status}`);
      }
      product.status = input.status;
    }
    if (input.variants !== undefined) {
      const savedVariants = [];
      const category = product.categoryId ? await Category.findOne({ _id: product.categoryId, deletedAt: null }).lean() : null;
      for (const [index, variant] of input.variants.entries()) {
        const hasExplicitSku = Boolean(variant.sku?.trim());
        const variantId = variant._id || variant.id;
        let existing = null;
        if (variantId) {
          existing = await ProductVariant.findOne({ _id: variantId, productId: product._id });
        }
        if (!existing && hasExplicitSku) {
          existing = await ProductVariant.findOne({ productId: product._id, sku: normalizeSku(variant.sku) });
        }
        if (!existing && index === 0 && Array.isArray(product.variants) && product.variants.length > 0) {
          existing = await ProductVariant.findById(product.variants[0]);
        }

        if (existing) {
          const nextSku = hasExplicitSku && normalizeSku(variant.sku) !== existing.sku
            ? await buildUniqueSku(variant.sku, existing._id)
            : existing.sku;
          Object.assign(existing, {
            ...variant,
            sku: nextSku,
            price: parsePrice(variant.price),
            compareAtPrice: variant.compareAtPrice == null ? null : Number(variant.compareAtPrice),
            costPrice: variant.costPrice == null ? null : Number(variant.costPrice),
            weight: variant.weight == null ? null : Number(variant.weight),
          });
          await existing.save();
          savedVariants.push(existing);
        } else {
          const sku = hasExplicitSku
            ? await buildUniqueSku(variant.sku)
            : await buildGeneratedSku(generatedSkuBase(product.name, category?.name || category?.slug, variant, savedVariants.length));
          const created = await ProductVariant.create({ productId: product._id, ...variant, sku, price: parsePrice(variant.price) });
          savedVariants.push(created);
          await inventoryService.initializeInventory({ productId: product._id, variantId: created._id, actorId: userId });
        }
      }
      product.variants = savedVariants.map((variant) => variant._id);
      await ProductVariant.updateMany({ productId: product._id, _id: { $nin: product.variants } }, { $set: { status: 'INACTIVE' } });
    }
    if (Array.isArray(input.images) && input.images.length > 0) {
      await ProductImage.updateMany({ productId: product._id, status: 'ACTIVE' }, { $set: { status: 'INACTIVE' } });
      const savedImages = await Promise.all(input.images.map((image) => ProductImage.create({ productId: product._id, ...image })));
      product.images = savedImages.map((image) => image._id);
    }
    await product.save();
    return findProductWithVariants(product._id);
  }

  async submitForReview(userId, productId) {
    const vendorId = await this.resolveVendorIdForUser(userId);
    const product = await Product.findOne({ _id: productId, vendorId, deletedAt: null });
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    if (!['DRAFT', 'REJECTED', 'UNPUBLISHED'].includes(product.status)) throw new AppError(400, 'INVALID_STATUS_TRANSITION', 'Product cannot be submitted in its current status');
    product.status = 'SUBMITTED';
    await product.save();
    return product.toObject();
  }

  async listPublicCatalog({ q, category, brand, vendor, minPrice, maxPrice, status = 'PUBLISHED', sort = 'newest', limit = 20, cursor = null } = {}) {
    const query = { status: 'PUBLISHED', deletedAt: null };
    if (q && String(q).trim()) {
      const safe = String(q).trim();
      const escaped = safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { shortDescription: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { tags: { $in: [new RegExp(escaped, 'i')] } },
      ];
    }
    if (category) query.categoryId = category;
    if (brand) query.brandId = brand;
    if (vendor) query.vendorId = vendor;
    if (minPrice != null || maxPrice != null) {
      query.$and = [
        ...(query.$and ?? []),
        { $or: [{ variants: { $exists: true } }, { variants: { $ne: [] } }] },
      ];
    }

    const sortMap = {
      newest: { createdAt: -1, _id: -1 },
      oldest: { createdAt: 1, _id: 1 },
      price_asc: { createdAt: -1, _id: -1 },
      price_desc: { createdAt: -1, _id: -1 },
      name_asc: { name: 1, _id: 1 },
      name_desc: { name: -1, _id: -1 },
    };

    const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const filter = cursor && String(cursor).trim() ? { ...query, _id: { $lt: cursor } } : query;

    let queryBuilder = Product.find(filter);
    if (typeof queryBuilder.populate === 'function') {
      queryBuilder = queryBuilder
        .populate({ path: 'variants', match: { status: 'ACTIVE' } })
        .populate({ path: 'images', match: { status: 'ACTIVE' } })
        .populate({ path: 'categoryId', select: 'name slug' })
        .populate({ path: 'brandId', select: 'name slug logo' })
        .populate({ path: 'vendorId', select: 'businessName legalName description website originState originDistrict' });
    }
    if (typeof queryBuilder.sort === 'function') {
      queryBuilder = queryBuilder.sort(sortMap[sort] ?? sortMap.newest);
    }
    if (typeof queryBuilder.limit === 'function') {
      queryBuilder = queryBuilder.limit(pageLimit);
    }
    const rawData = typeof queryBuilder.lean === 'function' ? await queryBuilder.lean() : await queryBuilder;

    const data = (Array.isArray(rawData) ? rawData : []).map((p) => {
      const primaryVariant = Array.isArray(p.variants) ? p.variants[0] : null;
      const price = primaryVariant?.price ?? 0;
      const compareAtPrice = primaryVariant?.compareAtPrice ?? null;
      const primaryImage = Array.isArray(p.images) && p.images.length > 0
        ? (p.images.find((img) => img.isPrimary)?.url ?? p.images[0]?.url ?? '/images/product-vase.jpg')
        : '/images/product-vase.jpg';
      const images = Array.isArray(p.images) && p.images.length > 0 ? p.images.map((img) => img.url || img) : [primaryImage];

      return {
        ...p,
        id: p._id,
        variantId: primaryVariant?._id ?? primaryVariant?.id ?? (typeof primaryVariant === 'string' ? primaryVariant : null),
        price,
        compareAtPrice,
        image: primaryImage,
        images,
        category: p.categoryId?.name || p.craft || 'Handcrafted',
        craft: p.craft || p.tags?.[0] || 'Artisan Craft',
        artisan: p.artisan || 'Rupakar Artisan',
        rating: p.rating ?? 4.9,
        reviews: p.reviews ?? 128,
        story: p.story || p.description,
        dimensions: p.dimensions || 'Handcrafted size',
        material: p.material || 'Natural Terracotta & Pigments',
        care: p.care || 'Dust with soft dry cloth. Avoid direct moisture.',
      };
    });

    const total = await Product.countDocuments(query);
    const hasNextPage = total > pageLimit || (data.length > 0 && data.length >= pageLimit && total > data.length);
    const nextCursor = data.length > 0 ? String(data[data.length - 1]._id) : null;

    return {
      data,
      total,
      pagination: { hasNextPage, nextCursor },
    };
  }

  async getPublicBySlug(slugOrId) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(slugOrId));
    const query = {
      status: 'PUBLISHED',
      deletedAt: null,
      $or: [{ slug: slugOrId }, ...(isObjectId ? [{ _id: slugOrId }] : [])],
    };

    let queryBuilder = Product.findOne(query);
    if (typeof queryBuilder.populate === 'function') {
      queryBuilder = queryBuilder
        .populate({ path: 'variants', match: { status: 'ACTIVE' } })
        .populate({ path: 'images', match: { status: 'ACTIVE' } })
        .populate({ path: 'categoryId', select: 'name slug' })
        .populate({ path: 'brandId', select: 'name slug logo' })
        .populate({ path: 'vendorId', select: 'businessName legalName description website originState originDistrict' });
    }
    const product = typeof queryBuilder.lean === 'function' ? await queryBuilder.lean() : await queryBuilder;
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

    const primaryVariant = Array.isArray(product.variants) ? product.variants[0] : null;
    const price = primaryVariant?.price ?? 0;
    const compareAtPrice = primaryVariant?.compareAtPrice ?? null;
    const primaryImage = Array.isArray(product.images) && product.images.length > 0
      ? (product.images.find((img) => img.isPrimary)?.url ?? product.images[0]?.url ?? '/images/product-vase.jpg')
      : '/images/product-vase.jpg';
    const images = Array.isArray(product.images) && product.images.length > 0 ? product.images.map((img) => img.url || img) : [primaryImage];

    return {
      ...product,
      id: product._id,
      price,
      compareAtPrice,
      image: primaryImage,
      images,
      category: product.categoryId?.name || 'Handcrafted',
      craft: product.craft || product.tags?.[0] || 'Artisan Craft',
      artisan: product.artisan || 'Rupakar Artisan',
      rating: product.rating ?? 4.9,
      reviews: product.reviews ?? 128,
      story: product.story || product.description,
      dimensions: product.dimensions || 'Handcrafted size',
      material: product.material || 'Natural Terracotta & Pigments',
      care: product.care || 'Dust with soft dry cloth. Avoid direct moisture.',
    };
  }

  async adminList({ status, page = 1, limit = 20 } = {}) {
    const query = { deletedAt: null };
    if (status) query.status = status;
    const data = await Product.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const total = await Product.countDocuments(query);
    return { data, page, limit, total };
  }

  async getByIdForAdmin(productId) {
    const product = await Product.findOne({ _id: productId, deletedAt: null }).lean();
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    return product;
  }

  async setProductStatus(productId, nextStatus, actorId, reason = '') {
    const product = await Product.findById(productId);
    if (!product || product.deletedAt) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const allowedTransitions = {
      DRAFT: ['SUBMITTED'],
      SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
      UNDER_REVIEW: ['APPROVED', 'REJECTED'],
      APPROVED: ['PUBLISHED'],
      REJECTED: ['DRAFT'],
      PUBLISHED: ['UNPUBLISHED', 'ARCHIVED'],
      UNPUBLISHED: ['PUBLISHED'],
      ARCHIVED: ['PUBLISHED'],
    };
    const current = product.status;
    const allowed = allowedTransitions[current] ?? [];
    if (!allowed.includes(nextStatus)) throw new AppError(400, 'INVALID_PRODUCT_STATUS', `Cannot transition from ${current} to ${nextStatus}`);
    if (nextStatus === 'REJECTED' && !reason.trim()) throw new AppError(400, 'PRODUCT_REJECTION_REASON_REQUIRED', 'A rejection reason is required');

    product.status = nextStatus;
    product.reviewedBy = actorId;
    product.reviewedAt = new Date();
    product.rejectionReason = nextStatus === 'REJECTED' ? reason || 'No reason provided' : null;
    if (nextStatus === 'PUBLISHED' && !product.publishedAt) product.publishedAt = new Date();
    if (nextStatus !== 'PUBLISHED') product.publishedAt = null;
    await product.save();

    auditService.log('PRODUCT_STATUS_UPDATED', {
      productId: product._id.toString(),
      actorId,
      from: current,
      to: nextStatus,
      reason: reason || null,
    });

    return product.toObject();
  }
}

export const productService = new ProductService();
