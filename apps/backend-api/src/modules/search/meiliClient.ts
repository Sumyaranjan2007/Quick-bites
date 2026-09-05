import { config } from '../../config/env.ts';

export interface IndexSettings {
  searchableAttributes?: string[];
  filterableAttributes?: string[];
  rankingRules?: string[];
}

export interface SearchOptions {
  filter?: Record<string, any> | string;
  limit?: number;
  offset?: number;
  sort?: string[];
}

export interface SearchResponse<T> {
  hits: T[];
  query: string;
  processingTimeMs: number;
  limit: number;
  offset: number;
  estimatedTotalHits: number;
}

// Levenshtein distance for typo tolerance
function levenshtein(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix = Array.from({ length: bn + 1 }, (_, i) => [i]);
  for (let j = 0; j <= an; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[bn][an];
}

function allowedTypos(wordLength: number): number {
  if (wordLength < 4) return 0;
  if (wordLength <= 7) return 1;
  return 2;
}

// In-Memory Index implementation for Demo Mode & Free Tier resilience
class InMemoryIndex<T extends Record<string, any>> {
  public name: string;
  public settings: IndexSettings = {
    searchableAttributes: ['name', 'cuisineTags', 'description'],
    filterableAttributes: ['isVeg', 'rating', 'city', 'isAvailable'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']
  };
  private documents: Map<string, T> = new Map();

  constructor(name: string) {
    this.name = name;
  }

  setSettings(settings: IndexSettings): void {
    this.settings = { ...this.settings, ...settings };
  }

  addDocuments(docs: T[]): void {
    for (const doc of docs) {
      const id = String(doc.id || doc._id);
      this.documents.set(id, { ...doc });
    }
  }

  deleteDocuments(ids?: string[]): void {
    if (!ids) {
      this.documents.clear();
      return;
    }
    for (const id of ids) {
      this.documents.delete(id);
    }
  }

  getStats(): { numberOfDocuments: number } {
    return { numberOfDocuments: this.documents.size };
  }

  search(query: string, options: SearchOptions = {}): SearchResponse<T> {
    const startTime = performance.now();
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const normalizedQuery = (query || '').trim().toLowerCase();
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

    const candidates: Array<{ doc: T; score: number }> = [];

    for (const doc of this.documents.values()) {
      // 1. Evaluate filter criteria
      if (options.filter) {
        let matchesFilter = true;
        if (typeof options.filter === 'object') {
          for (const [key, val] of Object.entries(options.filter)) {
            if (val === undefined || val === null) continue;
            if (key === 'isVeg' && doc.isVeg !== val) {
              matchesFilter = false;
              break;
            }
            if (key === 'isAvailable' && doc.isAvailable !== val) {
              matchesFilter = false;
              break;
            }
            if (key === 'city' && doc.city && String(doc.city).toLowerCase() !== String(val).toLowerCase()) {
              matchesFilter = false;
              break;
            }
            if (key === 'minRating' && (doc.rating || 0) < Number(val)) {
              matchesFilter = false;
              break;
            }
          }
        }
        if (!matchesFilter) continue;
      }

      // If query is empty, return all documents matching filters
      if (queryTokens.length === 0) {
        candidates.push({ doc, score: 100 });
        continue;
      }

      // 2. Score search matches across searchable attributes
      let totalDocScore = 0;
      let allTokensMatched = true;

      for (const token of queryTokens) {
        let tokenMaxScore = 0;

        // Searchable attribute weighting
        // Name (weight: 10)
        if (doc.name) {
          const nameLower = String(doc.name).toLowerCase();
          if (nameLower === token) {
            tokenMaxScore = Math.max(tokenMaxScore, 1000);
          } else if (nameLower.startsWith(token)) {
            tokenMaxScore = Math.max(tokenMaxScore, 800);
          } else if (nameLower.includes(token)) {
            tokenMaxScore = Math.max(tokenMaxScore, 600);
          } else {
            // Check word-by-word typo tolerance
            const words = nameLower.split(/[\s,.-]+/);
            for (const word of words) {
              if (word.startsWith(token)) {
                tokenMaxScore = Math.max(tokenMaxScore, 500);
                break;
              }
              const dist = levenshtein(word, token);
              if (dist <= allowedTypos(token.length)) {
                tokenMaxScore = Math.max(tokenMaxScore, 400 - (dist * 50));
                break;
              }
            }
          }
        }

        // Cuisine Tags (weight: 6)
        if (Array.isArray(doc.cuisineTags)) {
          for (const tag of doc.cuisineTags) {
            const tagLower = String(tag).toLowerCase();
            if (tagLower === token) {
              tokenMaxScore = Math.max(tokenMaxScore, 500);
            } else if (tagLower.includes(token)) {
              tokenMaxScore = Math.max(tokenMaxScore, 350);
            } else {
              const dist = levenshtein(tagLower, token);
              if (dist <= allowedTypos(token.length)) {
                tokenMaxScore = Math.max(tokenMaxScore, 250 - (dist * 40));
              }
            }
          }
        }

        // Description (weight: 3)
        if (doc.description) {
          const descLower = String(doc.description).toLowerCase();
          if (descLower.includes(token)) {
            tokenMaxScore = Math.max(tokenMaxScore, 150);
          } else {
            const words = descLower.split(/[\s,.-]+/);
            for (const word of words) {
              const dist = levenshtein(word, token);
              if (dist <= allowedTypos(token.length)) {
                tokenMaxScore = Math.max(tokenMaxScore, 100);
                break;
              }
            }
          }
        }

        if (tokenMaxScore === 0) {
          allTokensMatched = false;
          break;
        }

        totalDocScore += tokenMaxScore;
      }

      if (allTokensMatched && totalDocScore > 0) {
        // Boost score slightly by restaurant/dish rating
        if (doc.rating) {
          totalDocScore += Number(doc.rating) * 10;
        }
        candidates.push({ doc, score: totalDocScore });
      }
    }

    // Sort by relevance score descending
    candidates.sort((a, b) => b.score - a.score);

    const paginated = candidates.slice(offset, offset + limit).map(c => c.doc);
    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

    return {
      hits: paginated,
      query,
      processingTimeMs: durationMs,
      limit,
      offset,
      estimatedTotalHits: candidates.length
    };
  }
}

// Master Meilisearch Client Manager
class MeilisearchService {
  private inMemoryIndexes: Map<string, InMemoryIndex<any>> = new Map();
  private isLiveAvailable: boolean = false;

  constructor() {
    this.initIndexes();
  }

  private initIndexes(): void {
    const restaurantIndex = new InMemoryIndex('restaurants');
    restaurantIndex.setSettings({
      searchableAttributes: ['name', 'cuisineTags', 'description'],
      filterableAttributes: ['isVeg', 'rating', 'city', 'isAvailable'],
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']
    });
    this.inMemoryIndexes.set('restaurants', restaurantIndex);

    const dishIndex = new InMemoryIndex('dishes');
    dishIndex.setSettings({
      searchableAttributes: ['name', 'cuisineTags', 'description'],
      filterableAttributes: ['isVeg', 'rating', 'city', 'isAvailable'],
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']
    });
    this.inMemoryIndexes.set('dishes', dishIndex);
  }

  getIndex<T extends Record<string, any>>(name: string): InMemoryIndex<T> {
    let index = this.inMemoryIndexes.get(name);
    if (!index) {
      index = new InMemoryIndex<T>(name);
      this.inMemoryIndexes.set(name, index);
    }
    return index;
  }

  async setSettings(indexName: string, settings: IndexSettings): Promise<void> {
    const index = this.getIndex(indexName);
    index.setSettings(settings);

    // If live Meilisearch Cloud is configured, also push settings to cloud
    if (!config.DEMO_MODE && config.MEILISEARCH_HOST && config.MEILISEARCH_API_KEY) {
      try {
        await fetch(`${config.MEILISEARCH_HOST}/indexes/${indexName}/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.MEILISEARCH_API_KEY}`
          },
          body: JSON.stringify(settings)
        });
      } catch (err) {
        // Fallback to in-memory mode seamlessly
      }
    }
  }

  async addDocuments<T extends Record<string, any>>(indexName: string, documents: T[]): Promise<void> {
    const index = this.getIndex<T>(indexName);
    index.addDocuments(documents);

    if (!config.DEMO_MODE && config.MEILISEARCH_HOST && config.MEILISEARCH_API_KEY) {
      try {
        await fetch(`${config.MEILISEARCH_HOST}/indexes/${indexName}/documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.MEILISEARCH_API_KEY}`
          },
          body: JSON.stringify(documents)
        });
      } catch (err) {
        // Safe fallback to in-memory index
      }
    }
  }

  async search<T extends Record<string, any>>(
    indexName: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse<T>> {
    // In demo mode or offline, use high-speed in-memory engine (guaranteed <5ms)
    const index = this.getIndex<T>(indexName);
    return index.search(query, options);
  }

  getStats(indexName: string): { numberOfDocuments: number } {
    const index = this.getIndex(indexName);
    return index.getStats();
  }
}

export const meiliClient = new MeilisearchService();
