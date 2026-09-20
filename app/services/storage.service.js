import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

export class StorageService {
  constructor() {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME ?? '').trim();
    const apiKey = String(env.CLOUDINARY_API_KEY ?? '').trim();
    const apiSecret = String(env.CLOUDINARY_API_SECRET ?? '').trim();

    this.isConfigured = Boolean(cloudName && apiKey && apiSecret);

    if (this.isConfigured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }
  }

  isAllowedMimeType(mimeType) {
    return Boolean(mimeType) && ALLOWED_MIME_TYPES.has(String(mimeType).toLowerCase());
  }

  validateImageFile(file) {
    if (!file || !file.buffer || !file.mimetype) {
      throw new Error('Image file is required');
    }

    if (!this.isAllowedMimeType(file.mimetype)) {
      throw new Error('Only image/jpeg, image/png, image/webp, image/gif, and image/bmp files are allowed');
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error('Image file must be 2MB or smaller');
    }

    return true;
  }

  normalizePublicId(input) {
    if (!input) return '';
    const value = String(input).trim();
    if (!value) return '';

    const publicId = value.includes('/upload/')
      ? value.split('/upload/').slice(1).join('/upload/').replace(/^v\d+\//, '')
      : value;

    return publicId.replace(/\.[a-z0-9]+$/i, '').replace(/^\/+|\/+$/g, '');
  }

  async uploadImage(input = {}) {
    if (!this.isConfigured) {
      throw new Error('Cloudinary is not configured');
    }

    if (!input || typeof input !== 'object') {
      throw new Error('Invalid storage payload');
    }

    const file = input.file ?? null;
    const folder = String(input.folder ?? 'products').trim() || 'products';
    const buffer = file?.buffer ?? null;

    if (!buffer || !file?.mimetype) {
      throw new Error('Image file buffer is required');
    }

    this.validateImageFile(file);

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          overwrite: false,
          use_filename: true,
          unique_filename: true,
        },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        },
      );

      uploadStream.end(buffer);
    });

    return {
      storageKey: String(result.public_id ?? '').trim(),
      url: String(result.secure_url || result.url || '').trim(),
      width: result.width == null ? null : Number(result.width),
      height: result.height == null ? null : Number(result.height),
      fileSize: result.bytes == null ? (file.size == null ? null : Number(file.size)) : Number(result.bytes),
      mimeType: result.format ? `image/${String(result.format).toLowerCase()}` : (file.mimetype ? String(file.mimetype).trim() : null),
      altText: String(input.altText ?? '').trim(),
    };
  }

  async deleteImage(storageKey) {
    if (!storageKey) return false;
    if (!this.isConfigured) {
      throw new Error('Cloudinary is not configured');
    }

    const publicId = this.normalizePublicId(storageKey);
    if (!publicId) return false;

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    return result?.result === 'ok' || result?.result === 'not found';
  }

  async uploadImageMetadata(input = {}) {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid storage payload');
    }

    const safe = {
      storageKey: String(input.storageKey ?? '').trim(),
      url: String(input.url ?? '').trim(),
      altText: String(input.altText ?? '').trim(),
      sortOrder: Number(input.sortOrder ?? 0),
      isPrimary: Boolean(input.isPrimary),
      width: input.width == null ? null : Number(input.width),
      height: input.height == null ? null : Number(input.height),
      fileSize: input.fileSize == null ? null : Number(input.fileSize),
      mimeType: input.mimeType ? String(input.mimeType).trim() : null,
    };

    if (!safe.storageKey || !safe.url) {
      throw new Error('Storage metadata requires storageKey and url');
    }

    return safe;
  }

  async generateSignedUrl(key) {
    if (!key) return { url: '', provider: 'cloudinary' };
    const publicId = this.normalizePublicId(key);
    if (!publicId) return { url: String(key).trim(), provider: 'cloudinary' };
    return { url: cloudinary.url(publicId, { secure: true }), provider: 'cloudinary' };
  }
}

export const storageService = new StorageService();
