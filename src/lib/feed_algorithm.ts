import {
  FEED_INITIAL_REACTION_WEIGHT,
  FEED_RECENT_REACTION_WINDOW,
  FEED_SYMBOL_MATCH_WEIGHT,
  FEED_TIME_DECAY_WEIGHT,
} from '../config/env';
import prisma from './prisma';

/**
 * Calculate initial reaction score with recency boost
 */
export function calculateInitialReactionScore(
  createdAt: Date,
  reactionCounts: { LIKE: number; BOOST: number; BOOKMARK: number }
): number {
  const { LIKE, BOOST, BOOKMARK } = reactionCounts;

  // Base reaction score
  const baseScore =
    LIKE * FEED_INITIAL_REACTION_WEIGHT +
    BOOST * FEED_INITIAL_REACTION_WEIGHT +
    BOOKMARK * FEED_INITIAL_REACTION_WEIGHT;

  // Early reaction boost (reactions within first 2 hours get extra weight)
  const postAge = Date.now() - createdAt.getTime();
  const isEarlyReaction = postAge <= FEED_RECENT_REACTION_WINDOW;
  const earlyBoost = isEarlyReaction ? 1.5 : 1.0;

  // Normalize by typical reaction counts (log scale to prevent outliers)
  const normalizedScore = Math.log(baseScore + 1) * earlyBoost;

  return Number(normalizedScore.toFixed(4));
}

/**
 * Calculate time decay factor based on post age
 */
export function calculateTimeDecay(createdAt: Date): number {
  const ageInHours = (Date.now() - createdAt.getTime()) / (60 * 60 * 1000);
  // Exponential decay: score decreases by half every 6 hours
  return Math.exp(-ageInHours / 6);
}

/**
 * Calculate symbol match bonus for user interests
 */
export function calculateSymbolMatchBonus(
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
 * Calculate For You algorithm score
 */
export function calculateForYouScore(
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
    FEED_INITIAL_REACTION_WEIGHT * initialReactionScore +
    FEED_TIME_DECAY_WEIGHT * timeDecayScore +
    FEED_SYMBOL_MATCH_WEIGHT * symbolMatchScore;

  return Number(finalScore.toFixed(4));
}

/**
 * Get user's interest symbols based on their recent interactions
 */
export async function getUserInterestSymbols(
  userId: number
): Promise<string[]> {
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
