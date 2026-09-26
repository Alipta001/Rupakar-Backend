/**
 * Search relevance and query expansion utilities for Rupakar customer storefront.
 */

// Common English stopwords to ignore in multi-word queries
export const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'in',
  'on',
  'at',
  'for',
  'to',
  'of',
  'with',
  'by',
  'is',
  'it',
  'or',
  'from',
  'as',
  'into',
]);

// Multi-word phrase synonym expansions
export const PHRASE_SYNONYMS = {
  'wall decor': ['wall hanging', 'wall art', 'wall decoration', 'wall plate', 'hanging decor', 'mural'],
  'wall decoration': ['wall hanging', 'wall art', 'wall decor', 'wall plate', 'mural'],
  'wall art': ['wall hanging', 'wall decor', 'wall decoration', 'wall plate', 'pattachitra', 'mural'],
  'wall hanging': ['wall decor', 'wall art', 'wall decoration', 'hanging'],
  'home decor': ['decor', 'decoration', 'decorative', 'vase', 'showpiece', 'wall hanging', 'pottery'],
  'oil lamp': ['diya', 'deepak', 'lantern', 'brass diya'],
  'table decor': ['table runner', 'showpiece', 'vase', 'pottery', 'coaster'],
};

// Word-level synonyms and related craft concepts
export const WORD_SYNONYMS = {
  decor: ['decoration', 'decorative', 'hanging', 'showpiece', 'art', 'decorating'],
  decoration: ['decor', 'decorative', 'hanging', 'showpiece', 'art'],
  decorative: ['decor', 'decoration', 'showpiece', 'ornament'],
  terracotta: ['clay', 'earthen', 'pottery', 'earthenware'],
  clay: ['terracotta', 'earthen', 'pottery', 'ceramic'],
  earthen: ['clay', 'terracotta', 'pottery'],
  pottery: ['ceramic', 'terracotta', 'clay', 'earthenware', 'vase'],
  ceramic: ['pottery', 'clay', 'earthenware'],
  hanging: ['wall decor', 'wall art', 'wall hanging', 'tapestry', 'toran'],
  lamp: ['diya', 'lantern', 'deepak', 'light'],
  diya: ['lamp', 'deepak', 'earthen lamp', 'brass lamp'],
  lantern: ['lamp', 'diya', 'light'],
  painting: ['art', 'pattachitra', 'madhubani', 'kalamkari', 'warli', 'canvas'],
  art: ['painting', 'craft', 'folk art', 'pattachitra', 'madhubani'],
  vase: ['pot', 'pitcher', 'vessel', 'urn'],
  handloom: ['handwoven', 'weaving', 'textile', 'cotton', 'silk', 'saree', 'dupatta', 'stole'],
  handwoven: ['handloom', 'textile', 'woven', 'cotton', 'silk'],
  saree: ['sari', 'handloom', 'drape'],
  sari: ['saree', 'handloom'],
  dokra: ['dhokra', 'brass', 'metal craft', 'lost wax', 'bell metal'],
  dhokra: ['dokra', 'brass', 'metal craft', 'lost wax', 'bell metal'],
  brass: ['metal', 'dokra', 'dhokra', 'bronze', 'bell metal'],
  metal: ['brass', 'dokra', 'dhokra', 'bronze'],
  wood: ['wooden', 'woodcraft', 'carving', 'carved'],
  wooden: ['wood', 'woodcraft', 'carving'],
  sculpture: ['figurine', 'statue', 'idol', 'showpiece'],
  figurine: ['sculpture', 'statue', 'idol', 'showpiece'],
  statue: ['idol', 'figurine', 'sculpture'],
  idol: ['statue', 'figurine', 'sculpture'],
  shawl: ['stole', 'dupatta', 'scarf', 'wrap'],
  stole: ['shawl', 'dupatta', 'scarf'],
  dupatta: ['stole', 'shawl', 'scarf'],
};

/**
 * Normalize search text:
 * - lowercase
 * - strip diacritics (e.g. décor -> decor)
 * - replace punctuation with space
 * - trim and collapse whitespace
 */
export function normalizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

/**
 * Escape special regex characters.
 */
export function escapeRegex(string) {
  if (!string || typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract meaningful tokens from normalized text.
 */
export function extractTokens(normalizedText) {
  if (!normalizedText) return [];
  const rawWords = normalizedText.split(' ').map((w) => w.trim()).filter(Boolean);
  if (rawWords.length <= 1) return rawWords;

  const filtered = rawWords.filter((w) => !STOP_WORDS.has(w) && w.length >= 2);
  return filtered.length > 0 ? filtered : rawWords;
}

/**
 * Retrieve synonyms and related terms for a query.
 */
export function getSynonymsForQuery(rawQuery) {
  const norm = normalizeText(rawQuery);
  const synonyms = new Set();

  if (PHRASE_SYNONYMS[norm]) {
    for (const syn of PHRASE_SYNONYMS[norm]) {
      synonyms.add(syn);
    }
  }

  for (const [key, vals] of Object.entries(PHRASE_SYNONYMS)) {
    if (norm.includes(key) || key.includes(norm)) {
      for (const val of vals) synonyms.add(val);
    }
  }

  const tokens = extractTokens(norm);
  for (const token of tokens) {
    if (WORD_SYNONYMS[token]) {
      for (const syn of WORD_SYNONYMS[token]) {
        synonyms.add(syn);
      }
    }
  }

  return Array.from(synonyms);
}

/**
 * Parse and prepare search query metadata.
 */
export function parseSearchQuery(rawQuery) {
  const safe = String(rawQuery ?? '').trim();
  const normQuery = normalizeText(safe);
  const queryTokens = extractTokens(normQuery);
  const synonyms = getSynonymsForQuery(safe);
  const synonymTokens = Array.from(
    new Set(synonyms.flatMap((s) => extractTokens(normalizeText(s)))),
  );

  return {
    rawQuery: safe,
    normQuery,
    queryTokens,
    synonyms,
    synonymTokens,
  };
}

/**
 * Extract normalized strings from product fields for relevance scoring.
 */
export function extractProductSearchFields(product) {
  const name = normalizeText(product.name || '');
  const shortDesc = normalizeText(product.shortDescription || '');
  const desc = normalizeText(product.description || '');
  const story = normalizeText(product.story || '');

  const categoryName = normalizeText(
    (product.categoryId && typeof product.categoryId === 'object' ? product.categoryId.name : '') ||
    product.category ||
    '',
  );
  const subcategoryName = normalizeText(
    (product.subcategoryId && typeof product.subcategoryId === 'object' ? product.subcategoryId.name : '') ||
    product.subcategory ||
    '',
  );

  const tags = Array.isArray(product.tags) ? product.tags.map((t) => normalizeText(t)).filter(Boolean) : [];
  const seoKeywords = Array.isArray(product.seo?.keywords)
    ? product.seo.keywords.map((k) => normalizeText(k)).filter(Boolean)
    : [];

  const attrStrings = [];
  if (product.craft) attrStrings.push(normalizeText(product.craft));
  if (product.material) attrStrings.push(normalizeText(product.material));
  if (product.artisan) attrStrings.push(normalizeText(product.artisan));
  if (product.region) attrStrings.push(normalizeText(product.region));

  if (product.attributes) {
    if (product.attributes instanceof Map) {
      for (const [key, val] of product.attributes.entries()) {
        attrStrings.push(normalizeText(key));
        if (Array.isArray(val)) {
          val.forEach((v) => attrStrings.push(normalizeText(v)));
        } else if (typeof val === 'string') {
          attrStrings.push(normalizeText(val));
        }
      }
    } else if (typeof product.attributes === 'object') {
      for (const [key, val] of Object.entries(product.attributes)) {
        attrStrings.push(normalizeText(key));
        if (Array.isArray(val)) {
          val.forEach((v) => attrStrings.push(normalizeText(v)));
        } else if (typeof val === 'string') {
          attrStrings.push(normalizeText(val));
        }
      }
    }
  }

  return {
    name,
    shortDesc,
    desc,
    story,
    categoryName,
    subcategoryName,
    tags,
    seoKeywords,
    attributes: attrStrings.filter(Boolean),
  };
}

/**
 * Score a product's relevance against parsed search metadata.
 * Returns 0 if product is not sufficiently relevant or matches only incidental words.
 */
export function scoreProductRelevance(product, queryInfo) {
  const { normQuery, queryTokens, synonyms, synonymTokens } = queryInfo;
  if (!normQuery || queryTokens.length === 0) return 0;

  const fields = extractProductSearchFields(product);

  let score = 0;
  const matchedQueryTokens = new Set();
  const matchedSynonymTokens = new Set();
  let hasHighRelevanceMatch = false;

  // 1. EXACT PRODUCT NAME MATCH (highest priority: +1000)
  if (fields.name === normQuery) {
    score += 1000;
    hasHighRelevanceMatch = true;
    queryTokens.forEach((t) => matchedQueryTokens.add(t));
  } else {
    // Exact phrase in name
    if (fields.name.includes(normQuery)) {
      score += 500;
      hasHighRelevanceMatch = true;
      if (fields.name.startsWith(normQuery)) {
        score += 150;
      }
      queryTokens.forEach((t) => matchedQueryTokens.add(t));
    }

    // Token matching in name
    const nameWords = fields.name.split(' ');
    for (const token of queryTokens) {
      if (nameWords.includes(token)) {
        score += 120;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      } else if (nameWords.some((nw) => nw.startsWith(token) || (token.length >= 3 && nw.includes(token)))) {
        // partial word match in product name
        score += 60;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      }
    }

    // Synonym matching in name
    for (const syn of synonyms) {
      if (fields.name.includes(syn)) {
        score += 200;
        hasHighRelevanceMatch = true;
      }
    }
    for (const synTok of synonymTokens) {
      if (nameWords.includes(synTok) || nameWords.some((nw) => nw.startsWith(synTok))) {
        score += 70;
        matchedSynonymTokens.add(synTok);
        hasHighRelevanceMatch = true;
      }
    }
  }

  // 2. TAGS & SEO KEYWORDS
  const allTags = [...fields.tags, ...fields.seoKeywords];
  for (const tag of allTags) {
    if (tag === normQuery) {
      score += 350;
      hasHighRelevanceMatch = true;
      queryTokens.forEach((t) => matchedQueryTokens.add(t));
    } else if (tag.includes(normQuery)) {
      score += 200;
      hasHighRelevanceMatch = true;
    }

    for (const token of queryTokens) {
      if (tag === token || tag.split(' ').includes(token)) {
        score += 100;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      } else if (tag.startsWith(token) || (token.length >= 3 && tag.includes(token))) {
        score += 40;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      }
    }

    for (const syn of synonyms) {
      if (tag === syn || tag.includes(syn)) {
        score += 90;
        hasHighRelevanceMatch = true;
      }
    }
    for (const synTok of synonymTokens) {
      if (tag.split(' ').includes(synTok)) {
        score += 45;
        matchedSynonymTokens.add(synTok);
        hasHighRelevanceMatch = true;
      }
    }
  }

  // 3. CATEGORY & SUBCATEGORY MATCH
  const catTexts = [fields.categoryName, fields.subcategoryName].filter(Boolean);
  for (const catText of catTexts) {
    if (catText === normQuery) {
      score += 400;
      hasHighRelevanceMatch = true;
      queryTokens.forEach((t) => matchedQueryTokens.add(t));
    } else if (catText.includes(normQuery)) {
      score += 250;
      hasHighRelevanceMatch = true;
      queryTokens.forEach((t) => matchedQueryTokens.add(t));
    }

    const catWords = catText.split(' ');
    for (const token of queryTokens) {
      if (catWords.includes(token)) {
        score += 110;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      } else if (catWords.some((cw) => cw.startsWith(token) || (token.length >= 3 && cw.includes(token)))) {
        score += 50;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      }
    }

    for (const syn of synonyms) {
      if (catText.includes(syn)) {
        score += 90;
        hasHighRelevanceMatch = true;
      }
    }
    for (const synTok of synonymTokens) {
      if (catWords.includes(synTok)) {
        score += 45;
        matchedSynonymTokens.add(synTok);
        hasHighRelevanceMatch = true;
      }
    }
  }

  // 4. ATTRIBUTES (craft, material, artisan, region)
  for (const attr of fields.attributes) {
    if (attr === normQuery || attr.includes(normQuery)) {
      score += 200;
      hasHighRelevanceMatch = true;
      queryTokens.forEach((t) => matchedQueryTokens.add(t));
    }
    const attrWords = attr.split(' ');
    for (const token of queryTokens) {
      if (attrWords.includes(token)) {
        score += 80;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      } else if (attrWords.some((aw) => aw.startsWith(token) || (token.length >= 3 && aw.includes(token)))) {
        score += 35;
        matchedQueryTokens.add(token);
        hasHighRelevanceMatch = true;
      }
    }

    for (const syn of synonyms) {
      if (attr.includes(syn)) {
        score += 70;
        hasHighRelevanceMatch = true;
      }
    }
    for (const synTok of synonymTokens) {
      if (attrWords.includes(synTok)) {
        score += 35;
        matchedSynonymTokens.add(synTok);
        hasHighRelevanceMatch = true;
      }
    }
  }

  // 5. SHORT DESCRIPTION & FULL DESCRIPTION
  if (fields.shortDesc.includes(normQuery)) {
    score += 80;
  }
  if (fields.desc.includes(normQuery) || fields.story.includes(normQuery)) {
    score += 40;
  }

  const descWords = `${fields.shortDesc} ${fields.desc} ${fields.story}`.split(' ');
  for (const token of queryTokens) {
    if (descWords.includes(token)) {
      score += 20;
      matchedQueryTokens.add(token);
    } else if (token.length >= 4 && descWords.some((dw) => dw.startsWith(token))) {
      score += 10;
      matchedQueryTokens.add(token);
    }
  }

  for (const syn of synonyms) {
    if (fields.shortDesc.includes(syn) || fields.desc.includes(syn)) {
      score += 30;
    }
  }
  for (const synTok of synonymTokens) {
    if (descWords.includes(synTok)) {
      score += 15;
      matchedSynonymTokens.add(synTok);
    }
  }

  // 6. TOKEN COVERAGE BONUSES:
  if (hasHighRelevanceMatch) {
    if (queryTokens.length > 1 && matchedQueryTokens.size === queryTokens.length) {
      score += 250;
    } else if (queryTokens.length > 1 && matchedQueryTokens.size + matchedSynonymTokens.size >= queryTokens.length) {
      score += 150;
    }
  } else if (queryTokens.length > 1 && matchedQueryTokens.size === queryTokens.length) {
    // Description-only matches: modest bonus when all query tokens are present
    score += 50;
  }

  // 7. AVOID UNRELATED MATCHES:
  // For multi-word queries:
  // If the product has NO high-relevance match in (name, tags, category, craft, attributes):
  // it can ONLY qualify if ALL query tokens directly matched in description/shortDescription.
  // Incidental single-word or synonym matches in body description do not qualify a product.
  if (queryTokens.length >= 2) {
    if (!hasHighRelevanceMatch) {
      if (matchedQueryTokens.size < queryTokens.length) {
        return 0;
      }
    }
  } else if (queryTokens.length === 1) {
    if (matchedQueryTokens.size === 0 && matchedSynonymTokens.size === 0) {
      return 0;
    }
    // Reject incidental single-token body occurrences if not in high relevance fields
    if (!hasHighRelevanceMatch && !fields.shortDesc.includes(queryTokens[0])) {
      if (score < 30) return 0;
    }
  }

  return score;
}

/**
 * Build MongoDB candidate filter to fetch potential matching products efficiently.
 */
export function buildCandidateMongoFilter(queryInfo, matchingCategoryIds = [], matchingBrandIds = []) {
  const { normQuery, queryTokens, synonyms, synonymTokens } = queryInfo;
  const orConditions = [];

  const addRegexField = (field, term) => {
    if (!term || term.length < 2) return;
    orConditions.push({ [field]: { $regex: escapeRegex(term), $options: 'i' } });
  };

  // Full query regex
  if (normQuery) {
    addRegexField('name', normQuery);
    addRegexField('shortDescription', normQuery);
    addRegexField('description', normQuery);
    orConditions.push({ tags: { $in: [new RegExp(escapeRegex(normQuery), 'i')] } });
    orConditions.push({ 'seo.keywords': { $in: [new RegExp(escapeRegex(normQuery), 'i')] } });
    addRegexField('craft', normQuery);
    addRegexField('material', normQuery);
    addRegexField('artisan', normQuery);
    addRegexField('attributes.craft', normQuery);
    addRegexField('attributes.material', normQuery);
  }

  // Token regexes
  for (const token of queryTokens) {
    addRegexField('name', token);
    addRegexField('shortDescription', token);
    addRegexField('description', token);
    orConditions.push({ tags: { $in: [new RegExp(escapeRegex(token), 'i')] } });
    orConditions.push({ 'seo.keywords': { $in: [new RegExp(escapeRegex(token), 'i')] } });
    addRegexField('craft', token);
    addRegexField('material', token);
    addRegexField('artisan', token);
    addRegexField('attributes.craft', token);
    addRegexField('attributes.material', token);
  }

  // Top synonym regexes
  const allSynonyms = [...synonyms, ...synonymTokens];
  for (const syn of allSynonyms.slice(0, 10)) {
    addRegexField('name', syn);
    orConditions.push({ tags: { $in: [new RegExp(escapeRegex(syn), 'i')] } });
    addRegexField('craft', syn);
    addRegexField('material', syn);
    addRegexField('attributes.craft', syn);
    addRegexField('attributes.material', syn);
  }

  // Matching categories
  if (Array.isArray(matchingCategoryIds) && matchingCategoryIds.length > 0) {
    orConditions.push({ categoryId: { $in: matchingCategoryIds } });
    orConditions.push({ subcategoryId: { $in: matchingCategoryIds } });
  }

  // Matching brands
  if (Array.isArray(matchingBrandIds) && matchingBrandIds.length > 0) {
    orConditions.push({ brandId: { $in: matchingBrandIds } });
  }

  return orConditions.length > 0 ? { $or: orConditions } : {};
}
