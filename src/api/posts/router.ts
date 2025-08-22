import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticateToken, optionalAuth } from '../middleware/auth';
import {
  postRateLimit,
  readOnlyRateLimit,
  generalRateLimit,
} from '../middleware/rateLimit';
import { logger } from '../../lib/logger';
import { extractSymbolsFromText } from '../../lib/symbols';
import {
  createMentionNotifications,
  createReactionNotification,
} from '../social/router';

const router = Router();

// Post creation schema
const createPostSchema = z.object({
  text: z.string().min(1).max(280),
  media: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum(['image', 'video']),
      })
    )
    .optional(),
});

// React to post schema
const reactToPostSchema = z.object({
  type: z.enum(['LIKE', 'BOOKMARK', 'BOOST']),
});

// Query schema for feed
const feedQuerySchema = z.object({
  mode: z.enum(['new', 'hot']).default('new'),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

/**
 * POST /posts
 * Create a new post with symbol parsing
 */
router.post('/', postRateLimit, authenticateToken, async (req, res) => {
  try {
    const { text, media } = createPostSchema.parse(req.body);
    const userId = req.user!.id;

    // Extract symbols from text
    const extractedSymbols = extractSymbolsFromText(text);

    // Use transaction for atomic operations
    const result = await prisma.$transaction(async (tx: any) => {
      // Create the post
      const post = await tx.post.create({
        data: {
          userId,
          text,
          media: media ? JSON.stringify(media) : null,
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
        },
      });

      // Process symbols if any were found
      if (extractedSymbols.length > 0) {
        // 기존 심볼과만 연결 (새로운 심볼은 생성하지 않음)
        for (const extractedSymbol of extractedSymbols) {
          const existingSymbol = await tx.symbol.findFirst({
            where: {
              ticker: extractedSymbol.ticker,
            },
          });

          // 기존 심볼이 있을 때만 연결
          if (existingSymbol) {
            await tx.postSymbol.create({
              data: {
                postId: post.id,
                symbolId: existingSymbol.id,
              },
            });
          }
        }
      }

      return post;
    });

    // Create mention notifications after transaction
    await createMentionNotifications(
      text,
      userId,
      req.user!.handle,
      result.id,
      'post'
    );

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error creating post:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.issues,
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to create post',
    });
  }
});

/**
 * GET /posts/:id
 * Get post details with author and reaction counts
 */
router.get('/:id', readOnlyRateLimit, optionalAuth, async (req, res) => {
  try {
    const postId = parseInt(req.params['id']!);

    if (isNaN(postId)) {
      return res.status(400).json({
        error: 'Invalid post ID',
      });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
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
    });

    if (!post) {
      return res.status(404).json({
        error: 'Post not found',
      });
    }

    // Calculate reaction counts by type
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

    // Check if current user has reacted
    const userReactions = req.user
      ? post.reactions
          .filter(
            (r: { userId: number; type: string }) => r.userId === req.user!.id
          )
          .map((r: { type: string }) => r.type)
      : [];

    const result = {
      ...post,
      media: (post as any).media
        ? JSON.parse((post as any).media as string)
        : null,
      reactionCounts,
      userReactions,
      reactions: undefined, // Remove raw reactions array
    };

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error fetching post:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch post',
    });
  }
});

/**
 * GET /posts
 * Get posts feed with infinite scroll
 * mode=new: Order by creation time
 * mode=hot: Order by reaction score with time decay (last 24h)
 */
router.get('/', readOnlyRateLimit, optionalAuth, async (req, res) => {
  try {
    const { mode, cursor, limit } = feedQuerySchema.parse(req.query);

    let whereClause: any = {
      isHidden: false,
    };

    let orderByClause: any;
    let cursorClause: any = {};

    if (cursor) {
      const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());

      if (mode === 'new') {
        cursorClause = {
          id: {
            lt: cursorData.id,
          },
        };
      } else if (mode === 'hot') {
        // For hot mode, we'll use creation time as cursor for simplicity
        // In production, you might want a more sophisticated cursor
        cursorClause = {
          createdAt: {
            lt: new Date(cursorData.createdAt),
          },
        };
      }
    }

    whereClause = { ...whereClause, ...cursorClause };

    if (mode === 'new') {
      orderByClause = {
        createdAt: 'desc',
      };
    } else if (mode === 'hot') {
      // For hot mode, we'll use a raw query to calculate hot score
      // This is a simplified version - in production you'd want more sophisticated scoring
      const hotPosts = (await prisma.$queryRaw`
        SELECT 
          p.*,
          (
            COALESCE(reaction_counts.like_count, 0) * 1.0 +
            COALESCE(reaction_counts.boost_count, 0) * 2.0 +
            COALESCE(reaction_counts.bookmark_count, 0) * 0.5
          ) * EXP(-EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 86400.0) as hot_score
        FROM posts p
        LEFT JOIN (
          SELECT 
            "postId",
            COUNT(CASE WHEN type = 'LIKE' THEN 1 END) as like_count,
            COUNT(CASE WHEN type = 'BOOST' THEN 1 END) as boost_count,
            COUNT(CASE WHEN type = 'BOOKMARK' THEN 1 END) as bookmark_count
          FROM reactions
          WHERE "createdAt" > NOW() - INTERVAL '24 hours'
          GROUP BY "postId"
        ) reaction_counts ON p.id = reaction_counts."postId"
        WHERE p."isHidden" = false
          ${cursor ? `AND p."createdAt" < '${JSON.parse(Buffer.from(cursor, 'base64').toString()).createdAt}'` : ''}
        ORDER BY hot_score DESC, p."createdAt" DESC
        LIMIT ${limit + 1}
      `) as any[];

      const hasNextPage = hotPosts.length > limit;
      const posts = hasNextPage ? hotPosts.slice(0, -1) : hotPosts;

      // Get additional data for each post
      const enrichedPosts = await Promise.all(
        posts.map(async (post: any) => {
          const fullPost = await prisma.post.findUnique({
            where: { id: post.id },
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
          });

          if (!fullPost) return null;

          const reactionCounts = fullPost.reactions.reduce(
            (
              acc: Record<string, number>,
              reaction: { type: string; userId: number }
            ) => {
              acc[reaction.type] = (acc[reaction.type] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );

          const userReactions = req.user
            ? fullPost.reactions
                .filter(
                  (r: { userId: number; type: string }) =>
                    r.userId === req.user!.id
                )
                .map((r: { type: string }) => r.type)
            : [];

          return {
            ...fullPost,
            media: (fullPost as any).media
              ? JSON.parse((fullPost as any).media as string)
              : null,
            reactionCounts,
            userReactions,
            reactions: undefined,
            hotScore: post.hot_score,
          };
        })
      );

      const validPosts = enrichedPosts.filter(Boolean);

      const nextCursor =
        hasNextPage && validPosts.length > 0
          ? Buffer.from(
              JSON.stringify({
                id: validPosts[validPosts.length - 1]!.id,
                createdAt: validPosts[validPosts.length - 1]!.createdAt,
              })
            ).toString('base64')
          : null;

      return res.json({
        success: true,
        data: validPosts,
        nextCursor,
        hasNextPage,
      });
    }

    // For 'new' mode, use standard Prisma query
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
      orderBy: orderByClause,
      take: limit + 1,
    });

    const hasNextPage = posts.length > limit;
    const resultPosts = hasNextPage ? posts.slice(0, -1) : posts;

    const enrichedPosts = resultPosts.map((post: any) => {
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

      const userReactions = req.user
        ? post.reactions
            .filter(
              (r: { userId: number; type: string }) => r.userId === req.user!.id
            )
            .map((r: { type: string }) => r.type)
        : [];

      return {
        ...post,
        media: (post as any).media
          ? JSON.parse((post as any).media as string)
          : null,
        reactionCounts,
        userReactions,
        reactions: undefined,
      };
    });

    const nextCursor =
      hasNextPage && resultPosts.length > 0
        ? Buffer.from(
            JSON.stringify({
              id: resultPosts[resultPosts.length - 1]!.id,
              createdAt: resultPosts[resultPosts.length - 1]!.createdAt,
            })
          ).toString('base64')
        : null;

    return res.json({
      success: true,
      data: enrichedPosts,
      nextCursor,
      hasNextPage,
    });
  } catch (error) {
    logger.error('Error fetching posts feed:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.issues,
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch posts feed',
    });
  }
});

/**
 * POST /posts/:id/react
 * Toggle reaction on a post (LIKE, BOOKMARK, BOOST)
 */
router.post(
  '/:id/react',
  generalRateLimit,
  authenticateToken,
  async (req, res) => {
    try {
      const postId = parseInt(req.params['id']!);
      const { type } = reactToPostSchema.parse(req.body);
      const userId = req.user!.id;

      if (isNaN(postId)) {
        return res.status(400).json({
          error: 'Invalid post ID',
        });
      }

      // Check if post exists
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true },
      });

      if (!post) {
        return res.status(404).json({
          error: 'Post not found',
        });
      }

      // Check if reaction already exists
      const existingReaction = await prisma.reaction.findUnique({
        where: {
          postId_userId_type: {
            postId,
            userId,
            type,
          },
        },
      });

      let action: 'added' | 'removed';

      if (existingReaction) {
        // Remove existing reaction (toggle off)
        await prisma.reaction.delete({
          where: {
            id: existingReaction.id,
          },
        });
        action = 'removed';
      } else {
        // Add new reaction (toggle on)
        await prisma.reaction.create({
          data: {
            postId,
            userId,
            type,
          },
        });
        action = 'added';

        // Create reaction notification
        const postOwner = await prisma.post.findUnique({
          where: { id: postId },
          select: { userId: true },
        });

        if (postOwner) {
          await createReactionNotification(
            postOwner.userId,
            userId,
            req.user!.handle,
            postId,
            type
          );
        }
      }

      // Get updated reaction counts
      const reactionCounts = await prisma.reaction.groupBy({
        by: ['type'],
        where: { postId },
        _count: { type: true },
      });

      const counts = reactionCounts.reduce(
        (
          acc: Record<string, number>,
          group: { type: string; _count: { type: number } }
        ) => {
          acc[group.type] = group._count.type;
          return acc;
        },
        {} as Record<string, number>
      );

      return res.json({
        success: true,
        data: {
          action,
          type,
          reactionCounts: counts,
        },
      });
    } catch (error) {
      logger.error('Error toggling reaction:', error);

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      }

      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to toggle reaction',
      });
    }
  }
);

export default router;
