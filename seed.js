import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

import { env } from './app/config/env.js';
import { User } from './app/models/user.model.js';
import { Vendor } from './app/models/vendor.model.js';
import { Category } from './app/models/category.model.js';
import { Brand } from './app/models/brand.model.js';
import { Product, ProductImage } from './app/models/product.model.js';
import { ProductVariant } from './app/models/product-variant.model.js';
import { Inventory } from './app/models/inventory.model.js';

/*
|--------------------------------------------------------------------------
| MOCK PRODUCT SEED
|--------------------------------------------------------------------------
|
| This script:
| - DOES NOT DELETE existing products
| - DOES NOT DELETE existing categories/brands
| - Creates/reuses one development vendor
| - Creates 20 mock products
| - Creates one variant for every product
| - Creates inventory for every variant
| - Creates product images
| - Makes products PUBLISHED
| - One product is exactly ₹1
|
| Run:
|   node seed.js
|
| Or add an npm script:
|   "seed:mock-products": "node seed.js"
|
|--------------------------------------------------------------------------
*/

const MOCK_PREFIX = 'MOCK-RUPAKAR-';

async function findOrCreateCategory(data) {
  let category = await Category.findOne({ slug: data.slug });

  if (!category) {
    category = await Category.create(data);
    console.log(`Created category: ${data.name}`);
  } else {
    console.log(`Using existing category: ${data.name}`);
  }

  return category;
}

async function findOrCreateBrand(data) {
  let brand = await Brand.findOne({ slug: data.slug });

  if (!brand) {
    brand = await Brand.create(data);
    console.log(`Created brand: ${data.name}`);
  } else {
    console.log(`Using existing brand: ${data.name}`);
  }

  return brand;
}

async function findOrCreateUser() {
  const passwordHash = await bcrypt.hash('Password123!', 12);

  let user = await User.findOne({
    email: 'vendor@rupakar.com',
  });

  if (!user) {
    user = await User.create({
      name: 'Rupakar Mock Vendor',
      email: 'vendor@rupakar.com',
      password: passwordHash,
      role: 'vendor',
      isActive: true,
      isEmailVerified: true,
      verificationStatus: 'VERIFIED',
    });

    console.log('Created mock vendor user.');
  } else {
    console.log('Using existing vendor user.');
  }

  return user;
}

async function findOrCreateVendor(vendorUser) {
  let vendor = await Vendor.findOne({
    ownerUserId: vendorUser._id,
  });

  if (!vendor) {
    vendor = await Vendor.create({
      ownerUserId: vendorUser._id,
      businessName: 'Rupakar Mock Artisan Store',
      legalName: 'Rupakar Mock Artisan Store',
      email: 'artisans@rupakar.com',
      phone: '+919830012345',
      address:
        '14 Potters Lane, Bishnupur, Bankura, West Bengal 722122',
      originState: 'West Bengal',
      originDistrict: 'Bankura',
      status: 'APPROVED',
      verificationStatus: 'VERIFIED',
    });

    console.log('Created mock vendor.');
  } else {
    console.log('Using existing vendor.');
  }

  return vendor;
}

/*
|--------------------------------------------------------------------------
| Categories
|--------------------------------------------------------------------------
*/

const categoriesData = [
  {
    name: 'Terracotta',
    slug: 'terracotta',
    description:
      'Traditional terracotta crafts, pottery and sculptures from Bengal.',
    image: '/images/collection-terracotta.jpg',
    status: 'ACTIVE',
  },
  {
    name: 'Folk Art',
    slug: 'folk-art',
    description:
      'Traditional Indian folk art and handcrafted decorative pieces.',
    image: '/images/category-folk-art.jpg',
    status: 'ACTIVE',
  },
  {
    name: 'Home Decor',
    slug: 'home-decor',
    description:
      'Handcrafted decorative products for homes and living spaces.',
    image: '/images/collection-decor.jpg',
    status: 'ACTIVE',
  },
  {
    name: 'Dokra Craft',
    slug: 'dokra-craft',
    description:
      'Traditional lost-wax metal craft and Dokra sculptures.',
    image: '/images/category-pottery.jpg',
    status: 'ACTIVE',
  },
  {
    name: 'Textiles',
    slug: 'textiles',
    description:
      'Traditional Bengal handloom, cotton and handcrafted textiles.',
    image: '/images/gallery-3.jpg',
    status: 'ACTIVE',
  },
  {
    name: 'Jute Crafts',
    slug: 'jute-crafts',
    description:
      'Handcrafted jute bags, baskets and lifestyle products.',
    image: '/images/gallery-2.jpg',
    status: 'ACTIVE',
  },
];

/*
|--------------------------------------------------------------------------
| Brands
|--------------------------------------------------------------------------
*/

const brandsData = [
  {
    name: 'Bishnupur Clay Guild',
    slug: 'bishnupur-clay-guild',
    status: 'ACTIVE',
  },
  {
    name: 'Bengal Heritage Crafts',
    slug: 'bengal-heritage-crafts',
    status: 'ACTIVE',
  },
  {
    name: 'Bankura Artisan Collective',
    slug: 'bankura-artisan-collective',
    status: 'ACTIVE',
  },
  {
    name: 'Bengal Handloom House',
    slug: 'bengal-handloom-house',
    status: 'ACTIVE',
  },
  {
    name: 'Bengal Jute Collective',
    slug: 'bengal-jute-collective',
    status: 'ACTIVE',
  },
];

/*
|--------------------------------------------------------------------------
| 20 Mock Products
|--------------------------------------------------------------------------
*/

const productsSeed = [
  {
    name: 'Bishnupur Terracotta Horse',
    slug: 'mock-bishnupur-terracotta-horse',
    categorySlug: 'terracotta',
    brandSlug: 'bishnupur-clay-guild',
    price: 1299,
    compareAtPrice: 1599,
    craft: 'Bishnupur Terracotta Craft',
    region: 'Bishnupur, Bankura, West Bengal',
    artisan: 'Mock Artisan - Biren Kumbhakar',
    material: 'Natural Bankura clay',
    dimensions: '30cm H × 18cm W',
    tags: [
      'terracotta',
      'bishnupur',
      'bankura',
      'horse',
      'bengal',
      'handmade',
    ],
    image: '/images/hero-artisan.jpg',
  },

  {
    name: 'Bankura Terracotta Elephant',
    slug: 'mock-bankura-terracotta-elephant',
    categorySlug: 'terracotta',
    brandSlug: 'bankura-artisan-collective',
    price: 899,
    compareAtPrice: 1199,
    craft: 'Bankura Terracotta Craft',
    region: 'Bankura, West Bengal',
    artisan: 'Mock Artisan - Ramesh Kumbhakar',
    material: 'Natural terracotta clay',
    dimensions: '20cm H × 24cm W',
    tags: ['terracotta', 'elephant', 'bankura', 'bengal'],
    image: '/images/collection-terracotta.jpg',
  },

  {
    name: 'Dokra Tribal Musician',
    slug: 'mock-dokra-tribal-musician',
    categorySlug: 'dokra-craft',
    brandSlug: 'bankura-artisan-collective',
    price: 1899,
    compareAtPrice: 2299,
    craft: 'Dokra Lost-Wax Casting',
    region: 'Bankura, West Bengal',
    artisan: 'Mock Artisan - Shambhu Karmakar',
    material: 'Traditional Dokra metal alloy',
    dimensions: '18cm H × 8cm W',
    tags: ['dokra', 'tribal', 'metal', 'handmade'],
    image: '/images/category-pottery.jpg',
  },

  {
    name: 'Kantha Embroidered Cushion Cover',
    slug: 'mock-kantha-cushion-cover',
    categorySlug: 'textiles',
    brandSlug: 'bengal-handloom-house',
    price: 599,
    compareAtPrice: 799,
    craft: 'Kantha Embroidery',
    region: 'Bolpur, Birbhum, West Bengal',
    artisan: 'Mock Artisan - Mina Das',
    material: 'Handwoven cotton',
    dimensions: '40cm × 40cm',
    tags: ['kantha', 'cushion', 'textile', 'bengal'],
    image: '/images/gallery-3.jpg',
  },

  {
    name: 'Bengal Handloom Cotton Saree',
    slug: 'mock-bengal-handloom-cotton-saree',
    categorySlug: 'textiles',
    brandSlug: 'bengal-handloom-house',
    price: 1599,
    compareAtPrice: 1999,
    craft: 'Bengal Handloom',
    region: 'Nadia, West Bengal',
    artisan: 'Mock Artisan - Anima Roy',
    material: 'Handloom cotton',
    dimensions: '6.2m × 1.1m',
    tags: ['saree', 'cotton', 'handloom', 'bengal'],
    image: '/images/gallery-3.jpg',
  },

  {
    name: 'Traditional Tant Cotton Saree',
    slug: 'mock-tant-cotton-saree',
    categorySlug: 'textiles',
    brandSlug: 'bengal-handloom-house',
    price: 1399,
    compareAtPrice: 1799,
    craft: 'Tant Handloom',
    region: 'Phulia, Nadia, West Bengal',
    artisan: 'Mock Artisan - Sushila Pal',
    material: 'Pure cotton',
    dimensions: '6.3m × 1.1m',
    tags: ['tant', 'saree', 'cotton', 'handloom'],
    image: '/images/gallery-3.jpg',
  },

  {
    name: 'Baluchari Inspired Saree',
    slug: 'mock-baluchari-inspired-saree',
    categorySlug: 'textiles',
    brandSlug: 'bengal-handloom-house',
    price: 2499,
    compareAtPrice: 2999,
    craft: 'Baluchari Handloom',
    region: 'Bishnupur, Bankura, West Bengal',
    artisan: 'Mock Artisan - Partha Das',
    material: 'Silk blend',
    dimensions: '6.2m × 1.1m',
    tags: ['baluchari', 'saree', 'bishnupur', 'silk'],
    image: '/images/gallery-3.jpg',
  },

  {
    name: 'Shantiniketan Leather Handbag',
    slug: 'mock-shantiniketan-leather-handbag',
    categorySlug: 'folk-art',
    brandSlug: 'bengal-heritage-crafts',
    price: 1199,
    compareAtPrice: 1499,
    craft: 'Shantiniketan Leather Craft',
    region: 'Bolpur, Birbhum, West Bengal',
    artisan: 'Mock Artisan - Kaberi Ghosh',
    material: 'Vegetable-tanned leather',
    dimensions: '30cm × 25cm',
    tags: ['leather', 'bag', 'shantiniketan', 'bolpur'],
    image: '/images/gallery-2.jpg',
  },

  {
    name: 'Bengal Jute Handbag',
    slug: 'mock-bengal-jute-handbag',
    categorySlug: 'jute-crafts',
    brandSlug: 'bengal-jute-collective',
    price: 499,
    compareAtPrice: 699,
    craft: 'Jute Craft',
    region: 'Kolkata, West Bengal',
    artisan: 'Mock Artisan - Rekha Mondal',
    material: 'Natural jute',
    dimensions: '35cm × 30cm',
    tags: ['jute', 'bag', 'eco-friendly', 'bengal'],
    image: '/images/gallery-2.jpg',
  },

  {
    name: 'Terracotta Diya Set',
    slug: 'mock-terracotta-diya-set',
    categorySlug: 'home-decor',
    brandSlug: 'bishnupur-clay-guild',
    price: 299,
    compareAtPrice: 399,
    craft: 'Terracotta Lamp Craft',
    region: 'Bankura, West Bengal',
    artisan: 'Mock Artisan - Mohanlal Kumhar',
    material: 'Natural clay',
    dimensions: 'Set of 6',
    tags: ['diya', 'terracotta', 'lamp', 'decor'],
    image: '/images/product-lamp.jpg',
  },

  {
    name: 'Handmade Clay Vase',
    slug: 'mock-handmade-clay-vase',
    categorySlug: 'home-decor',
    brandSlug: 'bishnupur-clay-guild',
    price: 749,
    compareAtPrice: 999,
    craft: 'Traditional Clay Pottery',
    region: 'Bishnupur, West Bengal',
    artisan: 'Mock Artisan - Haripada Pal',
    material: 'Natural river clay',
    dimensions: '28cm H × 14cm D',
    tags: ['vase', 'clay', 'pottery', 'decor'],
    image: '/images/product-vase.jpg',
  },

  {
    name: 'Bengal Wooden Craft Figurine',
    slug: 'mock-bengal-wooden-craft-figurine',
    categorySlug: 'folk-art',
    brandSlug: 'bengal-heritage-crafts',
    price: 699,
    compareAtPrice: 899,
    craft: 'Traditional Wood Craft',
    region: 'Burdwan, West Bengal',
    artisan: 'Mock Artisan - Nirmal Saha',
    material: 'Seasoned hardwood',
    dimensions: '22cm H',
    tags: ['wood', 'figurine', 'craft', 'bengal'],
    image: '/images/gallery-1.jpg',
  },

  {
    name: 'Kantha Table Runner',
    slug: 'mock-kantha-table-runner',
    categorySlug: 'textiles',
    brandSlug: 'bengal-handloom-house',
    price: 449,
    compareAtPrice: 599,
    craft: 'Kantha Stitch',
    region: 'Birbhum, West Bengal',
    artisan: 'Mock Artisan - Malati Das',
    material: 'Cotton fabric',
    dimensions: '150cm × 35cm',
    tags: ['kantha', 'table-runner', 'cotton', 'textile'],
    image: '/images/gallery-3.jpg',
  },

  {
    name: 'Handcrafted Jute Basket',
    slug: 'mock-handcrafted-jute-basket',
    categorySlug: 'jute-crafts',
    brandSlug: 'bengal-jute-collective',
    price: 399,
    compareAtPrice: 549,
    craft: 'Jute Weaving',
    region: 'Kolkata, West Bengal',
    artisan: 'Mock Artisan - Purnima Das',
    material: 'Natural jute fibre',
    dimensions: '30cm × 25cm',
    tags: ['jute', 'basket', 'storage', 'handmade'],
    image: '/images/gallery-2.jpg',
  },

  {
    name: 'Bengal Handloom Dupatta',
    slug: 'mock-bengal-handloom-dupatta',
    categorySlug: 'textiles',
    brandSlug: 'bengal-handloom-house',
    price: 799,
    compareAtPrice: 999,
    craft: 'Handloom Weaving',
    region: 'Nadia, West Bengal',
    artisan: 'Mock Artisan - Rina Ghosh',
    material: 'Handwoven cotton',
    dimensions: '2.4m × 0.9m',
    tags: ['dupatta', 'handloom', 'cotton', 'bengal'],
    image: '/images/gallery-3.jpg',
  },

  {
    name: 'Terracotta Wall Hanging',
    slug: 'mock-terracotta-wall-hanging',
    categorySlug: 'home-decor',
    brandSlug: 'bishnupur-clay-guild',
    price: 899,
    compareAtPrice: 1199,
    craft: 'Terracotta Wall Art',
    region: 'Bankura, West Bengal',
    artisan: 'Mock Artisan - Gopal Kumbhakar',
    material: 'Fired terracotta clay',
    dimensions: '30cm Diameter',
    tags: ['terracotta', 'wall-art', 'decor', 'bengal'],
    image: '/images/collection-decor.jpg',
  },

  {
    name: 'Dokra Decorative Bell',
    slug: 'mock-dokra-decorative-bell',
    categorySlug: 'dokra-craft',
    brandSlug: 'bankura-artisan-collective',
    price: 999,
    compareAtPrice: 1299,
    craft: 'Dokra Lost-Wax Craft',
    region: 'Bankura, West Bengal',
    artisan: 'Mock Artisan - Shambhu Karmakar',
    material: 'Traditional Dokra metal',
    dimensions: '15cm H',
    tags: ['dokra', 'bell', 'metal', 'decor'],
    image: '/images/category-pottery.jpg',
  },

  {
    name: 'Handmade Bamboo Basket',
    slug: 'mock-handmade-bamboo-basket',
    categorySlug: 'home-decor',
    brandSlug: 'bengal-heritage-crafts',
    price: 549,
    compareAtPrice: 749,
    craft: 'Bamboo Weaving',
    region: 'Jalpaiguri, West Bengal',
    artisan: 'Mock Artisan - Bimal Roy',
    material: 'Natural bamboo',
    dimensions: '35cm × 25cm',
    tags: ['bamboo', 'basket', 'handmade', 'eco-friendly'],
    image: '/images/gallery-2.jpg',
  },

  {
    name: 'Bengal Cotton Stole',
    slug: 'mock-bengal-cotton-stole',
    categorySlug: 'textiles',
    brandSlug: 'bengal-handloom-house',
    price: 0.50,
    compareAtPrice: 699,
    craft: 'Cotton Handloom',
    region: 'Nadia, West Bengal',
    artisan: 'Mock Artisan - Shila Mondal',
    material: 'Handwoven cotton',
    dimensions: '180cm × 70cm',
    tags: ['stole', 'cotton', 'handloom', 'bengal'],
    image: '/images/gallery-3.jpg',
  },

  /*
  |--------------------------------------------------------------------------
  | ₹1 TEST PRODUCT
  |--------------------------------------------------------------------------
  */

  {
    name: 'Rupakar Test Product - ₹1',
    slug: 'mock-test-product-one-rupee',
    categorySlug: 'home-decor',
    brandSlug: 'bengal-heritage-crafts',
    price: 1,
    compareAtPrice: 1,
    craft: 'Testing Product',
    region: 'West Bengal, India',
    artisan: 'Rupakar Development Test',
    material: 'Test Product',
    dimensions: '10cm × 10cm',
    tags: [
      'test',
      'development',
      'one-rupee',
      'rupakar',
    ],
    image: '/images/collection-decor.jpg',
  },
];

async function seed() {
  let createdCount = 0;
  let skippedCount = 0;

  try {
    /*
    |--------------------------------------------------------------------------
    | Connect MongoDB
    |--------------------------------------------------------------------------
    */

    const mongoUri = (env.MONGODB_URI || '').trim();

    if (!mongoUri) {
      throw new Error('MongoDB URI is not configured.');
    }

    console.log('\n==========================================');
    console.log('RUPAKAR MOCK PRODUCT SEED');
    console.log('==========================================\n');

    console.log('Connecting to MongoDB using validated configuration...');

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
    });

    console.log('Connected to MongoDB:');
    console.log(`  Host / Cluster    : ${mongoose.connection.host}`);
    console.log(`  Database Name     : ${mongoose.connection.name}`);
    console.log(`  Connection State  : ${mongoose.connection.readyState === 1 ? 'Connected (1)' : mongoose.connection.readyState}\n`);

    /*
    |--------------------------------------------------------------------------
    | Vendor User
    |--------------------------------------------------------------------------
    */

    const vendorUser = await findOrCreateUser();

    /*
    |--------------------------------------------------------------------------
    | Vendor
    |--------------------------------------------------------------------------
    */

    const vendor = await findOrCreateVendor(vendorUser);

    /*
    |--------------------------------------------------------------------------
    | Categories
    |--------------------------------------------------------------------------
    */

    console.log('\nPreparing categories...');

    const categoryMap = {};

    for (const categoryData of categoriesData) {
      const category = await findOrCreateCategory(categoryData);

      categoryMap[categoryData.slug] = category;
    }

    /*
    |--------------------------------------------------------------------------
    | Brands
    |--------------------------------------------------------------------------
    */

    console.log('\nPreparing brands...');

    const brandMap = {};

    for (const brandData of brandsData) {
      const brand = await findOrCreateBrand(brandData);

      brandMap[brandData.slug] = brand;
    }

    /*
    |--------------------------------------------------------------------------
    | Products
    |--------------------------------------------------------------------------
    */

    console.log('\nCreating mock products...\n');

    for (const item of productsSeed) {
      const sku = `${MOCK_PREFIX}${item.slug
        .replace(/^mock-/, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')}-STD`;

      /*
      |--------------------------------------------------------------------------
      | Idempotency & Orphan Recovery
      |--------------------------------------------------------------------------
      |
      | Check if product AND variant exist and are properly linked.
      | If products were deleted externally but variants remained, clean up
      | the orphaned records before recreating so products are not falsely skipped.
      |
      */

      const existingProduct = await Product.findOne({ slug: item.slug });
      const existingVariant = await ProductVariant.findOne({ sku });

      if (existingProduct && existingVariant && existingVariant.productId?.equals(existingProduct._id)) {
        const existingInventory = await Inventory.findOne({ variantId: existingVariant._id });
        if (existingInventory && existingProduct.variants?.length > 0) {
          console.log(`EXISTS: ${item.name} (${sku} already intact)`);
          skippedCount += 1;
          continue;
        }
      }

      // If variant exists without product or points to another product ID, clean up orphans
      if (existingVariant && (!existingProduct || !existingVariant.productId?.equals(existingProduct._id))) {
        console.log(`Reconciling orphaned records for SKU: ${sku}`);
        await ProductImage.deleteMany({ variantId: existingVariant._id });
        await Inventory.deleteMany({ variantId: existingVariant._id });
        await ProductVariant.deleteMany({ sku });
      }

      // If product exists without variant or broken, clean up product records before recreation
      if (existingProduct && (!existingVariant || !existingVariant.productId?.equals(existingProduct._id))) {
        console.log(`Reconciling broken product record for slug: ${item.slug}`);
        await ProductImage.deleteMany({ productId: existingProduct._id });
        await Inventory.deleteMany({ productId: existingProduct._id });
        await ProductVariant.deleteMany({ productId: existingProduct._id });
        await Product.deleteOne({ _id: existingProduct._id });
      }

      const categoryDoc = categoryMap[item.categorySlug];

      const brandDoc = brandMap[item.brandSlug];

      if (!categoryDoc) {
        throw new Error(
          `Category not found: ${item.categorySlug}`,
        );
      }

      if (!brandDoc) {
        throw new Error(
          `Brand not found: ${item.brandSlug}`,
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Product
      |--------------------------------------------------------------------------
      */

      const product = await Product.create({
        vendorId: vendor._id,

        name: item.name,

        slug: item.slug,

        shortDescription: `Mock development product: ${item.name}.`,

        description:
          `${item.name} is a development/test product created for testing the Rupakar ecommerce flow. ` +
          `This product is mock data and is not intended to represent a real retail listing.`,

        categoryId: categoryDoc._id,

        brandId: brandDoc._id,

        tags: item.tags,

        attributes: {
          craft: [item.craft],
          region: [item.region],
          artisan: [item.artisan],
          material: [item.material],
          dimensions: [item.dimensions],
          mockProduct: ['true'],
        },

        status: 'PUBLISHED',

        featured: true,

        publishedAt: new Date(),

        shipping: {
          originState: 'West Bengal',
          originDistrict: 'Bankura',
          deliveryDays: 5,
          freeShipping: item.price >= 1500,
        },

        tax: {
          taxable: true,
          gstIncluded: true,
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Variant
      |--------------------------------------------------------------------------
      */

      const variant = await ProductVariant.create({
        productId: product._id,

        sku,

        price: item.price,

        compareAtPrice: item.compareAtPrice,

        weight: 1200,

        status: 'ACTIVE',

        attributes: {
          Edition: 'Standard Mock Product',
        },
      });

      /*
      |--------------------------------------------------------------------------
      | Images
      |--------------------------------------------------------------------------
      */

      const imageUrls = [
        item.image,
        '/images/collection-terracotta.jpg',
        '/images/gallery-3.jpg',
      ];

      const imageDocs = [];

      for (let index = 0; index < imageUrls.length; index += 1) {
        const imageDoc = await ProductImage.create({
          productId: product._id,

          variantId: variant._id,

          storageKey: `mock-products/${item.slug}-${index}`,

          url: imageUrls[index],

          altText: `${item.name} mock image ${index + 1}`,

          sortOrder: index,

          isPrimary: index === 0,

          status: 'ACTIVE',
        });

        imageDocs.push(imageDoc);
      }

      /*
      |--------------------------------------------------------------------------
      | Attach variant/images to product
      |--------------------------------------------------------------------------
      */

      product.variants = [variant._id];

      product.images = imageDocs.map(
        (imageDoc) => imageDoc._id,
      );

      await product.save();

      /*
      |--------------------------------------------------------------------------
      | Inventory
      |--------------------------------------------------------------------------
      */

      await Inventory.create({
        productId: product._id,

        variantId: variant._id,

        availableQuantity: 100,

        reservedQuantity: 0,

        soldQuantity: 0,

        lowStockThreshold: 5,

        status: 'ACTIVE',
      });

      createdCount += 1;

      console.log(
        `CREATED: ${item.name} | ₹${item.price} | Stock: 100`,
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Summary
    |--------------------------------------------------------------------------
    */

    console.log('\n==========================================');
    console.log('SEED COMPLETE & VERIFIED');
    console.log('==========================================');
    console.log(`Host / Cluster           : ${mongoose.connection.host}`);
    console.log(`Database Name            : ${mongoose.connection.name}`);
    console.log(`Product Collection       : ${Product.collection.name}`);
    console.log(`Products Inserted (Run)  : ${createdCount}`);
    console.log(`Products Skipped (Run)   : ${skippedCount}`);

    const finalProductCount = await Product.countDocuments();
    const finalVariantCount = await ProductVariant.countDocuments();
    const finalImageCount = await ProductImage.countDocuments();
    const finalInventoryCount = await Inventory.countDocuments();
    const finalCategoryCount = await Category.countDocuments();
    const finalBrandCount = await Brand.countDocuments();

    console.log(`Final Products Count     : ${finalProductCount}`);
    console.log(`Final Variants Count     : ${finalVariantCount}`);
    console.log(`Final Images Count       : ${finalImageCount}`);
    console.log(`Final Inventory Count    : ${finalInventoryCount}`);
    console.log(`Final Categories Count   : ${finalCategoryCount}`);
    console.log(`Final Brands Count       : ${finalBrandCount}`);

    const sampleProduct = await Product.findOne().populate('variants');
    if (sampleProduct) {
      const sampleVariant = sampleProduct.variants?.[0];
      console.log('\nSample Product:');
      console.log(`  Name  : ${sampleProduct.name}`);
      console.log(`  Slug  : ${sampleProduct.slug}`);
      console.log(`  SKU   : ${sampleVariant?.sku || 'N/A'}`);
      console.log(`  Price : ₹${sampleVariant?.price ?? 'N/A'}`);
    }

    console.log('\n₹1 TEST PRODUCT:');
    const oneRupeeProduct = await ProductVariant.findOne({
      sku: `${MOCK_PREFIX}TEST-PRODUCT-ONE-RUPEE-STD`,
    });

    if (oneRupeeProduct) {
      console.log(`  Price : ₹${oneRupeeProduct.price}`);
      console.log(`  SKU   : ${oneRupeeProduct.sku}`);
      console.log('  Status: READY FOR TESTING');
    } else {
      console.log('  WARNING: ₹1 product was not found.');
    }

    console.log('\nNo valid existing products were deleted.');
    console.log('==========================================\n');
  } catch (error) {
    console.error('\n==========================================');
    console.error('SEED FAILED');
    console.error('==========================================\n');

    console.error(error);

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();

    console.log('MongoDB connection closed.');
  }
}

seed();