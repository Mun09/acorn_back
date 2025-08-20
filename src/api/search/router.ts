/**
 * Search API router
 * Provides unified search across posts, people, and symbols
 * Uses PostgreSQL ILIKE and trigram similarity for fuzzy matching
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { optionalAuth } from '../middleware/auth';
import { prisma } from '../../lib/prisma';

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
  cursor?: string,
  _userId?: number
) {
  let whereClause: any = {
    OR: [
      {
        text: {
          contains: query,
          mode: 'insensitive',
        },
      },
    ],
    isHidden: false,
  };

  // Handle cursor for pagination
  if (cursor) {
    try {
      const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
      whereClause.id = {
        lt: cursorData.id,
      };
    } catch (error) {
      // Invalid cursor, ignore
    }
  }

  const posts = await prisma.post.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          handle: true,
          bio: true,
          trustScore: true,
          verifiedFlags: true,
        },
      },
      symbols: {
        include: {
          symbol: true,
        },
      },
      reactions: {
        select: {
          type: true,
          userId: true,
        },
      },
      _count: {
        select: {
          reactions: true,
          replies: true,
        },
      },
    },
    orderBy: [
      {
        createdAt: 'desc',
      },
    ],
    take: limit + 1,
  });

  const hasMore = posts.length > limit;
  const items = hasMore ? posts.slice(0, -1) : posts;

  const formattedPosts = items.map((post: any) => {
    const reactionCounts = post.reactions.reduce(
      (
        acc: Record<string, number>,
        reaction: { type: string; userId: number }
      ) => {
        acc[reaction.type] = (acc[reaction.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Calculate simple relevance rank based on text match
    const rank = calculateTextRelevance(post.text, query);

    return {
      id: post.id,
      content: post.text,
      author: {
        id: post.user.id,
        handle: post.user.handle,
        displayName: post.user.handle,
        bio: post.user.bio,
        trustScore: post.user.trustScore,
        verifiedFlags: post.user.verifiedFlags,
      },
      createdAt: post.createdAt.toISOString(),
      reactionCounts,
      rank,
      highlights: extractHighlights(post.text, query),
      symbols: post.symbols.map((ps: any) => ({
        ticker: ps.symbol.ticker,
        kind: ps.symbol.kind,
        exchange: ps.symbol.exchange,
      })),
    };
  });

  // Sort by rank (descending)
  formattedPosts.sort((a: any, b: any) => b.rank - a.rank);

  const nextCursor =
    hasMore && items.length > 0
      ? Buffer.from(
          JSON.stringify({
            id: items[items.length - 1]!.id,
          })
        ).toString('base64')
      : null;

  return {
    items: formattedPosts,
    hasMore,
    nextCursor,
  };
}

/**
 * Search people (users) by handle and display name
 */
async function searchPeople(query: string, limit: number, cursor?: string) {
  let whereClause: any = {
    OR: [
      {
        handle: {
          contains: query,
          mode: 'insensitive',
        },
      },
      {
        bio: {
          contains: query,
          mode: 'insensitive',
        },
      },
    ],
  };

  // Handle cursor for pagination
  if (cursor) {
    try {
      const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
      whereClause.id = {
        lt: cursorData.id,
      };
    } catch (error) {
      // Invalid cursor, ignore
    }
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          posts: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit + 1,
  });

  const hasMore = users.length > limit;
  const items = hasMore ? users.slice(0, -1) : users;

  const formattedUsers = items.map((user: any) => {
    // Calculate relevance rank
    const rank = calculateTextRelevance(
      `${user.handle} ${user.bio || ''}`,
      query
    );

    return {
      id: user.id,
      handle: user.handle,
      displayName: user.handle,
      bio: user.bio,
      avatar: null,
      verified: !!user.verifiedFlags,
      followerCount: user._count.followers,
      followingCount: user._count.following,
      postCount: user._count.posts,
      trustScore: user.trustScore,
      isFollowing: false, // Would need to check follow relationship with current user
      rank,
      highlights: {
        handle: extractHighlights(user.handle, query),
        displayName: extractHighlights(user.handle, query),
        bio: user.bio ? extractHighlights(user.bio, query) : '',
      },
    };
  });

  // Sort by rank (descending)
  formattedUsers.sort((a: any, b: any) => b.rank - a.rank);

  const nextCursor =
    hasMore && items.length > 0
      ? Buffer.from(
          JSON.stringify({
            id: items[items.length - 1]!.id,
          })
        ).toString('base64')
      : null;

  return {
    items: formattedUsers,
    hasMore,
    nextCursor,
  };
}

/**
 * Search symbols by ticker and name
 */
async function searchSymbols(query: string, limit: number, cursor?: string) {
  let whereClause: any = {
    OR: [
      {
        ticker: {
          contains: query.toUpperCase(),
          mode: 'insensitive',
        },
      },
    ],
  };

  // Handle cursor for pagination
  if (cursor) {
    try {
      const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
      whereClause.id = {
        lt: cursorData.id,
      };
    } catch (error) {
      // Invalid cursor, ignore
    }
  }

  const symbols = await prisma.symbol.findMany({
    where: whereClause,
    include: {
      _count: {
        select: {
          posts: true,
        },
      },
    },
    orderBy: {
      ticker: 'asc',
    },
    take: limit + 1,
  });

  const hasMore = symbols.length > limit;
  const items = hasMore ? symbols.slice(0, -1) : symbols;

  const formattedSymbols = items.map((symbol: any) => {
    const rank = calculateTextRelevance(symbol.ticker, query);

    return {
      id: symbol.id,
      ticker: symbol.ticker,
      name: symbol.ticker, // Using ticker as name since we don't have company names
      kind: symbol.kind,
      exchange: symbol.exchange,
      price: null, // Would need external API for real-time prices
      change24h: null,
      marketCap: null,
      mentionCount: symbol._count.posts,
      rank,
      highlights: {
        ticker: extractHighlights(symbol.ticker, query),
        name: extractHighlights(symbol.ticker, query),
      },
    };
  });

  // Sort by rank (descending)
  formattedSymbols.sort((a: any, b: any) => b.rank - a.rank);

  const nextCursor =
    hasMore && items.length > 0
      ? Buffer.from(
          JSON.stringify({
            id: items[items.length - 1]!.id,
          })
        ).toString('base64')
      : null;

  return {
    items: formattedSymbols,
    hasMore,
    nextCursor,
  };
}

/**
 * Calculate text relevance score
 */
function calculateTextRelevance(content: string, query: string): number {
  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();

  // Exact match gets highest score
  if (contentLower === queryLower) {
    return 1.0;
  }

  // Contains match
  if (contentLower.includes(queryLower)) {
    const position = contentLower.indexOf(queryLower);
    return position === 0 ? 0.9 : 0.7; // Beginning match is better
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
  return Math.min(wordMatchScore * 0.5, 0.6);
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
