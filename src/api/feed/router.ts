/**
 * Feed API router
 * Provides personalized and following feeds with advanced ranking algorithms
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { authenticateToken } from '../middleware/auth';
import { readOnlyRateLimit } from '../middleware/rateLimit';
import { prisma } from '../../lib/prisma';

const router: Router = Router();
router.use(authenticateToken);

// Validation schemas
const feedQuerySchema = z.object({
  mode: z.enum(['for_you', 'following']).default('for_you'),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// Feed algorithm parameters
const FEED_PARAMS = {
  // For You algorithm weights
  INITIAL_REACTION_WEIGHT: 0.4, // α - Early reactions boost
  TIME_DECAY_WEIGHT: 0.3, // β - Time decay factor
  SYMBOL_MATCH_WEIGHT: 0.3, // γ - User interest symbol matching

  // Time windows
  RECENT_REACTION_WINDOW: 2 * 60 * 60 * 1000, // 2 hours for initial reactions
  MAX_POST_AGE: 24 * 60 * 60 * 1000, // 24 hours max age for for_you feed

  // Scoring
  REACTION_SCORES: {
    LIKE: 1,
    BOOST: 3,
    BOOKMARK: 2,
  },
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
 * Calculate time decay factor based on post age
 */
function calculateTimeDecay(createdAt: Date): number {
  const ageInHours = (Date.now() - createdAt.getTime()) / (60 * 60 * 1000);
  // Exponential decay: score decreases by half every 6 hours
  return Math.exp(-ageInHours / 6);
}

/**
 * Calculate symbol match bonus for user interests
 */
function calculateSymbolMatchBonus(
  postSymbols: string[],
  userInterestSymbols: string[]
): number {
  if (userInterestSymbols.length === 0) return 0;

  const matches = postSymbols.filter(symbol =>
    userInterestSymbols.includes(symbol)
  ).length;

  // Bonus ranges from 0 to 1 based on match percentage
  return Math.min(matches / Math.max(userInterestSymbols.length, 1), 1);
}

/**
 * GET /feed
 * Get personalized feed based on mode
 */
router.get(
  '/',
  readOnlyRateLimit, // Lenient rate limiting for feed reads
  asyncHandler(async (req, res) => {
    const { mode, cursor, limit } = validateData(feedQuerySchema, req.query);
    const userId = req.user!.id;

    let posts: any[] = [];
    let nextCursor: string | null = null;

    if (mode === 'following') {
      // Following feed: Posts from followed users in chronological order
      const followingPosts = await getFollowingFeed(userId, cursor, limit);
      posts = followingPosts.posts;
      nextCursor = followingPosts.nextCursor;
    } else {
      // For You feed: Algorithmic feed with scoring
      const forYouPosts = await getForYouFeed(userId, cursor, limit);
      posts = forYouPosts.posts;
      nextCursor = forYouPosts.nextCursor;
    }

    res.json({
      posts,
      nextCursor,
      hasMore: nextCursor !== null,
      mode,
      algorithm:
        mode === 'for_you' ? 'engagement_time_interest' : 'chronological',
    });
  })
);

/**
 * Get following feed (chronological from followed users)
 */
async function getFollowingFeed(
  userId: number,
  cursor?: string,
  limit: number = 20
) {
  // Get posts from users that the current user follows
  let whereClause: any = {
    user: {
      followers: {
        some: {
          followerId: userId,
        },
      },
    },
    isHidden: false,
  };

  // Handle cursor for pagination
  if (cursor) {
    try {
      const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
      whereClause.createdAt = {
        lt: new Date(cursorData.createdAt),
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
    orderBy: {
      createdAt: 'desc',
    },
    take: limit + 1,
  });

  const hasMore = posts.length > limit;
  const resultPosts = hasMore ? posts.slice(0, -1) : posts;

  // Format posts
  const formattedPosts = resultPosts.map((post: any) => {
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

    // Get user's reactions to this post
    const userReactions = post.reactions
      .filter((r: { userId: number }) => r.userId === userId)
      .map((r: { type: string }) => r.type);

    return {
      id: post.id,
      text: post.text,
      media: (post as any).media
        ? JSON.parse((post as any).media as string)
        : [],
      userId: post.userId,
      createdAt: post.createdAt,
      author: {
        id: post.user.id,
        handle: post.user.handle,
        bio: post.user.bio,
        trustScore: post.user.trustScore,
        verifiedFlags: post.user.verifiedFlags,
      },
      symbols: post.symbols.map((ps: any) => ({
        raw: ps.symbol.ticker,
        ticker: ps.symbol.ticker,
        kind: ps.symbol.kind,
        exchange: ps.symbol.exchange,
      })),
      reactionCounts,
      userReactions,
      isFollowing: true, // By definition, these are from followed users
    };
  });

  const nextCursor =
    hasMore && resultPosts.length > 0
      ? Buffer.from(
          JSON.stringify({
            createdAt: resultPosts[resultPosts.length - 1]!.createdAt,
          })
        ).toString('base64')
      : null;

  return { posts: formattedPosts, nextCursor };
}

/**
 * Get For You feed with algorithmic ranking
 */
async function getForYouFeed(
  userId: number,
  cursor?: string,
  limit: number = 20
) {
  // Get user's interest symbols from their recent interactions
  const userInterestSymbols = await getUserInterestSymbols(userId);

  // Get all posts from the last 24 hours for algorithmic ranking
  const cutoffTime = new Date(Date.now() - FEED_PARAMS.MAX_POST_AGE);

  let whereClause: any = {
    createdAt: {
      gte: cutoffTime,
    },
    isHidden: false,
  };

  // Handle cursor for pagination - for algorithmic feed, we use score + timestamp
  if (cursor) {
    try {
      const [scoreStr, timestampStr] = cursor.split('_');
      if (scoreStr && timestampStr) {
        const timestamp = parseInt(timestampStr);

        // Skip posts with higher scores, or same score but newer timestamp
        whereClause.OR = [
          {
            createdAt: {
              lt: new Date(timestamp),
            },
          },
        ];
      }
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
    orderBy: {
      createdAt: 'desc',
    },
    take: Math.min(limit * 3, 100), // Get more posts to rank algorithmically
  });

  // Calculate algorithmic scores for each post
  const scoredPosts = posts.map((post: any) => {
    const reactionCounts = post.reactions.reduce(
      (
        acc: Record<string, number>,
        reaction: { type: string; userId: number }
      ) => {
        acc[reaction.type] = (acc[reaction.type] || 0) + 1;
        return acc;
      },
      { LIKE: 0, BOOST: 0, BOOKMARK: 0 }
    );

    const postSymbols = post.symbols.map((ps: any) => ps.symbol.ticker);

    // Get user's reactions to this post
    const userReactions = post.reactions
      .filter((r: { userId: number }) => r.userId === userId)
      .map((r: { type: string }) => r.type);

    // Calculate algorithm score
    const score = calculateForYouScore(
      post.createdAt,
      reactionCounts,
      post.symbols.map((ps: any) => ({
        ticker: ps.symbol.ticker,
        raw: ps.symbol.ticker,
        kind: ps.symbol.kind,
      })),
      userInterestSymbols
    );

    return {
      id: post.id,
      text: post.text,
      media: (post as any).media
        ? JSON.parse((post as any).media as string)
        : [],
      userId: post.userId,
      createdAt: post.createdAt,
      author: {
        id: post.user.id,
        handle: post.user.handle,
        bio: post.user.bio,
        trustScore: post.user.trustScore,
        verifiedFlags: post.user.verifiedFlags,
      },
      symbols: post.symbols.map((ps: any) => ({
        raw: ps.symbol.ticker,
        ticker: ps.symbol.ticker,
        kind: ps.symbol.kind,
        exchange: ps.symbol.exchange,
      })),
      reactionCounts,
      userReactions,
      score,
      scoreBreakdown: {
        initialReactionScore: calculateInitialReactionScore(
          post.createdAt,
          reactionCounts
        ),
        timeDecayScore: calculateTimeDecay(post.createdAt),
        symbolMatchScore: calculateSymbolMatchBonus(
          postSymbols,
          userInterestSymbols
        ),
        totalScore: score,
      },
    };
  });

  // Sort by algorithmic score (descending)
  scoredPosts.sort((a: any, b: any) => b.score - a.score);

  // Take only the requested limit
  const selectedPosts = scoredPosts.slice(0, limit);

  // Cursor for pagination (use score + timestamp for stable pagination)
  const nextCursor =
    selectedPosts.length === limit && selectedPosts.length > 0
      ? `${selectedPosts[selectedPosts.length - 1]!.score}_${selectedPosts[selectedPosts.length - 1]!.createdAt.getTime()}`
      : null;

  return { posts: selectedPosts, nextCursor };
}

/**
 * Get user's interest symbols based on their recent interactions
 */
async function getUserInterestSymbols(userId: number): Promise<string[]> {
  // Get symbols from user's recent posts and reactions
  const [recentPosts, recentReactions] = await Promise.all([
    // User's recent posts
    prisma.post.findMany({
      where: {
        userId,
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
      include: {
        symbols: {
          include: {
            symbol: true,
          },
        },
      },
      take: 20,
    }),

    // User's recent reactions
    prisma.reaction.findMany({
      where: {
        userId,
      },
      include: {
        post: {
          include: {
            symbols: {
              include: {
                symbol: true,
              },
            },
          },
        },
      },
      take: 50,
    }),
  ]);

  const symbolCounts = new Map<string, number>();

  // Count symbols from user's posts (higher weight)
  recentPosts.forEach((post: any) => {
    post.symbols.forEach((ps: any) => {
      const ticker = ps.symbol.ticker;
      symbolCounts.set(ticker, (symbolCounts.get(ticker) || 0) + 3);
    });
  });

  // Count symbols from reacted posts (lower weight)
  recentReactions.forEach((reaction: any) => {
    reaction.post.symbols.forEach((ps: any) => {
      const ticker = ps.symbol.ticker;
      symbolCounts.set(ticker, (symbolCounts.get(ticker) || 0) + 1);
    });
  });

  // Return top symbols sorted by interest score
  return Array.from(symbolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ticker]) => ticker);
}

/**
 * Calculate For You algorithm score
 */
function calculateForYouScore(
  createdAt: Date,
  reactionCounts: { LIKE: number; BOOST: number; BOOKMARK: number },
  symbols: Array<{ ticker: string; raw: string; kind: string }>,
  userInterestSymbols: string[]
): number {
  // α: Initial reaction score (weighted by reaction type and recency)
  const initialReactionScore = calculateInitialReactionScore(
    createdAt,
    reactionCounts
  );

  // β: Time decay factor
  const timeDecayScore = calculateTimeDecay(createdAt);

  // γ: Symbol interest matching bonus
  const symbolMatchScore = calculateSymbolMatchBonus(
    symbols.map(s => s.ticker),
    userInterestSymbols
  );

  // Weighted combination
  const finalScore =
    FEED_PARAMS.INITIAL_REACTION_WEIGHT * initialReactionScore +
    FEED_PARAMS.TIME_DECAY_WEIGHT * timeDecayScore +
    FEED_PARAMS.SYMBOL_MATCH_WEIGHT * symbolMatchScore;

  return Number(finalScore.toFixed(4));
}

/**
 * Calculate initial reaction score with recency boost
 */
function calculateInitialReactionScore(
  createdAt: Date,
  reactionCounts: { LIKE: number; BOOST: number; BOOKMARK: number }
): number {
  const { LIKE, BOOST, BOOKMARK } = reactionCounts;
  const { REACTION_SCORES } = FEED_PARAMS;

  // Base reaction score
  const baseScore =
    LIKE * REACTION_SCORES.LIKE +
    BOOST * REACTION_SCORES.BOOST +
    BOOKMARK * REACTION_SCORES.BOOKMARK;

  // Early reaction boost (reactions within first 2 hours get extra weight)
  const postAge = Date.now() - createdAt.getTime();
  const isEarlyReaction = postAge <= FEED_PARAMS.RECENT_REACTION_WINDOW;
  const earlyBoost = isEarlyReaction ? 1.5 : 1.0;

  // Normalize by typical reaction counts (log scale to prevent outliers)
  const normalizedScore = Math.log(baseScore + 1) * earlyBoost;

  return Number(normalizedScore.toFixed(4));
}

/**
 * Generate random symbols for mock posts
 */
/**
 * GET /feed/debug
 * Debug endpoint to understand algorithm scoring
 */
router.get(
  '/debug',
  readOnlyRateLimit, // Lenient rate limiting for debug endpoint
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const userInterestSymbols = await getUserInterestSymbols(userId);

    // Get a few recent posts with detailed scoring
    const recentPosts = await prisma.post.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
        isHidden: false,
      },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
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
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    });

    const samplePosts = recentPosts.map((post: any) => {
      const reactionCounts = post.reactions.reduce(
        (acc: Record<string, number>, reaction: { type: string }) => {
          acc[reaction.type] = (acc[reaction.type] || 0) + 1;
          return acc;
        },
        { LIKE: 0, BOOST: 0, BOOKMARK: 0 }
      );

      const postSymbols = post.symbols.map((ps: any) => ps.symbol.ticker);

      const initialReactionScore = calculateInitialReactionScore(
        post.createdAt,
        reactionCounts
      );
      const timeDecayScore = calculateTimeDecay(post.createdAt);
      const symbolMatchScore = calculateSymbolMatchBonus(
        postSymbols,
        userInterestSymbols
      );
      const totalScore = calculateForYouScore(
        post.createdAt,
        reactionCounts,
        post.symbols.map((ps: any) => ({
          ticker: ps.symbol.ticker,
          raw: ps.symbol.ticker,
          kind: ps.symbol.kind,
        })),
        userInterestSymbols
      );

      return {
        id: post.id,
        text:
          post.text.substring(0, 100) + (post.text.length > 100 ? '...' : ''),
        author: post.user.handle,
        createdAt: post.createdAt,
        symbols: post.symbols.map((ps: any) => ({
          ticker: ps.symbol.ticker,
          kind: ps.symbol.kind,
        })),
        reactionCounts,
        algorithm: {
          userInterests: userInterestSymbols,
          symbolsInPost: postSymbols,
          scores: {
            initialReaction: initialReactionScore,
            timeDecay: timeDecayScore,
            symbolMatch: symbolMatchScore,
            total: totalScore,
          },
          weights: {
            alpha: FEED_PARAMS.INITIAL_REACTION_WEIGHT,
            beta: FEED_PARAMS.TIME_DECAY_WEIGHT,
            gamma: FEED_PARAMS.SYMBOL_MATCH_WEIGHT,
          },
        },
      };
    });

    // Sort by score
    samplePosts.sort(
      (a: any, b: any) => b.algorithm.scores.total - a.algorithm.scores.total
    );

    res.json({
      message: 'Feed algorithm debug information',
      userId,
      userInterestSymbols,
      parameters: FEED_PARAMS,
      samplePosts,
    });
  })
);

export default router;
