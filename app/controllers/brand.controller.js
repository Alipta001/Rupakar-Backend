import { brandService } from '../services/brand.service.js';
import { createBrandSchema, updateBrandSchema } from '../validators/brand.validators.js';

export const listBrands = async (_req, res, next) => {
  try {
    const page = Math.max(Number(_req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(_req.query.limit) || 100, 1), 100);
    const brands = await brandService.listActive({ page, limit });
    res.status(200).json({
      success: true,
      data: brands,
      message: 'Brands loaded',
      requestId: String(_req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getBrandBySlug = async (req, res, next) => {
  try {
    const brand = await brandService.getBySlug(req.params.slug);
    res.status(200).json({
      success: true,
      data: brand,
      message: 'Brand loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const createBrand = async (req, res, next) => {
  try {
    const payload = createBrandSchema.parse(req.body);
    const brand = await brandService.createBrand(payload);
    res.status(201).json({
      success: true,
      data: brand,
      message: 'Brand created',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const updateBrand = async (req, res, next) => {
  try {
    const payload = updateBrandSchema.parse(req.body);
    const brand = await brandService.updateBrand(req.params.id, payload);
    res.status(200).json({
      success: true,
      data: brand,
      message: 'Brand updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteBrand = async (req, res, next) => {
  try {
    await brandService.deleteBrand(req.params.id);
    res.status(200).json({
      success: true,
      data: { deleted: true },
      message: 'Brand deleted',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
