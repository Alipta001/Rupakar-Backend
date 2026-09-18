import { AppError } from '../utils/app-error.js';
import { Brand } from '../models/brand.model.js';

const normalizeSlug = (value) => {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return slug || 'brand';
};

const buildUniqueBrandSlug = async (base, excludeId = null) => {
  const root = normalizeSlug(base);
  let slug = root;
  let suffix = 1;
  while (suffix <= 100) {
    const existing = await Brand.findOne({ slug, deletedAt: null, _id: { $ne: excludeId } });
    if (!existing) return slug;
    slug = `${root}-${suffix}`;
    suffix += 1;
  }
  throw new AppError(409, 'BRAND_SLUG_EXISTS', 'Brand slug already exists');
};

export class BrandService {
  async listActive({ page = 1, limit = 100 } = {}) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
    const filter = { deletedAt: null, status: 'ACTIVE' };
    const [items, total] = await Promise.all([
      Brand.find(filter).sort({ name: 1, _id: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      Brand.countDocuments(filter),
    ]);
    return { items, page: safePage, limit: safeLimit, total };
  }

  async getBySlug(slug) {
    const brand = await Brand.findOne({ slug, deletedAt: null, status: 'ACTIVE' }).lean();
    if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    return brand;
  }

  async createBrand(input) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new AppError(400, 'BRAND_NAME_REQUIRED', 'Brand name is required');
    const slug = await buildUniqueBrandSlug(name);
    const brand = await Brand.create({ name, slug, description: input.description, logo: input.logo, website: input.website, status: input.status ?? 'ACTIVE', seo: input.seo ?? {} });
    return brand.toObject();
  }

  async updateBrand(id, input) {
    const brand = await Brand.findById(id);
    if (!brand || brand.deletedAt) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    if (input.name) {
      const name = String(input.name).trim();
      if (!name) throw new AppError(400, 'BRAND_NAME_REQUIRED', 'Brand name is required');
      brand.name = name;
      brand.slug = await buildUniqueBrandSlug(name, brand._id);
    }
    if (input.description !== undefined) brand.description = input.description;
    if (input.logo !== undefined) brand.logo = input.logo;
    if (input.website !== undefined) brand.website = input.website;
    if (input.status !== undefined) brand.status = input.status;
    if (input.seo !== undefined) brand.seo = input.seo;
    await brand.save();
    return brand.toObject();
  }

  async deleteBrand(id) {
    const brand = await Brand.findById(id);
    if (!brand || brand.deletedAt) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    brand.deletedAt = new Date();
    brand.status = 'INACTIVE';
    await brand.save();
    return true;
  }
}

export const brandService = new BrandService();
