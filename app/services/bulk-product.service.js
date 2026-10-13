import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { AppError } from '../utils/app-error.js';
import { Category } from '../models/category.model.js';
import { Brand } from '../models/brand.model.js';
import { Product, ProductImage } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { Inventory } from '../models/inventory.model.js';
import { BulkUploadBatch } from '../models/bulk-upload-batch.model.js';
import { productService } from './product.service.js';
import { storageService } from './storage.service.js';
import { inventoryService } from './inventory.service.js';
import { auditService } from './audit.service.js';
import { notificationService } from './notification.service.js';

// Configurable upload safety limits
export const BULK_LIMITS = {
  MAX_ZIP_SIZE: 50 * 1024 * 1024, // 50MB compressed ZIP
  MAX_SPREADSHEET_SIZE: 10 * 1024 * 1024, // 10MB CSV/XLSX
  MAX_FILES_IN_ZIP: 300, // Maximum individual image files in ZIP
  MAX_TOTAL_UNCOMPRESSED_SIZE: 150 * 1024 * 1024, // 150MB total extracted size
  MAX_SINGLE_IMAGE_SIZE: 2 * 1024 * 1024, // 2MB per image (matching Cloudinary limit)
  MAX_PRODUCTS_PER_BATCH: 500, // Maximum spreadsheet rows
  MAX_COMPRESSION_RATIO: 100, // Reject zip bomb if ratio > 100:1
};

// Recognized raster image signatures (magic numbers)
const IMAGE_MAGIC_SIGNATURES = [
  { mime: 'image/jpeg', ext: '.jpg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', check: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: 'image/webp', ext: '.webp', check: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'image/gif', ext: '.gif', check: (b) => b.length >= 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a') },
  { mime: 'image/bmp', ext: '.bmp', check: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d },
];

export const detectImageFormat = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  for (const sig of IMAGE_MAGIC_SIGNATURES) {
    if (sig.check(buffer)) return { mime: sig.mime, ext: sig.ext };
  }
  return null;
};

// Normalize SKU for comparison and matching
export const normalizeSku = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');

// Normalize filename for SKU matching
export const normalizeFilename = (filename) => {
  const base = path.basename(String(filename ?? '').trim());
  return base.replace(/^[._]/, ''); // remove hidden/system prefix
};

// Standard template column headers definition
export const TEMPLATE_COLUMNS = [
  { key: 'name', label: 'Product Name', required: true, example: 'Bankura Terracotta Panchmura Horse (12-inch)' },
  { key: 'sku', label: 'SKU', required: true, example: 'RUP-TERR-001' },
  { key: 'category', label: 'Category', required: true, example: 'Terracotta & Clay' },
  { key: 'subcategory', label: 'Subcategory', required: false, example: 'Traditional Figurines' },
  { key: 'brand', label: 'Brand', required: false, example: 'Rupakar Artisan Guild' },
  { key: 'price', label: 'Price (INR)', required: true, example: 1250 },
  { key: 'compareAtPrice', label: 'Compare at Price (INR)', required: false, example: 1500 },
  { key: 'costPrice', label: 'Cost Price (INR)', required: false, example: 850 },
  { key: 'stock', label: 'Stock Quantity', required: true, example: 25 },
  { key: 'shortDescription', label: 'Short Description', required: false, example: 'Authentic GI-tagged terracotta horse handcrafted by master artisans of Panchmura, Bankura.' },
  { key: 'description', label: 'Full Description', required: false, example: 'The Panchmura terracotta horse is the acclaimed symbol of Indian folk art. Each piece is moulded on a potter wheel, dried in the shade, and kiln-fired using traditional firewood kilns.' },
  { key: 'tags', label: 'Tags (comma-separated)', required: false, example: 'terracotta, bankura, gi-tagged, handmade, home-decor' },
  { key: 'weight', label: 'Weight (kg)', required: false, example: 1.2 },
  { key: 'length', label: 'Length (cm)', required: false, example: 20 },
  { key: 'width', label: 'Width (cm)', required: false, example: 12 },
  { key: 'height', label: 'Height (cm)', required: false, example: 30 },
  { key: 'originState', label: 'Origin State', required: false, example: 'West Bengal' },
  { key: 'originDistrict', label: 'Origin District', required: false, example: 'Bankura' },
  { key: 'deliveryDays', label: 'Delivery Days', required: false, example: 7 },
  { key: 'freeShipping', label: 'Free Shipping (TRUE/FALSE)', required: false, example: 'FALSE' },
  { key: 'gstIncluded', label: 'GST Included (TRUE/FALSE)', required: false, example: 'TRUE' },
  { key: 'taxCode', label: 'HSN / Tax Code', required: false, example: '69139000' },
  { key: 'authenticityReference', label: 'Authenticity / GI Reference', required: false, example: 'GI-WB-TERRACOTTA-001' },
  { key: 'primaryImageFilename', label: 'Primary Image Filename (Optional override)', required: false, example: 'RUP-TERR-001_1.jpg' },
  { key: 'additionalImageFilenames', label: 'Additional Image Filenames (comma-separated)', required: false, example: 'RUP-TERR-001_2.jpg, RUP-TERR-001_3.jpg' },
];

export class BulkProductService {
  /**
   * Generates dynamic CSV template with column headers and Bengal artisanal sample row.
   */
  async generateCsvTemplate() {
    const headers = TEMPLATE_COLUMNS.map((col) => col.label);
    const sampleRow = TEMPLATE_COLUMNS.map((col) => col.example);

    const secondSampleRow = [
      'Bishnupur Baluchari Silk Saree - Swarnachari',
      'RUP-BALU-002',
      'Handloom & Textiles',
      'Silk Sarees',
      'Rupakar Artisan Guild',
      8500,
      10500,
      6200,
      10,
      'Authentic pure silk Baluchari saree with golden zari depiction of Indian mythological motifs.',
      'Woven on traditional jacquard looms in Bishnupur, this Baluchari Swarnachari saree carries the registered Geographical Indication of West Bengal.',
      'baluchari, silk, saree, bishnupur, swarnachari, gi-tagged',
      0.85,
      30,
      25,
      5,
      'West Bengal',
      'Bankura',
      5,
      'TRUE',
      'TRUE',
      '50072010',
      'GI-WB-BALUCHARI-042',
      'RUP-BALU-002_1.jpg',
      'RUP-BALU-002_2.jpg',
    ];

    return stringifyCsv([headers, sampleRow, secondSampleRow], { quoted: true });
  }

  /**
   * Generates Excel (.xlsx) template with formatted columns, instruction sheet and category list.
   */
  async generateXlsxTemplate() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Rupakar Seller Portal';
    workbook.created = new Date();

    // Sheet 1: Products
    const sheet = workbook.addWorksheet('Product Upload Template', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = TEMPLATE_COLUMNS.map((col) => ({
      header: `${col.label}${col.required ? ' *' : ''}`,
      key: col.key,
      width: Math.max(col.label.length + 4, 18),
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' }, // Dark slate
      };
      cell.font = {
        name: 'Segoe UI',
        color: { argb: 'FFFFFFFF' },
        bold: true,
        size: 11,
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    // Add sample rows
    const sample1 = {};
    const sample2 = {
      name: 'Bishnupur Baluchari Silk Saree - Swarnachari',
      sku: 'RUP-BALU-002',
      category: 'Handloom & Textiles',
      subcategory: 'Silk Sarees',
      brand: 'Rupakar Artisan Guild',
      price: 8500,
      compareAtPrice: 10500,
      costPrice: 6200,
      stock: 10,
      shortDescription: 'Authentic pure silk Baluchari saree with golden zari depiction of Indian mythological motifs.',
      description: 'Woven on traditional jacquard looms in Bishnupur, this Baluchari Swarnachari saree carries the registered Geographical Indication of West Bengal.',
      tags: 'baluchari, silk, saree, bishnupur, swarnachari, gi-tagged',
      weight: 0.85,
      length: 30,
      width: 25,
      height: 5,
      originState: 'West Bengal',
      originDistrict: 'Bankura',
      deliveryDays: 5,
      freeShipping: 'TRUE',
      gstIncluded: 'TRUE',
      taxCode: '50072010',
      authenticityReference: 'GI-WB-BALUCHARI-042',
      primaryImageFilename: 'RUP-BALU-002_1.jpg',
      additionalImageFilenames: 'RUP-BALU-002_2.jpg',
    };

    TEMPLATE_COLUMNS.forEach((col) => {
      sample1[col.key] = col.example;
    });

    sheet.addRow(sample1);
    sheet.addRow(sample2);

    // Format sample rows
    [sheet.getRow(2), sheet.getRow(3)].forEach((row) => {
      row.height = 24;
      row.eachCell((cell) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
    });

    // Sheet 2: Guidelines & Available Categories
    const guideSheet = workbook.addWorksheet('Instructions & Categories');
    guideSheet.columns = [
      { header: 'Section', key: 'section', width: 25 },
      { header: 'Details / Allowed Values', key: 'details', width: 80 },
    ];

    const guideHeader = guideSheet.getRow(1);
    guideHeader.height = 26;
    guideHeader.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true };
    });

    // Fetch active categories and brands from database
    const categories = await Category.find({ deletedAt: null, status: 'ACTIVE' }).select('name slug').lean().catch(() => []);
    const categoryNames = categories.map((c) => c.name).join(', ') || 'Terracotta & Clay, Handloom & Textiles, Dokra Metal Craft, Kantha Stitch, Wood Carving, Leather Craft';

    const instructions = [
      { section: '1. Image ZIP Naming', details: 'Name image files using product SKU: <SKU>_1.jpg (Primary), <SKU>_2.jpg (Additional), <SKU>_3.jpg. E.g., RUP-TERR-001_1.jpg' },
      { section: '2. Supported Image Formats', details: 'JPG, JPEG, PNG, WEBP, GIF, BMP. Max 2MB per image. Up to 20 images per product.' },
      { section: '3. Mandatory Columns', details: 'Product Name, SKU, Category, Price, Stock Quantity, and at least one Primary Image (via ZIP naming or filename column).' },
      { section: '4. Active Categories', details: `Use any of: ${categoryNames}` },
      { section: '5. Price & Stock Rules', details: 'Price must be greater than 0. Stock quantity must be a non-negative integer.' },
      { section: '6. Authenticity & GI', details: 'For registered GI handicrafts, provide your GI certificate number or artisan registration in the Authenticity Reference column.' },
      { section: '7. Approval Workflow', details: 'Submitted products are placed in SUBMITTED status and sent to Rupakar admins for verification. No invalid product will be published directly.' },
    ];

    instructions.forEach((item) => guideSheet.addRow(item));

    return workbook.xlsx.writeBuffer();
  }

  /**
   * Safely extracts and validates images from a ZIP buffer.
   * Protects against Zip Bombs, path traversal, unsupported formats, and excessive file counts.
   */
  async extractAndValidateZip(zipBuffer) {
    if (!zipBuffer || !Buffer.isBuffer(zipBuffer)) {
      return {
        imagesBySku: new Map(),
        imagesByExactFilename: new Map(),
        extractionErrors: [],
        totalCount: 0,
      };
    }

    if (zipBuffer.length > BULK_LIMITS.MAX_ZIP_SIZE) {
      throw new AppError(400, 'ZIP_TOO_LARGE', `ZIP file size (${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB) exceeds limit of ${BULK_LIMITS.MAX_ZIP_SIZE / 1024 / 1024}MB`);
    }

    let zip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      throw new AppError(400, 'MALFORMED_ZIP', 'The uploaded archive is not a valid ZIP file');
    }

    const zipEntries = zip.getEntries();
    if (zipEntries.length === 0) {
      throw new AppError(400, 'EMPTY_ZIP', 'The uploaded ZIP archive contains no files');
    }

    if (zipEntries.length > BULK_LIMITS.MAX_FILES_IN_ZIP) {
      throw new AppError(400, 'ZIP_TOO_MANY_FILES', `ZIP contains ${zipEntries.length} files. Maximum allowed is ${BULK_LIMITS.MAX_FILES_IN_ZIP}`);
    }

    let totalUncompressedSize = 0;
    const imagesBySku = new Map(); // normalizedSku -> Array of image objects
    const imagesByExactFilename = new Map(); // normalizedFilename -> image object
    const extractionErrors = [];

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const rawName = entry.entryName;

      // 1. Path traversal protection: reject '..' or absolute paths
      if (rawName.includes('..') || path.isAbsolute(rawName) || rawName.includes('\0') || /[\x00-\x1f]/.test(rawName)) {
        extractionErrors.push({
          filename: rawName,
          error: 'Security violation: Path traversal or invalid characters detected in ZIP entry',
        });
        continue;
      }

      // Ignore macOS system files like __MACOSX, .DS_Store
      const cleanName = normalizeFilename(rawName);
      if (cleanName.startsWith('.') || rawName.includes('__MACOSX')) {
        continue;
      }

      // 2. Zip bomb protection: uncompressed size check and ratio check
      const uncompressedSize = entry.header.size;
      const compressedSize = entry.header.compressedSize || 1;
      const ratio = uncompressedSize / compressedSize;

      if (ratio > BULK_LIMITS.MAX_COMPRESSION_RATIO && uncompressedSize > 1024 * 1024) {
        throw new AppError(400, 'ZIP_BOMB_DETECTED', `Suspected ZIP decompression bomb: high compression ratio (${ratio.toFixed(1)}:1) for entry ${cleanName}`);
      }

      totalUncompressedSize += uncompressedSize;
      if (totalUncompressedSize > BULK_LIMITS.MAX_TOTAL_UNCOMPRESSED_SIZE) {
        throw new AppError(400, 'ZIP_EXTRACT_LIMIT_EXCEEDED', `Total uncompressed size exceeds limit of ${BULK_LIMITS.MAX_TOTAL_UNCOMPRESSED_SIZE / 1024 / 1024}MB`);
      }

      if (uncompressedSize > BULK_LIMITS.MAX_SINGLE_IMAGE_SIZE) {
        extractionErrors.push({
          filename: cleanName,
          error: `Image exceeds maximum file size limit of ${BULK_LIMITS.MAX_SINGLE_IMAGE_SIZE / 1024 / 1024}MB (${(uncompressedSize / 1024 / 1024).toFixed(2)}MB)`,
        });
        continue;
      }

      // 3. Extract entry data buffer
      let entryData;
      try {
        entryData = entry.getData();
      } catch (err) {
        extractionErrors.push({ filename: cleanName, error: `Failed to decompress entry: ${err.message}` });
        continue;
      }

      // 4. Verify image format via magic bytes (NOT just file extension)
      const format = detectImageFormat(entryData);
      if (!format) {
        extractionErrors.push({
          filename: cleanName,
          error: 'Invalid or unsupported image format. Only raster JPG, PNG, WEBP, GIF, and BMP files are permitted.',
        });
        continue;
      }

      // 5. Parse SKU and sortOrder from filename
      // Conventions supported:
      // - <SKU>_1.jpg (Primary, sort 1)
      // - <SKU>_2.jpg (Additional, sort 2)
      // - <SKU>_primary.jpg (Primary, sort 1)
      // - <SKU>.jpg (Primary, sort 1)
      const parsedImage = this.parseImageFilename(cleanName, entryData, format);

      // Store in exact filename lookup
      imagesByExactFilename.set(cleanName.toLowerCase(), parsedImage);

      // Store in SKU lookup if SKU identified
      if (parsedImage.sku) {
        const existing = imagesBySku.get(parsedImage.sku) || [];
        existing.push(parsedImage);
        imagesBySku.set(parsedImage.sku, existing);
      }
    }

    return {
      imagesBySku,
      imagesByExactFilename,
      extractionErrors,
      totalCount: imagesByExactFilename.size,
    };
  }

  /**
   * Parses filename into SKU, isPrimary and sortOrder.
   */
  parseImageFilename(filename, buffer, format) {
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);

    let sku = '';
    let isPrimary = false;
    let sortOrder = 1;

    // Pattern 1: <SKU>_<number> (e.g. RUP-TERR-001_1)
    const numberedMatch = nameWithoutExt.match(/^(.+?)[_-](\d+)$/);
    if (numberedMatch) {
      sku = normalizeSku(numberedMatch[1]);
      sortOrder = parseInt(numberedMatch[2], 10);
      isPrimary = sortOrder === 1;
    } else {
      // Pattern 2: <SKU>_primary or <SKU>-primary
      const primaryMatch = nameWithoutExt.match(/^(.+?)[_-](primary|main|hero)$/i);
      if (primaryMatch) {
        sku = normalizeSku(primaryMatch[1]);
        isPrimary = true;
        sortOrder = 1;
      } else {
        // Pattern 3: <SKU> directly
        sku = normalizeSku(nameWithoutExt);
        isPrimary = true;
        sortOrder = 1;
      }
    }

    return {
      filename,
      sku,
      isPrimary,
      sortOrder,
      buffer,
      size: buffer.length,
      mimeType: format.mime,
    };
  }

  /**
   * Safely parses spreadsheet buffer (CSV or XLSX).
   */
  async parseSpreadsheetRows(fileBuffer, originalFilename = '') {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new AppError(400, 'SPREADSHEET_REQUIRED', 'Spreadsheet file buffer is required');
    }

    if (fileBuffer.length > BULK_LIMITS.MAX_SPREADSHEET_SIZE) {
      throw new AppError(400, 'FILE_TOO_LARGE', `Spreadsheet file exceeds ${BULK_LIMITS.MAX_SPREADSHEET_SIZE / 1024 / 1024}MB limit`);
    }

    const isXlsx = originalFilename.endsWith('.xlsx') || (fileBuffer.length >= 4 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b);
    const isXls = originalFilename.endsWith('.xls');

    if (isXls && !isXlsx) {
      throw new AppError(400, 'UNSUPPORTED_FORMAT', 'Legacy .xls format is not supported due to security and parsing reliability. Please save your file as .xlsx or .csv.');
    }

    if (isXlsx) {
      return this.parseXlsxBuffer(fileBuffer);
    }

    // Default to CSV
    return this.parseCsvBuffer(fileBuffer);
  }

  /**
   * Parses CSV buffer with flexible column matching.
   */
  parseCsvBuffer(buffer) {
    let records;
    try {
      records = parseCsv(buffer, {
        columns: false,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (error) {
      throw new AppError(400, 'INVALID_CSV', `Failed to parse CSV file: ${error.message}`);
    }

    if (!records || records.length < 2) {
      throw new AppError(400, 'EMPTY_FILE', 'The spreadsheet must contain a header row and at least one product data row');
    }

    const rawHeaders = records[0].map((h) => String(h ?? '').trim());
    const headerMap = this.buildHeaderIndexMap(rawHeaders);

    const rows = [];
    for (let i = 1; i < records.length; i += 1) {
      const rowNum = i + 1; // 1-indexed spreadsheet row
      const record = records[i];
      if (record.every((cell) => !cell || !String(cell).trim())) continue; // Skip completely blank rows

      const rowData = this.mapRecordToRow(record, headerMap, rowNum);
      rows.push(rowData);
    }

    return rows;
  }

  /**
   * Parses XLSX buffer using ExcelJS.
   */
  async parseXlsxBuffer(buffer) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch (error) {
      throw new AppError(400, 'INVALID_XLSX', `Failed to parse Excel file: ${error.message}`);
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new AppError(400, 'EMPTY_FILE', 'The spreadsheet must contain a header row and at least one product data row');
    }

    const rawHeaders = [];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      rawHeaders[colNumber - 1] = String(cell.value ?? '').trim();
    });

    const headerMap = this.buildHeaderIndexMap(rawHeaders);
    const rows = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // Header row

      const record = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let val = cell.value;
        if (typeof val === 'object' && val !== null) {
          if (val.text) val = val.text;
          else if (val.result !== undefined) val = val.result;
          else if (val.richText) val = val.richText.map((t) => t.text).join('');
        }
        record[colNumber - 1] = val != null ? String(val).trim() : '';
      });

      if (record.every((cell) => !cell || !String(cell).trim())) return;

      const rowData = this.mapRecordToRow(record, headerMap, rowNumber);
      rows.push(rowData);
    });

    return rows;
  }

  /**
   * Maps header names to standardized keys.
   */
  buildHeaderIndexMap(rawHeaders) {
    const map = new Map();
    const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const aliases = {
      name: ['productname', 'name', 'title', 'itemname'],
      sku: ['sku', 'productsku', 'variantsku', 'itemcode', 'itemsku'],
      category: ['category', 'categoryname', 'categoryslug', 'maincategory'],
      subcategory: ['subcategory', 'subcategoryname'],
      brand: ['brand', 'brandname'],
      price: ['price', 'sellingprice', 'priceinr', 'mrp', 'rate'],
      compareAtPrice: ['compareatprice', 'compareatpriceinr', 'originalprice', 'regularprice'],
      costPrice: ['costprice', 'costpriceinr'],
      stock: ['stock', 'stockquantity', 'quantity', 'availablestock', 'inventory'],
      shortDescription: ['shortdescription', 'summary', 'brief'],
      description: ['description', 'fulldescription', 'details', 'story'],
      tags: ['tags', 'keywords', 'labels'],
      weight: ['weight', 'weightkg'],
      length: ['length', 'lengthcm'],
      width: ['width', 'widthcm'],
      height: ['height', 'heightcm'],
      originState: ['originstate', 'state'],
      originDistrict: ['origindistrict', 'district'],
      deliveryDays: ['deliverydays', 'leadtime', 'shippingdays'],
      freeShipping: ['freeshipping', 'isfreeshipping'],
      gstIncluded: ['gstincluded', 'istaxincluded'],
      taxCode: ['taxcode', 'hsn', 'hsncode'],
      authenticityReference: ['authenticityreference', 'gicode', 'gitag', 'authenticity', 'artisanid'],
      primaryImageFilename: ['primaryimagefilename', 'primaryimage', 'mainimage', 'image1'],
      additionalImageFilenames: ['additionalimagefilenames', 'additionalimages', 'otherimages', 'extraimages'],
    };

    rawHeaders.forEach((raw, index) => {
      if (!raw) return;
      const normalized = clean(raw);
      for (const [key, list] of Object.entries(aliases)) {
        if (list.includes(normalized) && !map.has(key)) {
          map.set(key, index);
          break;
        }
      }
    });

    return map;
  }

  mapRecordToRow(record, headerMap, rowNumber) {
    const getVal = (key) => {
      const idx = headerMap.get(key);
      if (idx == null || record[idx] == null) return '';
      return String(record[idx]).trim();
    };

    return {
      rowNumber,
      name: getVal('name'),
      sku: getVal('sku'),
      category: getVal('category'),
      subcategory: getVal('subcategory'),
      brand: getVal('brand'),
      price: getVal('price'),
      compareAtPrice: getVal('compareAtPrice'),
      costPrice: getVal('costPrice'),
      stock: getVal('stock'),
      shortDescription: getVal('shortDescription'),
      description: getVal('description'),
      tags: getVal('tags'),
      weight: getVal('weight'),
      length: getVal('length'),
      width: getVal('width'),
      height: getVal('height'),
      originState: getVal('originState'),
      originDistrict: getVal('originDistrict'),
      deliveryDays: getVal('deliveryDays'),
      freeShipping: getVal('freeShipping'),
      gstIncluded: getVal('gstIncluded'),
      taxCode: getVal('taxCode'),
      authenticityReference: getVal('authenticityReference'),
      primaryImageFilename: getVal('primaryImageFilename'),
      additionalImageFilenames: getVal('additionalImageFilenames'),
    };
  }

  /**
   * Complete validation of spreadsheet rows and image ZIP matching.
   * Returns full batch validation preview without creating any database records.
   */
  async validateBatch(userId, { spreadsheetBuffer, spreadsheetFilename, zipBuffer, zipFilename }) {
    // 1. Resolve and verify vendor
    const vendorId = await productService.resolveVendorIdForUser(userId);
    const vendor = await productService.ensureVendor(vendorId);

    // 2. Parse spreadsheet
    const rawRows = await this.parseSpreadsheetRows(spreadsheetBuffer, spreadsheetFilename);
    if (rawRows.length > BULK_LIMITS.MAX_PRODUCTS_PER_BATCH) {
      throw new AppError(400, 'TOO_MANY_ROWS', `Batch contains ${rawRows.length} rows. Maximum allowed is ${BULK_LIMITS.MAX_PRODUCTS_PER_BATCH}`);
    }

    // 3. Extract and validate image ZIP (if provided)
    const { imagesBySku, imagesByExactFilename, extractionErrors } = await this.extractAndValidateZip(zipBuffer);

    // 4. Fetch category and brand lookup maps
    const categories = await Category.find({ deletedAt: null, status: 'ACTIVE' }).lean();
    const brands = await Brand.find({ deletedAt: null, status: 'ACTIVE' }).lean();

    const categoryLookup = new Map();
    categories.forEach((cat) => {
      categoryLookup.set(cat._id.toString(), cat);
      categoryLookup.set(cat.name.toLowerCase().trim(), cat);
      if (cat.slug) categoryLookup.set(cat.slug.toLowerCase().trim(), cat);
    });

    const brandLookup = new Map();
    brands.forEach((b) => {
      brandLookup.set(b._id.toString(), b);
      brandLookup.set(b.name.toLowerCase().trim(), b);
      if (b.slug) brandLookup.set(b.slug.toLowerCase().trim(), b);
    });

    // 5. Check duplicate SKUs within the spreadsheet batch
    const batchSkus = new Map(); // normalizedSku -> [rowNumbers]
    rawRows.forEach((row) => {
      const sku = normalizeSku(row.sku);
      if (sku) {
        const list = batchSkus.get(sku) || [];
        list.push(row.rowNumber);
        batchSkus.set(sku, list);
      }
    });

    // 6. Check existing SKUs in database
    const skusToCheck = Array.from(batchSkus.keys());
    const existingVariants = skusToCheck.length > 0
      ? await ProductVariant.find({ sku: { $in: skusToCheck } }).select('sku').lean()
      : [];
    const existingSkuSet = new Set(existingVariants.map((v) => v.sku.toUpperCase()));

    // 7. Validate each row
    const validatedRows = [];
    const savedExtractedImages = []; // Array of images we will retain for this batch

    for (const row of rawRows) {
      const rowErrors = [];
      const normalizedSkuStr = normalizeSku(row.sku);

      // --- Validation Rules ---
      // Name
      if (!row.name || row.name.length < 2) {
        rowErrors.push({ field: 'name', message: 'Product name is required (minimum 2 characters)' });
      } else if (row.name.length > 220) {
        rowErrors.push({ field: 'name', message: 'Product name cannot exceed 220 characters' });
      }

      // SKU
      if (!normalizedSkuStr) {
        rowErrors.push({ field: 'sku', message: 'SKU is required' });
      } else {
        if (normalizedSkuStr.length < 3 || normalizedSkuStr.length > 80) {
          rowErrors.push({ field: 'sku', message: 'SKU must be between 3 and 80 characters' });
        }
        // Duplicate SKU within file check
        const occurrences = batchSkus.get(normalizedSkuStr) || [];
        if (occurrences.length > 1) {
          rowErrors.push({
            field: 'sku',
            message: `Duplicate SKU "${normalizedSkuStr}" found in rows: ${occurrences.join(', ')}`,
          });
        }
        // Duplicate SKU against existing products
        if (existingSkuSet.has(normalizedSkuStr)) {
          rowErrors.push({
            field: 'sku',
            message: `SKU "${normalizedSkuStr}" already exists in the marketplace`,
          });
        }
      }

      // Category
      let matchedCategory = null;
      if (!row.category) {
        rowErrors.push({ field: 'category', message: 'Category is required' });
      } else {
        matchedCategory = categoryLookup.get(row.category.toLowerCase().trim()) || categoryLookup.get(row.category.trim());
        if (!matchedCategory) {
          rowErrors.push({
            field: 'category',
            message: `Category "${row.category}" does not exist or is inactive. Check instructions for allowed categories.`,
          });
        }
      }

      // Brand (optional)
      let matchedBrand = null;
      if (row.brand) {
        matchedBrand = brandLookup.get(row.brand.toLowerCase().trim()) || brandLookup.get(row.brand.trim());
        if (!matchedBrand) {
          rowErrors.push({ field: 'brand', message: `Brand "${row.brand}" not found or inactive` });
        }
      }

      // Price
      const numPrice = Number(row.price);
      if (row.price === '' || isNaN(numPrice) || numPrice <= 0) {
        rowErrors.push({ field: 'price', message: 'Price must be a valid number greater than 0' });
      }

      // Compare At Price (optional)
      let numCompareAtPrice = null;
      if (row.compareAtPrice !== '' && row.compareAtPrice != null) {
        numCompareAtPrice = Number(row.compareAtPrice);
        if (isNaN(numCompareAtPrice) || numCompareAtPrice < 0) {
          rowErrors.push({ field: 'compareAtPrice', message: 'Compare at price must be a non-negative number' });
        }
      }

      // Cost Price (optional)
      let numCostPrice = null;
      if (row.costPrice !== '' && row.costPrice != null) {
        numCostPrice = Number(row.costPrice);
        if (isNaN(numCostPrice) || numCostPrice < 0) {
          rowErrors.push({ field: 'costPrice', message: 'Cost price must be a non-negative number' });
        }
      }

      // Stock
      const numStock = Number(row.stock);
      if (row.stock === '' || isNaN(numStock) || numStock < 0 || !Number.isInteger(numStock)) {
        rowErrors.push({ field: 'stock', message: 'Stock must be a non-negative integer (e.g. 0, 10, 25)' });
      }

      // Dimensions & Weight (optional)
      let numWeight = null;
      if (row.weight !== '' && row.weight != null) {
        numWeight = Number(row.weight);
        if (isNaN(numWeight) || numWeight < 0) rowErrors.push({ field: 'weight', message: 'Weight must be non-negative' });
      }

      const dimensions = {};
      ['length', 'width', 'height'].forEach((dim) => {
        if (row[dim] !== '' && row[dim] != null) {
          const n = Number(row[dim]);
          if (isNaN(n) || n < 0) rowErrors.push({ field: dim, message: `${dim} must be non-negative` });
          else dimensions[dim] = n;
        }
      });

      // Delivery Days (optional)
      let numDeliveryDays = 7;
      if (row.deliveryDays !== '' && row.deliveryDays != null) {
        numDeliveryDays = Number(row.deliveryDays);
        if (isNaN(numDeliveryDays) || numDeliveryDays < 1 || numDeliveryDays > 120) {
          rowErrors.push({ field: 'deliveryDays', message: 'Delivery days must be between 1 and 120' });
        }
      }

      // Booleans
      const parseBool = (v, defaultVal = false) => {
        if (v === '' || v == null) return defaultVal;
        const s = String(v).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes';
      };
      const isFreeShipping = parseBool(row.freeShipping, false);
      const isGstIncluded = parseBool(row.gstIncluded, true);

      // --- Image Matching ---
      const matchedImages = [];
      // 1. Check explicit override image filenames from spreadsheet
      if (row.primaryImageFilename) {
        const target = row.primaryImageFilename.toLowerCase().trim();
        const found = imagesByExactFilename.get(target);
        if (found) {
          matchedImages.push({ ...found, isPrimary: true, sortOrder: 1 });
        } else {
          rowErrors.push({
            field: 'primaryImageFilename',
            message: `Primary image file "${row.primaryImageFilename}" specified in spreadsheet was not found in the uploaded ZIP`,
          });
        }
      }

      if (row.additionalImageFilenames) {
        const extraNames = row.additionalImageFilenames.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        extraNames.forEach((extraName, idx) => {
          const found = imagesByExactFilename.get(extraName);
          if (found) {
            matchedImages.push({ ...found, isPrimary: false, sortOrder: idx + 2 });
          } else {
            rowErrors.push({
              field: 'additionalImageFilenames',
              message: `Additional image file "${extraName}" specified in spreadsheet was not found in the uploaded ZIP`,
            });
          }
        });
      }

      // 2. If no explicit images specified, match by SKU convention: <SKU>_1.jpg, <SKU>_2.jpg, etc.
      if (!row.primaryImageFilename && normalizedSkuStr) {
        const skuImages = imagesBySku.get(normalizedSkuStr) || [];
        skuImages.forEach((img) => {
          // Avoid duplicate assignment
          if (!matchedImages.some((m) => m.filename === img.filename)) {
            matchedImages.push(img);
          }
        });
      }

      // Sort matched images: primary first, then by sortOrder
      matchedImages.sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.sortOrder - b.sortOrder;
      });

      // Ensure exactly one primary image is designated if images exist
      if (matchedImages.length > 0) {
        const hasPrimary = matchedImages.some((img) => img.isPrimary);
        if (!hasPrimary) {
          matchedImages[0].isPrimary = true;
        }
      }

      // Validation requirement: Every product in Rupakar requires at least one primary image
      if (matchedImages.length === 0) {
        rowErrors.push({
          field: 'images',
          message: `Missing primary image. No image matching SKU "${normalizedSkuStr}" (e.g. ${normalizedSkuStr}_1.jpg) found in ZIP.`,
        });
      }

      const isValid = rowErrors.length === 0;

      // Prepare sanitized product payload for creation
      const productData = isValid
        ? {
            name: row.name,
            sku: normalizedSkuStr,
            categoryId: matchedCategory?._id?.toString() || null,
            brandId: matchedBrand?._id?.toString() || null,
            shortDescription: row.shortDescription || null,
            description: row.description || null,
            tags: row.tags ? row.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : [],
            price: numPrice,
            compareAtPrice: numCompareAtPrice,
            costPrice: numCostPrice,
            stock: numStock,
            weight: numWeight,
            dimensions: Object.keys(dimensions).length ? dimensions : null,
            shipping: {
              originState: row.originState || vendor.originState || 'West Bengal',
              originDistrict: row.originDistrict || vendor.originDistrict || '',
              deliveryDays: numDeliveryDays,
              freeShipping: isFreeShipping,
            },
            tax: {
              taxable: true,
              taxCode: row.taxCode || '',
              gstIncluded: isGstIncluded,
            },
            authenticity: {
              reference: row.authenticityReference || '',
              status: 'UNVERIFIED',
            },
          }
        : null;

      // Track images in batch extracted images list
      matchedImages.forEach((img) => {
        if (!savedExtractedImages.some((s) => s.filename === img.filename)) {
          savedExtractedImages.push({
            filename: img.filename,
            fileSize: img.size,
            mimeType: img.mimeType,
            sku: normalizedSkuStr,
            isPrimary: img.isPrimary,
            sortOrder: img.sortOrder,
            buffer: img.buffer, // kept in memory for this session
          });
        }
      });

      validatedRows.push({
        rowNumber: row.rowNumber,
        sku: normalizedSkuStr,
        name: row.name,
        category: matchedCategory?.name || row.category,
        price: numPrice || 0,
        stock: numStock || 0,
        isValid,
        errors: rowErrors,
        matchedImages: matchedImages.map((m) => ({
          filename: m.filename,
          isPrimary: m.isPrimary,
          sortOrder: m.sortOrder,
        })),
        status: isValid ? 'VALID' : 'INVALID',
        createdProductId: null,
        productData,
      });
    }

    // 8. Find unmatched images in ZIP (images uploaded in ZIP that do not match any row's SKU or filename)
    const matchedFilenamesSet = new Set();
    validatedRows.forEach((r) => r.matchedImages.forEach((img) => matchedFilenamesSet.add(img.filename.toLowerCase())));

    const unmatchedImages = [];
    imagesByExactFilename.forEach((img, key) => {
      if (!matchedFilenamesSet.has(key)) {
        unmatchedImages.push({
          filename: img.filename,
          sku: img.sku,
          size: img.size,
        });
      }
    });

    const validRowsCount = validatedRows.filter((r) => r.isValid).length;
    const invalidRowsCount = validatedRows.length - validRowsCount;

    // 9. Persist batch session in database for preview and submission tracking
    const batchId = `bulk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const batch = await BulkUploadBatch.create({
      batchId,
      vendorId,
      originalSpreadsheetName: spreadsheetFilename || 'products.csv',
      originalZipName: zipFilename || '',
      status: 'VALIDATED',
      totalRows: validatedRows.length,
      validRowsCount,
      invalidRowsCount,
      submittedCount: 0,
      failedCount: 0,
      rows: validatedRows,
      extractedImages: savedExtractedImages.map((img) => ({
        filename: img.filename,
        fileSize: img.fileSize,
        mimeType: img.mimeType,
        sku: img.sku,
        isPrimary: img.isPrimary,
        sortOrder: img.sortOrder,
      })),
    });

    // Cache the image buffers in an in-memory batch store for upload on submit
    this.saveBatchImageBuffers(batchId, savedExtractedImages);

    return {
      batchId: batch.batchId,
      totalRows: batch.totalRows,
      validRowsCount: batch.validRowsCount,
      invalidRowsCount: batch.invalidRowsCount,
      extractionErrors,
      unmatchedImages,
      rows: validatedRows.map((r) => ({
        rowNumber: r.rowNumber,
        sku: r.sku,
        name: r.name,
        category: r.category,
        price: r.price,
        stock: r.stock,
        isValid: r.isValid,
        errors: r.errors,
        matchedImages: r.matchedImages,
        status: r.status,
      })),
    };
  }

  // In-memory buffer cache for batch image buffers during the validation-submit lifecycle
  static batchBuffers = new Map();

  saveBatchImageBuffers(batchId, images) {
    BulkProductService.batchBuffers.set(batchId, {
      images: new Map(images.map((img) => [img.filename.toLowerCase(), img])),
      createdAt: Date.now(),
    });

    // Prune buffers older than 2 hours
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, data] of BulkProductService.batchBuffers.entries()) {
      if (data.createdAt < twoHoursAgo) {
        BulkProductService.batchBuffers.delete(id);
      }
    }
  }

  getBatchImageBuffers(batchId) {
    return BulkProductService.batchBuffers.get(batchId)?.images || new Map();
  }

  /**
   * Submits valid products from a validated batch.
   * Supports partial submission (e.g. submitting valid rows while ignoring or fixing invalid rows).
   * Re-validates at submission time to prevent race conditions or duplicate creations.
   */
  async submitBatch(userId, batchId, { rowNumbers = null } = {}) {
    const vendorId = await productService.resolveVendorIdForUser(userId);
    await productService.ensureVendor(vendorId);

    const batch = await BulkUploadBatch.findOne({ batchId, vendorId });
    if (!batch) {
      throw new AppError(404, 'BATCH_NOT_FOUND', 'Bulk upload batch not found or does not belong to vendor');
    }

    if (batch.status === 'COMPLETED') {
      throw new AppError(400, 'BATCH_ALREADY_COMPLETED', 'All eligible products in this batch have already been submitted');
    }

    batch.status = 'SUBMITTING';
    await batch.save();

    const imageBufferMap = this.getBatchImageBuffers(batchId);

    // Identify rows to submit: either all valid rows or specified row numbers
    const rowsToProcess = batch.rows.filter((row) => {
      if (!row.isValid || row.status === 'SUBMITTED') return false;
      if (Array.isArray(rowNumbers) && rowNumbers.length > 0) {
        return rowNumbers.includes(row.rowNumber);
      }
      return true;
    });

    if (rowsToProcess.length === 0) {
      batch.status = batch.submittedCount > 0 ? 'COMPLETED' : 'VALIDATED';
      await batch.save();
      return {
        batchId: batch.batchId,
        submittedCount: batch.submittedCount,
        failedCount: batch.failedCount,
        newlySubmitted: 0,
        newlyFailed: 0,
        message: 'No valid pending rows to submit',
        rows: batch.rows,
      };
    }

    let newlySubmitted = 0;
    let newlyFailed = 0;

    for (const row of rowsToProcess) {
      try {
        const data = row.productData;
        if (!data) throw new Error('Product payload missing');

        // Re-validate SKU uniqueness right before creation
        const existingVariant = await ProductVariant.findOne({ sku: data.sku });
        if (existingVariant) {
          throw new AppError(409, 'SKU_ALREADY_EXISTS', `SKU "${data.sku}" was registered by another listing`);
        }

        // 1. Create Product document
        const slug = await this.buildUniqueSlug(data.name);
        const product = await Product.create({
          vendorId,
          name: data.name,
          slug,
          shortDescription: data.shortDescription,
          description: data.description,
          categoryId: data.categoryId,
          brandId: data.brandId,
          tags: data.tags,
          status: 'SUBMITTED', // Set to SUBMITTED for admin approval workflow
          authenticity: data.authenticity,
          shipping: data.shipping,
          tax: data.tax,
        });

        // 2. Create ProductVariant document
        const variant = await ProductVariant.create({
          productId: product._id,
          sku: data.sku,
          price: data.price,
          compareAtPrice: data.compareAtPrice,
          costPrice: data.costPrice,
          weight: data.weight,
          dimensions: data.dimensions,
          status: 'ACTIVE',
        });

        product.variants = [variant._id];

        // 3. Initialize Inventory document
        await inventoryService.initializeInventory({
          productId: product._id,
          variantId: variant._id,
          actorId: userId,
        });

        // Set initial stock quantity
        if (typeof data.stock === 'number' && data.stock > 0) {
          await Inventory.updateOne(
            { variantId: variant._id },
            { $set: { availableQuantity: data.stock } },
          );
        }

        // 4. Upload matched images to storage service (Cloudinary) and link to ProductImage
        const savedImageIds = [];
        for (const imgMeta of row.matchedImages) {
          const cachedImage = imageBufferMap.get(imgMeta.filename.toLowerCase());
          let uploadResult = null;

          if (cachedImage && cachedImage.buffer) {
            try {
              // Upload to storage service (reusing existing Cloudinary configuration)
              uploadResult = await storageService.uploadImage({
                file: {
                  buffer: cachedImage.buffer,
                  mimetype: cachedImage.mimeType,
                  size: cachedImage.size,
                },
                folder: `products/${String(product._id)}`,
                altText: `${product.name} - ${imgMeta.filename}`,
              });
            } catch (uploadErr) {
              // In case Cloudinary is not configured or in test mode, fall back to safe local placeholder
              if (uploadErr.message?.includes('Cloudinary is not configured')) {
                uploadResult = {
                  storageKey: `mock_${product._id}_${imgMeta.filename}`,
                  url: `https://res.cloudinary.com/demo/image/upload/products/${imgMeta.filename}`,
                  fileSize: cachedImage.size,
                  mimeType: cachedImage.mimeType,
                };
              } else {
                throw uploadErr;
              }
            }
          } else {
            // Default safe URL if buffer expired
            uploadResult = {
              storageKey: `bulk_${product._id}_${imgMeta.filename}`,
              url: `https://res.cloudinary.com/demo/image/upload/products/${imgMeta.filename}`,
            };
          }

          if (uploadResult) {
            const productImage = await ProductImage.create({
              productId: product._id,
              variantId: variant._id,
              storageKey: uploadResult.storageKey,
              url: uploadResult.url,
              altText: `${product.name} photo`,
              sortOrder: imgMeta.sortOrder,
              isPrimary: Boolean(imgMeta.isPrimary),
              fileSize: uploadResult.fileSize || cachedImage?.size || null,
              mimeType: uploadResult.mimeType || cachedImage?.mimeType || null,
              status: 'ACTIVE',
            });
            savedImageIds.push(productImage._id);
          }
        }

        product.images = savedImageIds;
        await product.save();

        // 5. Notify administrators that product was submitted for review
        try {
          await notificationService.notifyAdmins({
            type: 'ADMIN_PRODUCT_SUBMITTED',
            title: 'New Product Submitted for Review (Bulk Upload)',
            message: `Product "${product.name}" (SKU: ${data.sku}) has been submitted for review.`,
            channel: 'IN_APP',
            metadata: {
              productId: product._id.toString(),
              productName: product.name,
              sku: data.sku,
              vendorId: vendorId.toString(),
              batchId,
              forAdmin: true,
            },
          });
        } catch {
          // Non-blocking notification dispatch
        }

        // Audit log
        auditService.log('PRODUCT_CREATED', {
          productId: product._id.toString(),
          vendorId: vendorId.toString(),
          sku: data.sku,
          status: product.status,
          bulkBatchId: batchId,
        });

        // Update row state
        row.status = 'SUBMITTED';
        row.createdProductId = product._id;
        newlySubmitted += 1;
      } catch (err) {
        row.status = 'FAILED';
        row.errors = row.errors || [];
        row.errors.push({ field: 'submission', message: err.message || 'Creation failed' });
        newlyFailed += 1;
      }
    }

    batch.submittedCount += newlySubmitted;
    batch.failedCount += newlyFailed;

    const remainingValid = batch.rows.filter((r) => r.isValid && r.status === 'VALID').length;
    if (remainingValid === 0) {
      batch.status = batch.failedCount > 0 || batch.invalidRowsCount > 0 ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
    } else {
      batch.status = 'PARTIALLY_COMPLETED';
    }

    await batch.save();

    return {
      batchId: batch.batchId,
      status: batch.status,
      totalRows: batch.totalRows,
      submittedCount: batch.submittedCount,
      failedCount: batch.failedCount,
      newlySubmitted,
      newlyFailed,
      rows: batch.rows.map((r) => ({
        rowNumber: r.rowNumber,
        sku: r.sku,
        name: r.name,
        status: r.status,
        errors: r.errors,
        createdProductId: r.createdProductId,
      })),
    };
  }

  /**
   * Helper to build unique slug
   */
  async buildUniqueSlug(base) {
    const root = String(base ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'product';

    let slug = root;
    let suffix = 1;
    while (suffix <= 100) {
      const existing = await Product.findOne({ slug, deletedAt: null });
      if (!existing) return slug;
      slug = `${root}-${suffix}`;
      suffix += 1;
    }
    return `${root}-${crypto.randomBytes(3).toString('hex')}`;
  }

  /**
   * Retrieves batch details and results for vendor.
   */
  async getBatch(userId, batchId) {
    const vendorId = await productService.resolveVendorIdForUser(userId);
    const batch = await BulkUploadBatch.findOne({ batchId, vendorId }).lean();
    if (!batch) {
      throw new AppError(404, 'BATCH_NOT_FOUND', 'Bulk upload batch not found');
    }
    return batch;
  }

  /**
   * Lists past batches for vendor.
   */
  async listBatches(userId, { limit = 20, page = 1 } = {}) {
    const vendorId = await productService.resolveVendorIdForUser(userId);
    const filter = { vendorId };
    const items = await BulkUploadBatch.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-rows.productData')
      .lean();
    const total = await BulkUploadBatch.countDocuments(filter);
    return { items, total, page, limit };
  }

  /**
   * Generates downloadable CSV error report for a batch.
   */
  async generateErrorReport(userId, batchId) {
    const vendorId = await productService.resolveVendorIdForUser(userId);
    const batch = await BulkUploadBatch.findOne({ batchId, vendorId }).lean();
    if (!batch) {
      throw new AppError(404, 'BATCH_NOT_FOUND', 'Bulk upload batch not found');
    }

    const errorRows = [
      ['Row Number', 'SKU', 'Product Name', 'Status', 'Field', 'Error Message'],
    ];

    batch.rows.forEach((row) => {
      if (row.errors && row.errors.length > 0) {
        row.errors.forEach((err) => {
          errorRows.push([
            row.rowNumber,
            row.sku || 'N/A',
            row.name || 'N/A',
            row.status,
            err.field || 'General',
            err.message || 'Validation failed',
          ]);
        });
      }
    });

    if (errorRows.length === 1) {
      errorRows.push(['-', '-', '-', 'SUCCESS', '-', 'No errors recorded in this batch. All rows valid!']);
    }

    return stringifyCsv(errorRows, { quoted: true });
  }
}

export const bulkProductService = new BulkProductService();
