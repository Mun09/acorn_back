/**
 * Feed API router
 * Provides personalized and following feeds with advanced ranking algorithms
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { readOnlyRateLimit } from '../middleware/rateLimit';
import { prisma } from '../../lib/prisma';
import {
  calculateForYouScore,
  calculateInitialReactionScore,
  calculateSymbolMatchBonus,
  calculateTimeDecay,
  getUserInterestSymbols,
} from '../../lib/feed_algorithm';
import {
  FEED_INITIAL_REACTION_WEIGHT,
  FEED_MAX_POST_AGE,
  FEED_RECENT_REACTION_WINDOW,
  FEED_SYMBOL_MATCH_WEIGHT,
  FEED_TIME_DECAY_WEIGHT,
} from '../../config/env';

const router: Router = Router();

// Validation schemas
const feedQuerySchema = z.object({
  mode: z.enum(['for_you', 'following']).default('for_you'),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// Validation helper
function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.error.message}`);
  }
  return result.data;
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
  const cutoffTime = new Date(Date.now() - FEED_MAX_POST_AGE);

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
    where: {
      ...whereClause,
      replyTo: null, // Exclude posts that are replies to other posts
    },
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
            alpha: FEED_INITIAL_REACTION_WEIGHT,
            beta: FEED_TIME_DECAY_WEIGHT,
            gamma: FEED_SYMBOL_MATCH_WEIGHT,
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
      parameters: {
        initialReactionWeight: FEED_INITIAL_REACTION_WEIGHT,
        timeDecayWeight: FEED_TIME_DECAY_WEIGHT,
        symbolMatchWeight: FEED_SYMBOL_MATCH_WEIGHT,
        recentReactionWindow: FEED_RECENT_REACTION_WINDOW,
        maxPostAge: FEED_MAX_POST_AGE,
      },
      samplePosts,
    });
  })
);

export default router;
