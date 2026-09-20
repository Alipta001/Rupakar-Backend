import { productService } from '../services/product.service.js';
import { createProductSchema, updateProductSchema, submitProductSchema, publicProductQuerySchema, adminReviewSchema } from '../validators/product.validators.js';

const sanitizeProduct = (product) => {
  if (!product) return product;
  const primaryVariant = Array.isArray(product.variants) ? product.variants[0] : null;
  const primaryVariantId = primaryVariant?._id ?? primaryVariant?.id ?? (typeof primaryVariant === 'string' ? primaryVariant : null);
  const price = product.price ?? primaryVariant?.price ?? 0;
  const compareAtPrice = product.compareAtPrice ?? primaryVariant?.compareAtPrice ?? null;
  const primaryImage = product.image ?? (Array.isArray(product.images) && product.images.length > 0
    ? (product.images.find((img) => img?.isPrimary)?.url ?? product.images[0]?.url ?? product.images[0])
    : '/images/product-vase.jpg');
  const images = Array.isArray(product.images) && product.images.length > 0
    ? product.images.map((img) => (typeof img === 'string' ? img : img?.url ?? primaryImage))
    : [primaryImage];

  return {
    id: product._id ?? product.id,
    variantId: primaryVariantId,
    vendorId: product.vendorId,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    brandId: product.brandId,
    tags: product.tags,
    attributes: product.attributes,
    variants: product.variants,
    images,
    image: primaryImage,
    price,
    compareAtPrice,
    category: product.category ?? product.categoryId?.name ?? product.craft ?? 'Handcrafted',
    craft: product.craft ?? product.tags?.[0] ?? 'Artisan Craft',
    artisan: product.artisan ?? 'Rupakar Artisan',
    rating: product.rating ?? 4.9,
    reviews: product.reviews ?? 128,
    story: product.story || product.description,
    dimensions: product.dimensions || 'Handcrafted size',
    material: product.material || 'Natural Terracotta & Pigments',
    care: product.care || 'Dust with soft dry cloth. Avoid direct moisture.',
    status: product.status,
    featured: product.featured,
    seo: product.seo,
    authenticity: product.authenticity,
    shipping: product.shipping,
    tax: product.tax,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};

export const createVendorProduct = async (req, res, next) => {
  try {
    const payload = createProductSchema.parse(req.body);
    const product = await productService.createProduct(req.user.sub, payload);
    res.status(201).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product created',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listVendorProducts = async (req, res, next) => {
  try {
    const result = await productService.listForVendor(req.user.sub, {
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      status: req.query.status,
      search: req.query.search,
    });
    res.status(200).json({
      success: true,
      data: result,
      message: 'Vendor products loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getVendorProduct = async (req, res, next) => {
  try {
    const product = await productService.getForVendor(req.user.sub, req.params.id);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const updateVendorProduct = async (req, res, next) => {
  try {
    const payload = updateProductSchema.parse(req.body);
    const product = await productService.updateProduct(req.user.sub, req.params.id, payload);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const submitVendorProduct = async (req, res, next) => {
  try {
    submitProductSchema.parse(req.body ?? {});
    const product = await productService.submitForReview(req.user.sub, req.params.id);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product submitted for review',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const publicProductList = async (req, res, next) => {
  try {
    const query = publicProductQuerySchema.parse(req.query);
    const result = await productService.listPublicCatalog(query);
    res.status(200).json({
      success: true,
      data: result,
      message: 'Catalog loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const publicProductDetail = async (req, res, next) => {
  try {
    const product = await productService.getPublicBySlug(req.params.slug);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const adminProductList = async (req, res, next) => {
  try {
    const result = await productService.adminList({
      status: req.query.status,
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
    });
    res.status(200).json({
      success: true,
      data: result,
      message: 'Products loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const adminProductDetail = async (req, res, next) => {
  try {
    const product = await productService.getByIdForAdmin(req.params.id);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const approveProduct = async (req, res, next) => {
  try {
    const payload = adminReviewSchema.parse(req.body ?? {});
    const product = await productService.setProductStatus(req.params.id, 'APPROVED', req.user.sub, payload.reason);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product approved',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const rejectProduct = async (req, res, next) => {
  try {
    const payload = adminReviewSchema.parse(req.body ?? {});
    const product = await productService.setProductStatus(req.params.id, 'REJECTED', req.user.sub, payload.reason);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product rejected',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const publishProduct = async (req, res, next) => {
  try {
    const product = await productService.setProductStatus(req.params.id, 'PUBLISHED', req.user.sub);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product published',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const unpublishProduct = async (req, res, next) => {
  try {
    const product = await productService.setProductStatus(req.params.id, 'UNPUBLISHED', req.user.sub);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product unpublished',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const archiveProduct = async (req, res, next) => {
  try {
    const product = await productService.setProductStatus(req.params.id, 'ARCHIVED', req.user.sub);
    res.status(200).json({
      success: true,
      data: sanitizeProduct(product),
      message: 'Product archived',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
