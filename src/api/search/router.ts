/**
 * Search API router
 * Provides unified search across posts, people, and symbols
 * Uses PostgreSQL ILIKE and trigram similarity for fuzzy matching
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { optionalAuth } from '../middleware/auth';

const router = Router();

// Validation schemas
const searchQuerySchema = z.object({
  q: z.string().min(1).max(200).trim(),
  type: z.enum(['posts', 'people', 'symbols', 'all']).default('all'),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

// Search configuration
const SEARCH_CONFIG = {
  // Minimum query length for trigram search
  MIN_TRIGRAM_LENGTH: 3,

  // Search timeouts (in milliseconds)
  QUERY_TIMEOUT: 5000, // 5 seconds max per search query

  // Similarity thresholds
  MIN_SIMILARITY: 0.1,
  HIGH_SIMILARITY: 0.5,

  // Ranking weights
  SIMILARITY_WEIGHT: 0.7,
  RECENCY_WEIGHT: 0.3,

  // Default limits
  MAX_RESULTS_PER_TYPE: 20,
  DEFAULT_LIMIT: 10,
} as const;

// Validation helper
function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.error.message}`);
  }
  return result.data;
}

/**
 * GET /search
 * Universal search endpoint with type filtering
 */
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { q, type, limit, cursor } = validateData(
      searchQuerySchema,
      req.query
    );
    const userId = req.user?.id;

    // Sanitize search query
    const sanitizedQuery = sanitizeSearchQuery(q);
    if (!sanitizedQuery) {
      return res.status(400).json({
        error: 'Invalid search query',
        message: 'Query must contain at least one alphanumeric character',
      });
    }

    const startTime = Date.now();
    const results: any = {
      query: q,
      type,
      total: 0,
      searchTime: 0,
    };

    try {
      // Set search timeout
      const searchPromise = performSearch(
        sanitizedQuery,
        type,
        limit,
        cursor,
        userId
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Search timeout')),
          SEARCH_CONFIG.QUERY_TIMEOUT
        )
      );

      const searchResults = (await Promise.race([
        searchPromise,
        timeoutPromise,
      ])) as any;

      results.searchTime = Date.now() - startTime;
      Object.assign(results, searchResults);

      return res.json(results);
    } catch (error: any) {
      const searchTime = Date.now() - startTime;

      if (error.message === 'Search timeout') {
        return res.status(408).json({
          error: 'Search timeout',
          message: 'Search query took too long to execute',
          searchTime,
          query: q,
        });
      }

      throw error; // Re-throw other errors to be handled by error middleware
    }
  })
);

/**
 * Sanitize search query to prevent injection and improve matching
 */
function sanitizeSearchQuery(query: string): string {
  // Remove special characters except spaces, letters, numbers, and common symbols
  const sanitized = query
    .replace(/[^\w\s@#$.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.length > 0 ? sanitized : '';
}

/**
 * Perform the actual search based on type
 */
async function performSearch(
  query: string,
  type: string,
  limit: number,
  cursor?: string,
  userId?: number
): Promise<any> {
  const results: any = { total: 0 };

  if (type === 'all') {
    // Search all types in parallel
    const [posts, people, symbols] = await Promise.all([
      searchPosts(
        query,
        Math.min(limit, SEARCH_CONFIG.MAX_RESULTS_PER_TYPE),
        cursor,
        userId
      ),
      searchPeople(
        query,
        Math.min(limit, SEARCH_CONFIG.MAX_RESULTS_PER_TYPE),
        cursor
      ),
      searchSymbols(
        query,
        Math.min(limit, SEARCH_CONFIG.MAX_RESULTS_PER_TYPE),
        cursor
      ),
    ]);

    results.posts = posts;
    results.people = people;
    results.symbols = symbols;
    results.total =
      posts.items.length + people.items.length + symbols.items.length;
  } else {
    // Search specific type
    switch (type) {
      case 'posts':
        results.posts = await searchPosts(query, limit, cursor, userId);
        results.total = results.posts.items.length;
        break;
      case 'people':
        results.people = await searchPeople(query, limit, cursor);
        results.total = results.people.items.length;
        break;
      case 'symbols':
        results.symbols = await searchSymbols(query, limit, cursor);
        results.total = results.symbols.items.length;
        break;
    }
  }

  return results;
}

/**
 * Search posts with content matching and ranking
 */
async function searchPosts(
  query: string,
  limit: number,
  _cursor?: string,
  _userId?: number
) {
  // Mock implementation - replace with actual database queries
  const mockPosts = Array.from({ length: Math.min(limit, 15) }, (_, i) => {
    const rank = calculateMockRank(
      query,
      `Post content ${i + 1} about ${query}`
    );
    return {
      id: i + 1,
      content: `This is post ${i + 1} discussing ${query} and related topics. Lorem ipsum dolor sit amet.`,
      author: {
        id: Math.floor(Math.random() * 100) + 1,
        handle: `user${i + 1}`,
        displayName: `User ${i + 1}`,
        avatar: null,
      },
      createdAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      reactionCounts: {
        LIKE: Math.floor(Math.random() * 50),
        BOOST: Math.floor(Math.random() * 20),
        BOOKMARK: Math.floor(Math.random() * 15),
      },
      rank,
      highlights: extractHighlights(
        `This is post ${i + 1} discussing ${query}`,
        query
      ),
    };
  });

  // Sort by rank (descending)
  mockPosts.sort((a, b) => b.rank - a.rank);

  return {
    items: mockPosts,
    hasMore: mockPosts.length === limit,
    nextCursor: mockPosts.length === limit ? `posts_${Date.now()}` : null,
  };
}

/**
 * Search people (users) by handle and display name
 */
async function searchPeople(query: string, limit: number, _cursor?: string) {
  // Mock implementation
  const mockPeople = Array.from({ length: Math.min(limit, 10) }, (_, i) => {
    const handle = `${query}user${i + 1}`;
    const displayName = `${query} User ${i + 1}`;
    const rank = calculateMockRank(query, `${handle} ${displayName}`);

    return {
      id: i + 1,
      handle,
      displayName,
      bio: `Bio for ${displayName} - interested in ${query} and technology`,
      avatar: null,
      verified: Math.random() > 0.8,
      followerCount: Math.floor(Math.random() * 1000),
      isFollowing: Math.random() > 0.7,
      rank,
      highlights: {
        handle: extractHighlights(handle, query),
        displayName: extractHighlights(displayName, query),
        bio: extractHighlights(
          `Bio for ${displayName} - interested in ${query}`,
          query
        ),
      },
    };
  });

  // Sort by rank (descending)
  mockPeople.sort((a, b) => b.rank - a.rank);

  return {
    items: mockPeople,
    hasMore: mockPeople.length === limit,
    nextCursor: mockPeople.length === limit ? `people_${Date.now()}` : null,
  };
}

/**
 * Search symbols by ticker and name
 */
async function searchSymbols(query: string, limit: number, _cursor?: string) {
  // Mock implementation
  const mockSymbols = Array.from({ length: Math.min(limit, 8) }, (_, i) => {
    const ticker = `${query.toUpperCase()}${i + 1}`;
    const name = `${query} Corporation ${i + 1}`;
    const rank = calculateMockRank(query, `${ticker} ${name}`);

    return {
      id: i + 1,
      ticker,
      name,
      kind: Math.random() > 0.6 ? 'STOCK' : 'CRYPTO',
      exchange: Math.random() > 0.5 ? 'NASDAQ' : 'NYSE',
      price: (Math.random() * 1000 + 10).toFixed(2),
      change24h: ((Math.random() - 0.5) * 20).toFixed(2),
      marketCap: `${(Math.random() * 100 + 1).toFixed(1)}B`,
      mentionCount: Math.floor(Math.random() * 500),
      rank,
      highlights: {
        ticker: extractHighlights(ticker, query),
        name: extractHighlights(name, query),
      },
    };
  });

  // Sort by rank (descending)
  mockSymbols.sort((a, b) => b.rank - a.rank);

  return {
    items: mockSymbols,
    hasMore: mockSymbols.length === limit,
    nextCursor: mockSymbols.length === limit ? `symbols_${Date.now()}` : null,
  };
}

/**
 * Calculate mock ranking score based on similarity
 */
function calculateMockRank(query: string, content: string): number {
  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();

  // Exact match gets highest score
  if (contentLower.includes(queryLower)) {
    const position = contentLower.indexOf(queryLower);
    const exactMatchScore = position === 0 ? 1.0 : 0.8; // Beginning match is better
    return Math.min(exactMatchScore + Math.random() * 0.1, 1.0);
  }

  // Partial match based on word overlap
  const queryWords = queryLower.split(/\s+/);
  const contentWords = contentLower.split(/\s+/);
  const matchingWords = queryWords.filter(word =>
    contentWords.some(
      contentWord => contentWord.includes(word) || word.includes(contentWord)
    )
  );

  const wordMatchScore = matchingWords.length / queryWords.length;
  return Math.min(wordMatchScore * 0.7 + Math.random() * 0.2, 0.9);
}

/**
 * Extract highlighted text segments for search results
 */
function extractHighlights(text: string, query: string): string[] {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const highlights: string[] = [];

  // Find exact matches
  let index = textLower.indexOf(queryLower);
  while (index !== -1) {
    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + queryLower.length + 20);
    const highlight = text.substring(start, end);
    highlights.push(highlight);

    index = textLower.indexOf(queryLower, index + 1);
    if (highlights.length >= 3) break; // Limit highlights
  }

  // If no exact matches, find word matches
  if (highlights.length === 0) {
    const queryWords = queryLower.split(/\s+/);
    for (const word of queryWords) {
      const wordIndex = textLower.indexOf(word);
      if (wordIndex !== -1) {
        const start = Math.max(0, wordIndex - 15);
        const end = Math.min(text.length, wordIndex + word.length + 15);
        highlights.push(text.substring(start, end));
        break;
      }
    }
  }

  return highlights.length > 0 ? highlights : [text.substring(0, 50)];
}

export default router;
