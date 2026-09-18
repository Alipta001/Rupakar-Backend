import { Product } from '../models/product.model.js';

export class SearchService {
  buildPublicQuery({ q, category, brand, vendor, minPrice, maxPrice, sort = 'newest', limit = 20, cursor = null } = {}) {
    const query = { status: 'PUBLISHED', deletedAt: null };

    if (q && String(q).trim()) {
      const safe = String(q).trim();
      query.$or = [
        { name: { $regex: safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { shortDescription: { $regex: safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { description: { $regex: safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { tags: { $in: [new RegExp(safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')] } },
      ];
    }

    if (category) query.categoryId = category;
    if (brand) query.brandId = brand;
    if (vendor) query.vendorId = vendor;

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { createdAt: -1 },
      price_desc: { createdAt: -1 },
      name_asc: { name: 1 },
      name_desc: { name: -1 },
    };

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const normalizedCursor = cursor && String(cursor).trim() ? String(cursor).trim() : null;

    return {
      query,
      sort: sortMap[sort] ?? sortMap.newest,
      limit: safeLimit,
      cursor: normalizedCursor,
    };
  }

  async listPublic({ q, category, brand, vendor, minPrice, maxPrice, sort, limit, cursor } = {}) {
    const { query, sort: sortSpec, limit: pageLimit, cursor: nextCursor } = this.buildPublicQuery({ q, category, brand, vendor, minPrice, maxPrice, sort, limit, cursor });

    const filter = { ...query };
    if (minPrice != null || maxPrice != null) {
      filter.$and = [
        ...(filter.$and ?? []),
        { $or: [{ variants: { $exists: true } }] },
      ];
    }

    const data = await Product.find(filter).sort(sortSpec).skip(nextCursor ? 1 : 0).limit(pageLimit).lean();
    const total = await Product.countDocuments(filter);
    const lastItem = data[data.length - 1] ?? null;

    return {
      data,
      total,
      pagination: {
        hasNextPage: Boolean(lastItem && total > data.length),
        nextCursor: lastItem ? String(lastItem._id) : null,
      },
    };
  }
}

export const searchService = new SearchService();
