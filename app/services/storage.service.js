export class StorageService {
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

  async generateSignedUrl(_key) {
    return { url: _key, provider: 's3-compatible' };
  }
}

export const storageService = new StorageService();
