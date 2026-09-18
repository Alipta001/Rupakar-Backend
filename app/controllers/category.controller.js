import { categoryService } from '../services/category.service.js';
import { createCategorySchema, updateCategorySchema } from '../validators/category.validators.js';

export const listCategories = async (_req, res, next) => {
  try {
    const page = Math.max(Number(_req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(_req.query.limit) || 100, 1), 100);
    const categories = await categoryService.listActive({ page, limit });
    res.status(200).json({
      success: true,
      data: categories,
      message: 'Categories loaded',
      requestId: String(_req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getCategoryBySlug = async (req, res, next) => {
  try {
    const category = await categoryService.getBySlug(req.params.slug);
    res.status(200).json({
      success: true,
      data: category,
      message: 'Category loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const payload = createCategorySchema.parse(req.body);
    const category = await categoryService.createCategory(payload);
    res.status(201).json({
      success: true,
      data: category,
      message: 'Category created',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const payload = updateCategorySchema.parse(req.body);
    const category = await categoryService.updateCategory(req.params.id, payload);
    res.status(200).json({
      success: true,
      data: category,
      message: 'Category updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req, res, next) => {
  try {
    await categoryService.deleteCategory(req.params.id);
    res.status(200).json({
      success: true,
      data: { deleted: true },
      message: 'Category deleted',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
