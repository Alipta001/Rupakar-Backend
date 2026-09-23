import { productService } from '../services/product.service.js';
import { createProductSchema, updateProductSchema, submitProductSchema, publicProductQuerySchema, adminReviewSchema } from '../validators/product.validators.js';
import { AppError } from '../utils/app-error.js';

const sanitizeProduct = (product) => {
  if (!product) return product;
  const vendor = product.vendorId && typeof product.vendorId === 'object' ? product.vendorId : null;
  const brand = product.brandId && typeof product.brandId === 'object' ? product.brandId : null;
  const primaryVariant = Array.isArray(product.variants) ? product.variants[0] : null;
  const primaryVariantId = primaryVariant?._id ?? primaryVariant?.id ?? (typeof primaryVariant === 'string' ? primaryVariant : null);
  const price = product.price ?? primaryVariant?.price ?? 0;
  const compareAtPrice = product.compareAtPrice ?? primaryVariant?.compareAtPrice ?? null;
  const primaryImage = product.image ?? (Array.isArray(product.images) && product.images.length > 0
    ? (product.images.find((img) => img?.isPrimary)?.url ?? product.images[0]?.url ?? (typeof product.images[0] === 'string' ? product.images[0] : null))
    : '/images/product-vase.jpg') ?? '/images/product-vase.jpg';

  const formattedImages = Array.isArray(product.images) && product.images.length > 0
    ? product.images.map((img) => {
        if (typeof img === 'string') return img;
        const imgId = (img?._id ?? img?.id)?.toString();
        return {
          _id: imgId,
          id: imgId,
          productId: (img?.productId ?? product._id ?? product.id)?.toString(),
          storageKey: img?.storageKey || '',
          url: img?.url || primaryImage,
          altText: img?.altText || '',
          sortOrder: typeof img?.sortOrder === 'number' ? img.sortOrder : 0,
          isPrimary: Boolean(img?.isPrimary),
          width: img?.width ?? null,
          height: img?.height ?? null,
          fileSize: img?.fileSize ?? null,
          mimeType: img?.mimeType ?? null,
          status: img?.status ?? 'ACTIVE',
        };
      })
    : [primaryImage];

  const formattedVariants = Array.isArray(product.variants)
    ? product.variants.map((v) => {
        if (typeof v === 'string') return { _id: v, id: v, price: 0 };
        const vId = (v?._id ?? v?.id)?.toString();
        return {
          ...v,
          _id: vId,
          id: vId,
          sku: v?.sku || '',
          price: v?.price ?? 0,
          compareAtPrice: v?.compareAtPrice ?? null,
          stock: typeof v?.stock === 'number' ? v.stock : typeof v?.availableStock === 'number' ? v.availableStock : 0,
          availableStock: typeof v?.availableStock === 'number' ? v.availableStock : typeof v?.stock === 'number' ? v.stock : 0,
          reservedStock: typeof v?.reservedStock === 'number' ? v.reservedStock : 0,
        };
      })
    : [];

  return {
    id: (product._id ?? product.id)?.toString(),
    variantId: primaryVariantId?.toString() ?? null,
    vendorId: (vendor?._id ?? product.vendorId)?.toString?.() ?? product.vendorId,
    vendor: vendor ? {
      id: vendor._id?.toString?.() ?? vendor.id,
      businessName: vendor.businessName,
      legalName: vendor.legalName,
      description: vendor.description,
      website: vendor.website,
      originState: vendor.originState,
      originDistrict: vendor.originDistrict,
    } : undefined,
    retailer: vendor?.businessName ?? vendor?.legalName ?? product.retailer,
    shopkeeper: vendor?.businessName ?? vendor?.legalName ?? product.shopkeeper,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    brandId: brand ? { _id: brand._id, id: brand._id?.toString?.() ?? brand.id, name: brand.name, slug: brand.slug, logo: brand.logo } : product.brandId,
    brand: brand ? { id: brand._id?.toString?.() ?? brand.id, name: brand.name, slug: brand.slug, logo: brand.logo } : product.brand,
    tags: product.tags,
    attributes: product.attributes,
    variants: formattedVariants,
    images: formattedImages,
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
    stock: typeof product.stock === 'number' ? product.stock : typeof product.availableStock === 'number' ? product.availableStock : 0,
    availableStock: typeof product.availableStock === 'number' ? product.availableStock : typeof product.stock === 'number' ? product.stock : 0,
    reservedStock: typeof product.reservedStock === 'number' ? product.reservedStock : 0,
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

export const uploadVendorProductImage = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'IMAGE_REQUIRED', 'Image file is required');
    }

    const payload = {
      altText: req.body.altText,
      sortOrder: req.body.sortOrder,
      isPrimary: req.body.isPrimary === 'true' || req.body.isPrimary === true,
    };

    const image = await productService.uploadProductImage(req.user.sub, req.params.id, req.file, payload);
    res.status(201).json({
      success: true,
      data: image,
      message: 'Product image uploaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteVendorProductImage = async (req, res, next) => {
  try {
    const result = await productService.deleteProductImage(req.user.sub, req.params.id, req.params.imageId);
    res.status(200).json({
      success: true,
      data: result,
      message: 'Product image deleted',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const updateVendorProductImage = async (req, res, next) => {
  try {
    const payload = {
      altText: req.body.altText,
      sortOrder: req.body.sortOrder,
      isPrimary: req.body.isPrimary,
    };

    const image = await productService.updateProductImage(req.user.sub, req.params.id, req.params.imageId, payload);
    res.status(200).json({
      success: true,
      data: image,
      message: 'Product image updated',
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
