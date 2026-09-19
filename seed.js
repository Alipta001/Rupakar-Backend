// import mongoose from 'mongoose';
// import bcrypt from 'bcryptjs';
// import dotenv from 'dotenv';
// import { env } from './app/config/env.js';
// import { User } from './app/models/user.model.js';
// import { Vendor } from './app/models/vendor.model.js';
// import { Category } from './app/models/category.model.js';
// import { Brand } from './app/models/brand.model.js';
// import { Product, ProductImage } from './app/models/product.model.js';
// import { ProductVariant } from './app/models/product-variant.model.js';
// import { Inventory } from './app/models/inventory.model.js';

// dotenv.config();

// async function seed() {
//   const mongoUri = (process.env.MONGODB_URI || process.env.MONGO_URL || env.MONGODB_URI).trim();
//   console.log('Connecting to database...');
//   await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
//   console.log('Connected to MongoDB.');

//   console.log('Clearing existing catalog and demo accounts...');
//   await Promise.all([
//     Product.deleteMany({}),
//     ProductVariant.deleteMany({}),
//     ProductImage.deleteMany({}),
//     Inventory.deleteMany({}),
//     Category.deleteMany({}),
//     Brand.deleteMany({}),
//   ]);

//   const passwordHash = await bcrypt.hash('Password123!', 12);

//   // Upsert demo accounts
//   let customerUser = await User.findOne({ email: 'customer@rupakar.com' });
//   if (!customerUser) {
//     customerUser = await User.create({
//       name: 'Ananya Sen',
//       email: 'customer@rupakar.com',
//       password: passwordHash,
//       role: 'customer',
//       isActive: true,
//       emailVerified: true,
//     });
//   }

//   let vendorUser = await User.findOne({ email: 'vendor@rupakar.com' });
//   if (!vendorUser) {
//     vendorUser = await User.create({
//       name: 'Savitri Devi',
//       email: 'vendor@rupakar.com',
//       password: passwordHash,
//       role: 'vendor',
//       isActive: true,
//       emailVerified: true,
//     });
//   }

//   let adminUser = await User.findOne({ email: 'admin@rupakar.com' });
//   if (!adminUser) {
//     adminUser = await User.create({
//       name: 'Rupakar Admin',
//       email: 'admin@rupakar.com',
//       password: passwordHash,
//       role: 'admin',
//       isActive: true,
//       emailVerified: true,
//     });
//   }

//   let vendor = await Vendor.findOne({ ownerUserId: vendorUser._id });
//   if (!vendor) {
//     vendor = await Vendor.create({
//       ownerUserId: vendorUser._id,
//       businessName: 'Bengal Artisan Collective',
//       legalName: 'Bengal Artisan Collective LLP',
//       email: 'artisans@rupakar.com',
//       phone: '+919830012345',
//       address: '14 Potters Lane, Bishnupur, Bankura, West Bengal 722122',
//       originState: 'West Bengal',
//       originDistrict: 'Bankura',
//       status: 'APPROVED',
//       verificationStatus: 'VERIFIED',
//     });
//   }

//   // Categories
//   const categoriesData = [
//     {
//       name: 'Terracotta',
//       slug: 'terracotta',
//       description: 'Ancient hand-thrown terracotta pottery, clay lamps, and sculpted figurines from Bengal and India.',
//       image: '/images/collection-terracotta.jpg',
//       status: 'ACTIVE',
//     },
//     {
//       name: 'Folk Art',
//       slug: 'folk-art',
//       description: 'Hand-painted Pattachitra, Kalighat styles, and traditional Indian folklore paintings on natural canvases.',
//       image: '/images/category-folk-art.jpg',
//       status: 'ACTIVE',
//     },
//     {
//       name: 'Home Decor',
//       slug: 'home-decor',
//       description: 'Timeless ethnic decor pieces, hand-carved terracotta lamps, wall plates, and ornamental artifacts.',
//       image: '/images/collection-decor.jpg',
//       status: 'ACTIVE',
//     },
//     {
//       name: 'Dokra Craft',
//       slug: 'dokra-craft',
//       description: '4,000-year-old non-ferrous lost-wax metal casting handcrafted by tribal artisans of Bengal and Bastar.',
//       image: '/images/category-pottery.jpg',
//       status: 'ACTIVE',
//     },
//     {
//       name: 'Textiles',
//       slug: 'textiles',
//       description: 'Heritage handloom sarees, Kantha embroidered tapestries, and hand-spun organic cotton stoles.',
//       image: '/images/gallery-3.jpg',
//       status: 'ACTIVE',
//     },
//   ];

//   const categoryMap = {};
//   for (const cat of categoriesData) {
//     const doc = await Category.create(cat);
//     categoryMap[cat.slug] = doc;
//   }

//   // Brands
//   const brandsData = [
//     { name: 'Bishnupur Clay Guild', slug: 'bishnupur-clay-guild', status: 'ACTIVE' },
//     { name: 'Mithila Heritage Studio', slug: 'mithila-heritage-studio', status: 'ACTIVE' },
//     { name: 'Raghurajpur Crafts', slug: 'raghurajpur-crafts', status: 'ACTIVE' },
//     { name: 'Bastar Dhokra Collective', slug: 'bastar-dhokra-collective', status: 'ACTIVE' },
//   ];

//   const brandMap = {};
//   for (const b of brandsData) {
//     const doc = await Brand.create(b);
//     brandMap[b.slug] = doc;
//   }

//   // Products Data
//   const productsSeed = [
//     {
//       name: 'Madhubani Terracotta Vase',
//       slug: 'madhubani-terracotta-vase',
//       shortDescription: 'Hand-thrown terracotta vase hand-painted in sacred Mithila folk art motifs.',
//       description: 'A centerpiece of ancient Indian folk art tradition, this hand-thrown terracotta vase is adorned with intricate paintings depicting the mythology and natural harmony of Mithila. Each motif is painted by hand using natural earth pigments and plant dyes.',
//       categorySlug: 'terracotta',
//       brandSlug: 'mithila-heritage-studio',
//       craft: 'Mithila Folk Art',
//       region: 'Mithila, Bihar',
//       artisan: 'Savitri Devi',
//       price: 2499,
//       compareAtPrice: 3200,
//       rating: 4.9,
//       reviews: 128,
//       dimensions: '28cm H × 14cm D',
//       material: '100% natural river clay, organic mineral pigments',
//       care: 'Wipe with soft dry cloth. Keep away from direct water immersion.',
//       badge: 'Best Seller',
//       badgeColor: '#C89B3C',
//       tags: ['terracotta', 'vase', 'madhubani', 'pottery', 'handcrafted', 'decor'],
//       images: ['/images/product-vase.jpg', '/images/collection-terracotta.jpg', '/images/gallery-1.jpg'],
//     },
//     {
//       name: 'Tribal Painted Terracotta Bowl',
//       slug: 'tribal-painted-terracotta-bowl',
//       shortDescription: 'Wheel-thrown bowl decorated with tribal sacred geometric motifs.',
//       description: 'Hand-shaped on traditional wooden potter wheels and painted in tribal traditions, this bowl features sacred nature motifs inspired by ancient Indian folk heritage.',
//       categorySlug: 'terracotta',
//       brandSlug: 'bishnupur-clay-guild',
//       craft: 'Gondi Heritage Art',
//       region: 'Bastar, Madhya Pradesh',
//       artisan: 'Ramu Tekam',
//       price: 1899,
//       compareAtPrice: 2400,
//       rating: 4.8,
//       reviews: 94,
//       dimensions: '12cm H × 22cm D',
//       material: 'Fine terracotta clay, natural earth pigments',
//       care: 'Hand wash gently with cool water. Decorative use recommended.',
//       badge: 'New Arrival',
//       badgeColor: '#6B3E26',
//       tags: ['terracotta', 'bowl', 'tribal', 'pottery', 'decor'],
//       images: ['/images/product-bowl.jpg', '/images/gallery-1.jpg', '/images/category-pottery.jpg'],
//     },
//     {
//       name: 'Dancing Kathak Figurine',
//       slug: 'dancing-kathak-figurine',
//       shortDescription: 'Hand-sculpted terracotta figurine of a classical Kathak dancer frozen in mid-spin.',
//       description: 'A breathtaking hand-sculpted terracotta sculpture capturing the rhythmic dynamism of Indian classical dance. Every fold of the ghagra and delicate mudra of the hands is rendered with astonishing artisan precision.',
//       categorySlug: 'folk-art',
//       brandSlug: 'bishnupur-clay-guild',
//       craft: 'Bishnupur Terracotta Sculpture',
//       region: 'Bishnupur, West Bengal',
//       artisan: 'Ramkumar Prajapati',
//       price: 3499,
//       compareAtPrice: 4500,
//       rating: 5.0,
//       reviews: 57,
//       dimensions: '32cm H × 14cm W',
//       material: 'Kiln-fired alluvial Bankura clay, burnished gold accents',
//       care: 'Dust with soft dry brush. Handle with extreme care.',
//       badge: 'Limited Edition',
//       badgeColor: '#7A1F1F',
//       tags: ['figurine', 'sculpture', 'terracotta', 'folk-art', 'bengal'],
//       images: ['/images/product-figurine.jpg', '/images/artisan-portrait.jpg', '/images/gallery-3.jpg'],
//     },
//     {
//       name: 'Hand-Carved Lattice Diya Lamp',
//       slug: 'hand-carved-lattice-diya-lamp',
//       shortDescription: 'Terracotta oil lamp with intricate lattice work that casts dancing ambient shadows.',
//       description: 'A beautifully pierced terracotta lamp crafted with geometric jali (lattice) patterns. When lit with mustard oil or wax tealights, it casts mesmerizing dancing shadow patterns across your sacred altar or living spaces.',
//       categorySlug: 'home-decor',
//       brandSlug: 'bishnupur-clay-guild',
//       craft: 'Terracotta Lamp Craft',
//       region: 'Khurja & Bankura',
//       artisan: 'Mohanlal Kumhar',
//       price: 999,
//       compareAtPrice: 1399,
//       rating: 4.7,
//       reviews: 213,
//       dimensions: '8cm H × 12cm W',
//       material: '100% natural fire-baked clay',
//       care: 'Suitable for oil and candles. Washable with warm soapy water.',
//       badge: 'Best Seller',
//       badgeColor: '#C89B3C',
//       tags: ['lamp', 'diya', 'decor', 'terracotta', 'sacred'],
//       images: ['/images/product-lamp.jpg', '/images/gallery-3.jpg', '/images/collection-decor.jpg'],
//     },
//     {
//       name: 'Pattachitra Mythological Wall Plate',
//       slug: 'pattachitra-mythological-wall-plate',
//       shortDescription: 'Large terracotta wall plate painted with the Dashavatara narrative in natural stone inks.',
//       description: 'Hand-molded terracotta wall plaque decorated in the classical Pattachitra tradition of eastern India. Depicts the ten avatars of Lord Vishnu framed by ornate floral scrollwork.',
//       categorySlug: 'folk-art',
//       brandSlug: 'raghurajpur-crafts',
//       craft: 'Pattachitra Painting',
//       region: 'Raghurajpur, Odisha',
//       artisan: 'Ananta Mohanty',
//       price: 2199,
//       compareAtPrice: 2800,
//       rating: 4.9,
//       reviews: 76,
//       dimensions: '35cm Diameter',
//       material: 'Sun-baked terracotta, crushed mineral pigments, natural resin glaze',
//       care: 'Wall mounting only. Do not expose to moisture or direct outdoor rain.',
//       badge: 'Featured',
//       badgeColor: '#6B3E26',
//       tags: ['plate', 'wall-plate', 'pattachitra', 'folk-art', 'painting'],
//       images: ['/images/product-plate.jpg', '/images/gallery-2.jpg', '/images/category-folk-art.jpg'],
//     },
//     {
//       name: 'Bankura Terracotta Sacred Horse',
//       slug: 'bankura-terracotta-sacred-horse',
//       shortDescription: 'The globally iconic Bankura horse with erect ears and elongated neck, handcrafted in Panchmura.',
//       description: 'The supreme emblem of Indian handcrafted art, the Bankura Horse is an ancient votive terracotta sculpture from Panchmura village. Hand-modeled on pottery wheels and assembled with symmetrical majesty.',
//       categorySlug: 'terracotta',
//       brandSlug: 'bishnupur-clay-guild',
//       craft: 'Panchmura Terracotta Craft',
//       region: 'Bankura, West Bengal',
//       artisan: 'Biren Kumbhakar',
//       price: 2799,
//       compareAtPrice: 3500,
//       rating: 4.9,
//       reviews: 142,
//       dimensions: '36cm H × 20cm L × 10cm W',
//       material: 'Local riverbed clay, pit-fired in wood kilns',
//       care: 'Indoor decorative piece. Dust regularly with a soft cloth.',
//       badge: 'Heritage Classic',
//       badgeColor: '#C89B3C',
//       tags: ['horse', 'bankura', 'terracotta', 'heritage', 'bengal', 'sculpture'],
//       images: ['/images/hero-artisan.jpg', '/images/collection-terracotta.jpg', '/images/gallery-1.jpg'],
//     },
//     {
//       name: 'Dokra Brass Tribal Musician',
//       slug: 'dokra-brass-tribal-musician',
//       shortDescription: 'Lost-wax cast brass figurine of a Santhal folk percussionist.',
//       description: 'Crafted using the ancient cire-perdue (lost-wax) technique dating back to the Indus Valley Civilization. Each piece is unique as the clay mold is broken after casting.',
//       categorySlug: 'dokra-craft',
//       brandSlug: 'bastar-dhokra-collective',
//       craft: 'Lost-Wax Brass Casting',
//       region: 'Bikna, West Bengal',
//       artisan: 'Shambhu Karmakar',
//       price: 3899,
//       compareAtPrice: 4800,
//       rating: 4.9,
//       reviews: 64,
//       dimensions: '22cm H × 10cm W',
//       material: 'Solid brass and bronze alloy',
//       care: 'Clean with dry cloth or brass polish sparingly for antique patina.',
//       badge: 'Rare Craft',
//       badgeColor: '#7A1F1F',
//       tags: ['dokra', 'brass', 'metal-craft', 'tribal', 'figurine'],
//       images: ['/images/category-pottery.jpg', '/images/gallery-2.jpg', '/images/product-figurine.jpg'],
//     },
//     {
//       name: 'Terracotta Floral Hanging Bell',
//       slug: 'terracotta-floral-hanging-bell',
//       shortDescription: 'Set of 3 resonant clay windchimes with terracotta clappers.',
//       description: 'Handcrafted wind chimes with pierced floral motifs and rustic earthenware bells that chime with a soothing earthy resonance in gentle breezes.',
//       categorySlug: 'home-decor',
//       brandSlug: 'bishnupur-clay-guild',
//       craft: 'Terracotta Bell Weaving',
//       region: 'Bishnupur, West Bengal',
//       artisan: 'Geeta Pal',
//       price: 1299,
//       compareAtPrice: 1700,
//       rating: 4.6,
//       reviews: 88,
//       dimensions: '45cm Total Length',
//       material: 'Terracotta clay, jute cord, wooden beads',
//       care: 'Suitable for covered balconies, patios, and doorways.',
//       badge: 'Trending',
//       badgeColor: '#6B3E26',
//       tags: ['bell', 'windchime', 'decor', 'hanging', 'terracotta'],
//       images: ['/images/collection-decor.jpg', '/images/gallery-3.jpg', '/images/product-lamp.jpg'],
//     },
//   ];

//   for (const item of productsSeed) {
//     const categoryDoc = categoryMap[item.categorySlug] || Object.values(categoryMap)[0];
//     const brandDoc = brandMap[item.brandSlug] || Object.values(brandMap)[0];

//     const product = await Product.create({
//       vendorId: vendor._id,
//       name: item.name,
//       slug: item.slug,
//       shortDescription: item.shortDescription,
//       description: item.description,
//       categoryId: categoryDoc._id,
//       brandId: brandDoc._id,
//       tags: item.tags,
//       attributes: {
//         craft: [item.craft],
//         region: [item.region],
//         artisan: [item.artisan],
//         material: [item.material],
//       },
//       status: 'PUBLISHED',
//       featured: true,
//       publishedAt: new Date(),
//       shipping: {
//         originState: 'West Bengal',
//         originDistrict: 'Bankura',
//         deliveryDays: 5,
//         freeShipping: item.price >= 1500,
//       },
//       tax: {
//         taxable: true,
//         gstIncluded: true,
//       },
//     });

//     // Create Primary Variant
//     const variant = await ProductVariant.create({
//       productId: product._id,
//       sku: `${item.slug.toUpperCase()}-STD`,
//       price: item.price,
//       compareAtPrice: item.compareAtPrice,
//       weight: 1200,
//       status: 'ACTIVE',
//       attributes: {
//         Edition: 'Standard Handcrafted',
//       },
//     });

//     // Create Images
//     const imageDocs = await Promise.all(
//       item.images.map((url, index) =>
//         ProductImage.create({
//           productId: product._id,
//           variantId: variant._id,
//           storageKey: `products/${item.slug}-${index}`,
//           url,
//           altText: `${item.name} image ${index + 1}`,
//           sortOrder: index,
//           isPrimary: index === 0,
//           status: 'ACTIVE',
//         }),
//       ),
//     );

//     product.variants = [variant._id];
//     product.images = imageDocs.map((img) => img._id);
//     await product.save();

//     // Create Active Inventory
//     await Inventory.create({
//       productId: product._id,
//       variantId: variant._id,
//       availableQuantity: 100,
//       reservedQuantity: 0,
//       soldQuantity: 15,
//       lowStockThreshold: 5,
//       status: 'ACTIVE',
//     });

//     console.log(`Seeded: ${item.name} (₹${item.price}) [Stock: 100]`);
//   }

//   console.log('\n--- Seed Complete ---');
//   console.log(`Demo Customer: customer@rupakar.com / Password123!`);
//   console.log(`Demo Vendor: vendor@rupakar.com / Password123!`);
//   console.log(`Demo Admin: admin@rupakar.com / Password123!`);
//   console.log('Total Products Seeded:', productsSeed.length);

//   await mongoose.disconnect();
// }

// seed().catch((err) => {
//   console.error('Seed script failed:', err);
//   process.exit(1);
// });





import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

import { env } from './app/config/env.js';
import { User } from './app/models/user.model.js';
import { Vendor } from './app/models/vendor.model.js';
import { Category } from './app/models/category.model.js';
import { Brand } from './app/models/brand.model.js';
import { Product, ProductImage } from './app/models/product.model.js';
import { ProductVariant } from './app/models/product-variant.model.js';
import { Inventory } from './app/models/inventory.model.js';

dotenv.config();

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
      emailVerified: true,
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

    const mongoUri = (
      process.env.MONGODB_URI ||
      process.env.MONGO_URL ||
      env.MONGODB_URI
    ).trim();

    if (!mongoUri) {
      throw new Error('MongoDB URI is not configured.');
    }

    console.log('\n==========================================');
    console.log('RUPAKAR MOCK PRODUCT SEED');
    console.log('==========================================\n');

    console.log('Connecting to MongoDB...');

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
    });

    console.log('Connected to MongoDB.\n');

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
      | Idempotency
      |--------------------------------------------------------------------------
      |
      | If this exact mock SKU already exists, skip it.
      |
      */

      const existingVariant = await ProductVariant.findOne({
        sku,
      });

      if (existingVariant) {
        console.log(`SKIPPED: ${item.name} (${sku} already exists)`);

        skippedCount += 1;

        continue;
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
    console.log('SEED COMPLETE');
    console.log('==========================================');

    console.log(`Created: ${createdCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Total definitions: ${productsSeed.length}`);

    console.log('\n₹1 TEST PRODUCT');

    const oneRupeeProduct = await ProductVariant.findOne({
      sku: `${MOCK_PREFIX}TEST-PRODUCT-ONE-RUPEE-STD`,
    });

    if (oneRupeeProduct) {
      console.log(`Price: ₹${oneRupeeProduct.price}`);
      console.log(`SKU: ${oneRupeeProduct.sku}`);
      console.log('Status: READY FOR TESTING');
    } else {
      console.log('WARNING: ₹1 product was not found.');
    }

    console.log('\nNo existing products were deleted.');

    console.log('\n==========================================\n');
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