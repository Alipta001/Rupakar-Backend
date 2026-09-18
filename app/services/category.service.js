import { AppError } from '../utils/app-error.js';
import { Product } from '../models/product.model.js';
import { Category } from '../models/category.model.js';

const normalizeSlug = (value) => {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return slug || 'category';
};

const buildUniqueSlug = async (base, excludeId = null) => {
  const root = normalizeSlug(base);
  let slug = root;
  let suffix = 1;
  while (suffix <= 100) {
    const existing = await Category.findOne({ slug, deletedAt: null, _id: { $ne: excludeId } });
    if (!existing) return slug;
    slug = `${root}-${suffix}`;
    suffix += 1;
  }
  throw new AppError(409, 'CATEGORY_SLUG_EXISTS', 'Category slug already exists');
};

const getAncestorIds = async (categoryId) => {
  const ids = [];
  let currentId = categoryId;
  while (currentId) {
    ids.push(currentId);
    const parent = await Category.findById(currentId).lean();
    if (!parent || !parent.parentId) break;
    currentId = parent.parentId;
  }
  return ids;
};

export class CategoryService {
  async listActive({ page = 1, limit = 100 } = {}) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
    const filter = { deletedAt: null, status: 'ACTIVE' };
    const [items, total] = await Promise.all([
      Category.find(filter).sort({ level: 1, sortOrder: 1, name: 1, _id: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      Category.countDocuments(filter),
    ]);
    return { items, page: safePage, limit: safeLimit, total };
  }

  async getBySlug(slug) {
    const category = await Category.findOne({ slug, deletedAt: null, status: 'ACTIVE' }).lean();
    if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    return category;
  }

  async createCategory(input) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new AppError(400, 'CATEGORY_NAME_REQUIRED', 'Category name is required');
    const slug = await buildUniqueSlug(name);
    let parent = null;
    if (input.parentId) {
      parent = await Category.findOne({ _id: input.parentId, deletedAt: null });
      if (!parent) throw new AppError(400, 'INVALID_PARENT_CATEGORY', 'Parent category not found');
    }
    const category = await Category.create({
      name, slug, description: input.description, image: input.image, parentId: input.parentId ?? null, level: parent ? parent.level + 1 : 1, status: input.status ?? 'ACTIVE', sortOrder: input.sortOrder ?? 0, seo: input.seo ?? {},
    });
    return category.toObject();
  }

  async updateCategory(id, input) {
    const category = await Category.findById(id);
    if (!category || category.deletedAt) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    if (input.parentId && String(input.parentId) === String(id)) throw new AppError(400, 'INVALID_PARENT_CATEGORY', 'Category cannot be its own parent');
    if (input.parentId) {
      const parent = await Category.findById(input.parentId);
      if (!parent || parent.deletedAt) throw new AppError(400, 'INVALID_PARENT_CATEGORY', 'Parent category not found');
      const ancestorIds = await getAncestorIds(parent._id.toString());
      if (ancestorIds.includes(String(id))) throw new AppError(400, 'CIRCULAR_CATEGORY_HIERARCHY', 'A circular category relationship is not allowed');
      category.parentId = input.parentId;
      category.level = parent.level + 1;
    }
    if (input.name) {
      const safeName = String(input.name).trim();
      if (!safeName) throw new AppError(400, 'CATEGORY_NAME_REQUIRED', 'Category name is required');
      category.name = safeName;
      category.slug = await buildUniqueSlug(safeName, category._id);
    }
    if (input.description !== undefined) category.description = input.description;
    if (input.image !== undefined) category.image = input.image;
    if (input.status !== undefined) category.status = input.status;
    if (input.sortOrder !== undefined) category.sortOrder = Number(input.sortOrder);
    if (input.seo !== undefined) category.seo = input.seo;
    await category.save();
    return category.toObject();
  }

  async deleteCategory(id) {
    const category = await Category.findById(id);
    if (!category || category.deletedAt) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    const activeProductCount = await Product.countDocuments({ deletedAt: null, $or: [{ categoryId: category._id }, { subcategoryId: category._id }] });
    if (activeProductCount > 0) throw new AppError(409, 'CATEGORY_IN_USE', 'Category is still associated with active products');
    category.deletedAt = new Date();
    category.status = 'INACTIVE';
    await category.save();
    return true;
  }
}

export const categoryService = new CategoryService();
