/**
 * Feed API router
 * Provides personalized and following feeds with advanced ranking algorithms
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { authenticateToken } from '../middleware/auth';

const router = Router();

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
  authenticateToken,
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
  _userId: number,
  cursor?: string,
  limit: number = 20
) {
  // Mock implementation - would use actual database queries
  const mockPosts = Array.from({ length: limit }, (_, i) => {
    const postId = cursor ? parseInt(cursor) + i + 1 : i + 1;
    return {
      id: postId,
      text: `Following feed post ${postId} from user I follow. Mentions $MSFT and ADA!`,
      media: [],
      userId: Math.floor(Math.random() * 5) + 10, // Mock followed user IDs
      createdAt: new Date(
        Date.now() - (cursor ? parseInt(cursor) * 1000 : 0) - i * 600000
      ), // 10 min intervals
      author: {
        id: Math.floor(Math.random() * 5) + 10,
        handle: `followed_user_${Math.floor(Math.random() * 5) + 1}`,
      },
      symbols: [
        { raw: '$MSFT', ticker: 'MSFT', kind: 'STOCK' },
        { raw: 'ADA', ticker: 'ADA', kind: 'CRYPTO' },
      ],
      reactionCounts: {
        LIKE: Math.floor(Math.random() * 15),
        BOOST: Math.floor(Math.random() * 8),
        BOOKMARK: Math.floor(Math.random() * 10),
      },
      isFollowing: true,
    };
  });

  // Simple cursor-based pagination for following feed
  const nextCursor =
    mockPosts.length === limit && mockPosts.length > 0
      ? String(mockPosts[mockPosts.length - 1]!.createdAt.getTime())
      : null;

  return { posts: mockPosts, nextCursor };
}

/**
 * Get For You feed with algorithmic ranking
 */
async function getForYouFeed(
  _userId: number,
  cursor?: string,
  limit: number = 20
) {
  // Mock user interests (would be fetched from user profile/history)
  const userInterestSymbols = ['TSLA', 'BTC', 'ETH', 'AAPL', 'NVDA'];

  // Generate mock posts with various characteristics
  const mockPosts = Array.from({ length: limit * 2 }, (_, i) => {
    const postId = cursor ? parseInt(cursor) + i + 1 : i + 1;
    const createdAt = new Date(
      Date.now() - Math.random() * FEED_PARAMS.MAX_POST_AGE
    );
    const symbols = generateRandomSymbols();

    // Calculate reaction metrics
    const totalReactions = Math.floor(Math.random() * 50);
    const reactionCounts = {
      LIKE: Math.floor(totalReactions * 0.6),
      BOOST: Math.floor(totalReactions * 0.2),
      BOOKMARK: Math.floor(totalReactions * 0.2),
    };

    // Calculate algorithm score
    const score = calculateForYouScore(
      createdAt,
      reactionCounts,
      symbols,
      userInterestSymbols
    );

    return {
      id: postId,
      text: `For You post ${postId}: Discussing ${symbols.map(s => s.raw).join(', ')} trends!`,
      media: [],
      userId: Math.floor(Math.random() * 20) + 1,
      createdAt,
      author: {
        id: Math.floor(Math.random() * 20) + 1,
        handle: `user_${Math.floor(Math.random() * 20) + 1}`,
      },
      symbols,
      reactionCounts,
      score, // Internal scoring for sorting
      scoreBreakdown: {
        initialReactionScore: calculateInitialReactionScore(
          createdAt,
          reactionCounts
        ),
        timeDecayScore: calculateTimeDecay(createdAt),
        symbolMatchScore: calculateSymbolMatchBonus(
          symbols.map(s => s.ticker),
          userInterestSymbols
        ),
        totalScore: score,
      },
    };
  });

  // Sort by algorithmic score (descending)
  mockPosts.sort((a, b) => b.score - a.score);

  // Take only the requested limit
  const selectedPosts = mockPosts.slice(0, limit);

  // Cursor for pagination (use score + timestamp for stable pagination)
  const nextCursor =
    selectedPosts.length === limit && selectedPosts.length > 0
      ? `${selectedPosts[selectedPosts.length - 1]!.score}_${selectedPosts[selectedPosts.length - 1]!.createdAt.getTime()}`
      : null;

  return { posts: selectedPosts, nextCursor };
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
function generateRandomSymbols() {
  const allSymbols = [
    { raw: '$TSLA', ticker: 'TSLA', kind: 'STOCK' },
    { raw: '$AAPL', ticker: 'AAPL', kind: 'STOCK' },
    { raw: '$NVDA', ticker: 'NVDA', kind: 'STOCK' },
    { raw: '$MSFT', ticker: 'MSFT', kind: 'STOCK' },
    { raw: 'BTC', ticker: 'BTC', kind: 'CRYPTO' },
    { raw: 'ETH', ticker: 'ETH', kind: 'CRYPTO' },
    { raw: 'ADA', ticker: 'ADA', kind: 'CRYPTO' },
    { raw: 'SOL', ticker: 'SOL', kind: 'CRYPTO' },
    { raw: '005930.KS', ticker: '005930', kind: 'STOCK', exchange: 'KS' },
  ];

  const count = Math.floor(Math.random() * 3) + 1; // 1-3 symbols per post
  const shuffled = allSymbols.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/**
 * GET /feed/debug
 * Debug endpoint to understand algorithm scoring
 */
router.get(
  '/debug',
  authenticateToken,
  asyncHandler(async (_req, res) => {
    const userInterestSymbols = ['TSLA', 'BTC', 'ETH', 'AAPL', 'NVDA'];

    // Generate a few sample posts with detailed scoring
    const samplePosts = Array.from({ length: 5 }, (_, i) => {
      const createdAt = new Date(Date.now() - i * 2 * 60 * 60 * 1000); // 2 hours apart
      const symbols = generateRandomSymbols();
      const reactionCounts = {
        LIKE: Math.floor(Math.random() * 20),
        BOOST: Math.floor(Math.random() * 10),
        BOOKMARK: Math.floor(Math.random() * 8),
      };

      const initialReactionScore = calculateInitialReactionScore(
        createdAt,
        reactionCounts
      );
      const timeDecayScore = calculateTimeDecay(createdAt);
      const symbolMatchScore = calculateSymbolMatchBonus(
        symbols.map(s => s.ticker),
        userInterestSymbols
      );
      const totalScore = calculateForYouScore(
        createdAt,
        reactionCounts,
        symbols,
        userInterestSymbols
      );

      return {
        id: i + 1,
        text: `Debug post ${i + 1}`,
        createdAt,
        symbols,
        reactionCounts,
        algorithm: {
          userInterests: userInterestSymbols,
          symbolsInPost: symbols.map(s => s.ticker),
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
      (a, b) => b.algorithm.scores.total - a.algorithm.scores.total
    );

    res.json({
      message: 'Feed algorithm debug information',
      parameters: FEED_PARAMS,
      samplePosts,
    });
  })
);

export default router;
