import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProductService } from '../app/services/product.service.js';
import { Product } from '../app/models/product.model.js';
import { Category } from '../app/models/category.model.js';
import { Brand } from '../app/models/brand.model.js';
import {
  normalizeText,
  extractTokens,
  getSynonymsForQuery,
  scoreProductRelevance,
  parseSearchQuery,
} from '../app/utils/search-relevance.js';

describe('Search Relevance Engine', () => {
  describe('Text normalization & query tokenization', () => {
    it('normalizes lowercase, trims whitespace, handles accents and punctuation safely', () => {
      expect(normalizeText('  Décor & Wall-Art!  ')).toBe('decor wall art');
      expect(normalizeText('Terracotta / Clay - Pots')).toBe('terracotta clay pots');
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(undefined)).toBe('');
    });

    it('extracts meaningful tokens and filters stopwords on multi-word queries', () => {
      const tokens = extractTokens('the wall decor in the room');
      expect(tokens).toEqual(['wall', 'decor', 'room']);
    });

    it('preserves single-word queries even if short or in stopwords', () => {
      expect(extractTokens('art')).toEqual(['art']);
      expect(extractTokens('in')).toEqual(['in']);
    });

    it('provides curated craft synonyms without aggressive false matches', () => {
      const wallDecorSynonyms = getSynonymsForQuery('wall decor');
      expect(wallDecorSynonyms).toContain('wall hanging');
      expect(wallDecorSynonyms).toContain('wall art');

      const terracottaSynonyms = getSynonymsForQuery('clay');
      expect(terracottaSynonyms).toContain('terracotta');

      const lampSynonyms = getSynonymsForQuery('lamp');
      expect(lampSynonyms).toContain('diya');

      // Unrelated term produces zero synonyms
      const laptopSynonyms = getSynonymsForQuery('laptop');
      expect(laptopSynonyms).toHaveLength(0);
    });
  });

  describe('Relevance scoring', () => {
    const terracottaWallHanging = {
      _id: 'prod-1',
      name: 'Terracotta Wall Hanging',
      categoryId: { name: 'Home Decor', slug: 'home-decor' },
      craft: 'Terracotta Craft',
      tags: ['terracotta', 'wall-art', 'decor', 'hanging'],
      shortDescription: 'Traditional clay wall decor piece handcrafted by Bengal artisans.',
      description: 'Handmade terracotta wall hanging for home decoration and wall accent.',
      attributes: {
        craft: ['Terracotta'],
        material: ['Clay', 'Terracotta'],
      },
    };

    it('finds "Terracotta Wall Hanging" when user searches "wall decor"', () => {
      const queryInfo = parseSearchQuery('wall decor');
      const score = scoreProductRelevance(terracottaWallHanging, queryInfo);
      expect(score).toBeGreaterThan(150);
    });

    it('gives highest score to exact product name match', () => {
      const exactQuery = parseSearchQuery('Terracotta Wall Hanging');
      const partialQuery = parseSearchQuery('hanging');

      const exactScore = scoreProductRelevance(terracottaWallHanging, exactQuery);
      const partialScore = scoreProductRelevance(terracottaWallHanging, partialQuery);

      expect(exactScore).toBeGreaterThan(1000);
      expect(exactScore).toBeGreaterThan(partialScore);
    });

    it('supports partial word matching', () => {
      const queryInfo1 = parseSearchQuery('terracot');
      const score1 = scoreProductRelevance(terracottaWallHanging, queryInfo1);
      expect(score1).toBeGreaterThan(0);

      const queryInfo2 = parseSearchQuery('hang');
      const score2 = scoreProductRelevance(terracottaWallHanging, queryInfo2);
      expect(score2).toBeGreaterThan(0);
    });

    it('finds product via synonym / related terms ("clay", "decoration")', () => {
      const clayQuery = parseSearchQuery('clay');
      const clayScore = scoreProductRelevance(terracottaWallHanging, clayQuery);
      expect(clayScore).toBeGreaterThan(0);

      const decorQuery = parseSearchQuery('decoration');
      const decorScore = scoreProductRelevance(terracottaWallHanging, decorQuery);
      expect(decorScore).toBeGreaterThan(0);
    });

    it('returns score 0 for unrelated search queries such as "laptop"', () => {
      const laptopQuery = parseSearchQuery('laptop');
      const score = scoreProductRelevance(terracottaWallHanging, laptopQuery);
      expect(score).toBe(0);
    });

    it('does not return product when only single generic stopword matches in body text', () => {
      const unrelatedProduct = {
        _id: 'prod-2',
        name: 'Brass Bell',
        tags: ['brass', 'bell', 'pooja'],
        description: 'Hang it on the wall hook or ceiling.',
      };
      // User searches multi-word "wall decor"
      const queryInfo = parseSearchQuery('wall decor');
      // Product only has incidental single token "wall" in body description, no decor, no tags, no craft
      const score = scoreProductRelevance(unrelatedProduct, queryInfo);
      expect(score).toBe(0);
    });
  });

  describe('ProductService.listPublicCatalog search relevance integration', () => {
    let mockProducts = [];

    beforeEach(() => {
      jest.restoreAllMocks();

      mockProducts = [
        {
          _id: 'prod-1',
          name: 'Terracotta Wall Hanging',
          slug: 'terracotta-wall-hanging',
          status: 'PUBLISHED',
          deletedAt: null,
          categoryId: { _id: 'cat-decor', name: 'Home Decor', slug: 'home-decor' },
          tags: ['terracotta', 'wall-art', 'decor', 'hanging'],
          craft: 'Terracotta Craft',
          shortDescription: 'Clay wall hanging art piece for living room.',
          description: 'A traditional terracotta wall hanging piece perfect for home decoration.',
          variants: [{ _id: 'v1', price: 1299, compareAtPrice: 1599, status: 'ACTIVE' }],
          images: [{ url: '/images/terracotta-hanging.jpg', isPrimary: true, status: 'ACTIVE' }],
          createdAt: new Date('2026-01-01'),
        },
        {
          _id: 'prod-2',
          name: 'Madhubani Handloom Silk Saree',
          slug: 'madhubani-handloom-silk-saree',
          status: 'PUBLISHED',
          deletedAt: null,
          categoryId: { _id: 'cat-textile', name: 'Textiles', slug: 'textiles' },
          tags: ['silk', 'handloom', 'saree', 'bihar'],
          craft: 'Handloom Weaving',
          shortDescription: 'Handwoven pure silk saree.',
          description: 'Authentic handloom silk saree from Bihar weavers.',
          variants: [{ _id: 'v2', price: 4999, compareAtPrice: 5999, status: 'ACTIVE' }],
          images: [{ url: '/images/saree.jpg', isPrimary: true, status: 'ACTIVE' }],
          createdAt: new Date('2026-01-02'),
        },
        {
          _id: 'prod-3',
          name: 'Dokra Brass Oil Lamp',
          slug: 'dokra-brass-oil-lamp',
          status: 'PUBLISHED',
          deletedAt: null,
          categoryId: { _id: 'cat-metal', name: 'Metal Craft', slug: 'metal-craft' },
          tags: ['brass', 'dokra', 'lamp', 'diya'],
          craft: 'Dokra Metal Craft',
          shortDescription: 'Handcrafted brass diya oil lamp.',
          description: 'Ancient lost-wax bell metal craft ritual lamp.',
          variants: [{ _id: 'v3', price: 2199, compareAtPrice: null, status: 'ACTIVE' }],
          images: [{ url: '/images/lamp.jpg', isPrimary: true, status: 'ACTIVE' }],
          createdAt: new Date('2026-01-03'),
        },
      ];

      // Mock Product.find
      jest.spyOn(Product, 'find').mockImplementation((filter) => {
        let results = [...mockProducts];

        // Enforce published / active
        if (filter?.status) {
          results = results.filter((p) => p.status === filter.status);
        }
        if (filter?.deletedAt === null) {
          results = results.filter((p) => p.deletedAt === null);
        }
        if (filter?.categoryId) {
          results = results.filter((p) => String(p.categoryId?._id ?? p.categoryId) === String(filter.categoryId));
        }

        const queryObj = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          limit: jest.fn().mockImplementation((lim) => {
            results = results.slice(0, lim);
            return queryObj;
          }),
          lean: jest.fn().mockImplementation(async () => results),
        };
        return queryObj;
      });

      // Mock Product.countDocuments
      jest.spyOn(Product, 'countDocuments').mockImplementation(async (filter) => {
        let count = mockProducts.length;
        if (filter?.status) count = mockProducts.filter((p) => p.status === filter.status).length;
        return count;
      });

      // Mock Category.find
      jest.spyOn(Category, 'find').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { _id: 'cat-decor', name: 'Home Decor', slug: 'home-decor' },
          { _id: 'cat-textile', name: 'Textiles', slug: 'textiles' },
          { _id: 'cat-metal', name: 'Metal Craft', slug: 'metal-craft' },
        ]),
      });

      // Mock Brand.find
      jest.spyOn(Brand, 'find').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
    });

    it('1. "wall decor" finds "Terracotta Wall Hanging"', async () => {
      const service = new ProductService();
      const result = await service.listPublicCatalog({ q: 'wall decor' });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].name).toBe('Terracotta Wall Hanging');
      expect(result.data.some((p) => p.name === 'Madhubani Handloom Silk Saree')).toBe(false);
    });

    it('2. exact product-name search still works and ranks highest', async () => {
      const service = new ProductService();
      const result = await service.listPublicCatalog({ q: 'Terracotta Wall Hanging' });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].name).toBe('Terracotta Wall Hanging');
    });

    it('3. partial-word search works ("terracot", "hang")', async () => {
      const service = new ProductService();

      const resultPrefix = await service.listPublicCatalog({ q: 'terracot' });
      expect(resultPrefix.data.some((p) => p.name === 'Terracotta Wall Hanging')).toBe(true);

      const resultPartial = await service.listPublicCatalog({ q: 'hang' });
      expect(resultPartial.data.some((p) => p.name === 'Terracotta Wall Hanging')).toBe(true);
    });

    it('4. category/tag-based search works', async () => {
      const service = new ProductService();

      const resultCategory = await service.listPublicCatalog({ q: 'metal craft' });
      expect(resultCategory.data.some((p) => p.name === 'Dokra Brass Oil Lamp')).toBe(true);

      const resultTag = await service.listPublicCatalog({ q: 'saree' });
      expect(resultTag.data.some((p) => p.name === 'Madhubani Handloom Silk Saree')).toBe(true);
    });

    it('5. synonym/related-term search works ("clay", "diya", "handwoven")', async () => {
      const service = new ProductService();

      // "clay" maps to terracotta
      const resultClay = await service.listPublicCatalog({ q: 'clay' });
      expect(resultClay.data.some((p) => p.name === 'Terracotta Wall Hanging')).toBe(true);

      // "diya" maps to oil lamp
      const resultDiya = await service.listPublicCatalog({ q: 'diya' });
      expect(resultDiya.data.some((p) => p.name === 'Dokra Brass Oil Lamp')).toBe(true);

      // "handwoven" maps to handloom
      const resultHandwoven = await service.listPublicCatalog({ q: 'handwoven' });
      expect(resultHandwoven.data.some((p) => p.name === 'Madhubani Handloom Silk Saree')).toBe(true);
    });

    it('6. unrelated search returns no irrelevant products ("laptop")', async () => {
      const service = new ProductService();
      const result = await service.listPublicCatalog({ q: 'laptop' });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('7. published/active visibility rules remain strictly enforced', async () => {
      // Add a draft product and a deleted product matching "wall"
      mockProducts.push({
        _id: 'prod-draft',
        name: 'Terracotta Wall Hanging (Draft)',
        status: 'DRAFT',
        deletedAt: null,
        tags: ['terracotta', 'wall'],
      });
      mockProducts.push({
        _id: 'prod-deleted',
        name: 'Terracotta Wall Hanging (Deleted)',
        status: 'PUBLISHED',
        deletedAt: new Date(),
        tags: ['terracotta', 'wall'],
      });

      const service = new ProductService();
      const result = await service.listPublicCatalog({ q: 'wall decor' });

      // Only the published, non-deleted product should be present
      expect(result.data.every((p) => p.status === 'PUBLISHED')).toBe(true);
      expect(result.data.some((p) => p._id === 'prod-draft')).toBe(false);
      expect(result.data.some((p) => p._id === 'prod-deleted')).toBe(false);
    });

    it('8. pagination and limits remain correct for search results', async () => {
      const service = new ProductService();
      // Search "craft", which matches Terracotta Craft, Dokra Metal Craft, etc.
      const page1 = await service.listPublicCatalog({ q: 'craft', limit: 1 });

      expect(page1.data).toHaveLength(1);
      expect(page1.pagination.hasNextPage).toBe(true);
      expect(page1.pagination.nextCursor).toBe(String(page1.data[0]._id));

      const page2 = await service.listPublicCatalog({ q: 'craft', limit: 1, cursor: page1.pagination.nextCursor });
      expect(page2.data).toHaveLength(1);
      expect(page2.data[0]._id).not.toBe(page1.data[0]._id);
    });
  });
});
