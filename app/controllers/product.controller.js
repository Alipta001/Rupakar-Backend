import { productService } from '../services/product.service.js';
import { createProductSchema, updateProductSchema, submitProductSchema, publicProductQuerySchema, adminReviewSchema } from '../validators/product.validators.js';
import { AppError } from '../utils/app-error.js';

const sanitizeProduct = (product) => {
  if (!product) return product;
  const vendor = product.vendorId && typeof product.vendorId === 'object' ? product.vendorId : null;
  const brand = product.brandId && typeof product.brandId === 'object' ? product.brandId : null;
  const category = product.categoryId && typeof product.categoryId === 'object' ? product.categoryId : null;
  const subcategory = product.subcategoryId && typeof product.subcategoryId === 'object' ? product.subcategoryId : null;
  const reviewer = product.reviewedBy && typeof product.reviewedBy === 'object' ? product.reviewedBy : null;

  const primaryVariant = Array.isArray(product.variants) && product.variants.length > 0
    ? (typeof product.variants[0] === 'object' ? product.variants[0] : null)
    : null;
  const primaryVariantId = primaryVariant?._id ?? primaryVariant?.id ?? (typeof product.variants?.[0] === 'string' ? product.variants[0] : null);

  const price = product.price ?? primaryVariant?.price ?? 0;
  const compareAtPrice = product.compareAtPrice ?? primaryVariant?.compareAtPrice ?? null;

  // Real images from ProductImage documents or Cloudinary URLs
  const rawImages = Array.isArray(product.images) ? product.images : [];
  const formattedImages = rawImages
    .map((img) => {
      if (typeof img === 'string') {
        return {
          id: img,
          _id: img,
          url: img,
          storageKey: '',
          altText: '',
          isPrimary: false,
          sortOrder: 0,
          status: 'ACTIVE',
        };
      }
      if (!img) return null;
      const imgId = (img._id ?? img.id)?.toString();
      return {
        _id: imgId,
        id: imgId,
        productId: (img.productId ?? product._id ?? product.id)?.toString(),
        storageKey: img.storageKey || '',
        url: img.url || '',
        altText: img.altText || '',
        sortOrder: typeof img.sortOrder === 'number' ? img.sortOrder : 0,
        isPrimary: Boolean(img.isPrimary),
        width: img.width ?? null,
        height: img.height ?? null,
        fileSize: img.fileSize ?? null,
        mimeType: img.mimeType ?? null,
        status: img.status ?? 'ACTIVE',
      };
    })
    .filter(Boolean);

  const primaryImage = product.image ?? (
    formattedImages.find((img) => img.isPrimary)?.url ?? formattedImages[0]?.url ?? null
  );

  const formattedVariants = Array.isArray(product.variants)
    ? product.variants.map((v) => {
        if (typeof v === 'string') return { _id: v, id: v, sku: '', price: 0, stock: 0 };
        const vId = (v?._id ?? v?.id)?.toString();
        return {
          ...v,
          _id: vId,
          id: vId,
          sku: v?.sku || '',
          barcode: v?.barcode || '',
          price: v?.price ?? 0,
          compareAtPrice: v?.compareAtPrice ?? null,
          costPrice: v?.costPrice ?? null,
          weight: v?.weight ?? null,
          dimensions: v?.dimensions ?? null,
          attributes: v?.attributes ?? {},
          stock: typeof v?.stock === 'number' ? v.stock : typeof v?.availableStock === 'number' ? v.availableStock : 0,
          availableStock: typeof v?.availableStock === 'number' ? v.availableStock : typeof v?.stock === 'number' ? v.stock : 0,
          reservedStock: typeof v?.reservedStock === 'number' ? v.reservedStock : 0,
          status: v?.status ?? 'ACTIVE',
        };
      })
    : [];

  const primarySku = primaryVariant?.sku || formattedVariants[0]?.sku || product.sku || null;
  const dimensions = product.dimensions ?? primaryVariant?.dimensions ?? null;
  const weight = product.weight ?? primaryVariant?.weight ?? null;

  return {
    id: (product._id ?? product.id)?.toString(),
    _id: (product._id ?? product.id)?.toString(),
    sku: primarySku,
    variantId: primaryVariantId?.toString() ?? null,
    vendorId: (vendor?._id ?? product.vendorId)?.toString?.() ?? product.vendorId,
    vendor: vendor ? {
      id: vendor._id?.toString?.() ?? vendor.id,
      _id: vendor._id?.toString?.() ?? vendor.id,
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
    title: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription || null,
    description: product.description || null,
    categoryId: (category?._id ?? product.categoryId)?.toString?.() ?? product.categoryId,
    category: category ? {
      id: (category._id ?? category.id)?.toString?.(),
      name: category.name,
      slug: category.slug,
    } : (typeof product.category === 'object' ? product.category : null),
    categoryName: category?.name || (typeof product.category === 'string' ? product.category : null),
    subcategoryId: (subcategory?._id ?? product.subcategoryId)?.toString?.() ?? product.subcategoryId,
    subcategory: subcategory ? {
      id: (subcategory._id ?? subcategory.id)?.toString?.(),
      name: subcategory.name,
      slug: subcategory.slug,
    } : null,
    brandId: brand ? (brand._id?.toString?.() ?? brand.id) : product.brandId,
    brand: brand ? {
      id: brand._id?.toString?.() ?? brand.id,
      name: brand.name,
      slug: brand.slug,
      logo: brand.logo,
    } : product.brand,
    tags: Array.isArray(product.tags) ? product.tags : [],
    attributes: product.attributes ?? {},
    variants: formattedVariants,
    images: formattedImages,
    image: primaryImage,
    thumbnail: primaryImage,
    price,
    compareAtPrice,
    craft: product.craft ?? product.tags?.[0] ?? null,
    artisan: product.artisan ?? vendor?.businessName ?? null,
    rating: product.rating ?? null,
    reviews: product.reviews ?? null,
    story: product.story || product.description || null,
    dimensions,
    weight,
    material: product.material ?? null,
    care: product.care ?? null,
    status: product.status,
    featured: Boolean(product.featured),
    stock: typeof product.stock === 'number' ? product.stock : typeof product.availableStock === 'number' ? product.availableStock : (formattedVariants.reduce((sum, v) => sum + (v.stock || 0), 0)),
    availableStock: typeof product.availableStock === 'number' ? product.availableStock : typeof product.stock === 'number' ? product.stock : 0,
    reservedStock: typeof product.reservedStock === 'number' ? product.reservedStock : 0,
    seo: product.seo ?? null,
    authenticity: product.authenticity ?? null,
    shipping: product.shipping ?? null,
    tax: product.tax ?? null,
    publishedAt: product.publishedAt ?? null,
    reviewedBy: reviewer ? {
      id: (reviewer._id ?? reviewer.id)?.toString?.(),
      name: reviewer.name,
      email: reviewer.email,
      role: reviewer.role,
    } : product.reviewedBy,
    reviewedAt: product.reviewedAt ?? null,
    rejectionReason: product.rejectionReason ?? null,
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
    const sanitizedItems = (result.data || []).map(sanitizeProduct);
    res.status(200).json({
      success: true,
      data: {
        ...result,
        items: sanitizedItems,
        data: sanitizedItems,
      },
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

export const adminDeleteProduct = async (req, res, next) => {
  try {
    const result = await productService.adminDeleteProduct(req.params.id, req.user.sub);
    res.status(200).json({
      success: true,
      message: result.message,
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteVendorProduct = async (req, res, next) => {
  try {
    const result = await productService.vendorDeleteProduct(req.user.sub, req.params.id);
    res.status(200).json({
      success: true,
      message: result.message,
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const vendorSetOutOfStock = async (req, res, next) => {
  try {
    const result = await productService.setProductOutOfStock(req.user.sub, req.params.id);
    res.status(200).json({
      success: true,
      message: result.message,
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

