/**
 * Users API router - Real Prisma implementation
 * Simple example of actual database integration
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { authenticateToken, optionalAuth } from '../middleware/auth';
import { prisma } from '../../lib/prisma';

const router = Router();

// Validation schemas
const getUserSchema = z.object({
  handle: z.string().min(1).max(30),
});

/**
 * GET /users/:handle
 * Get user profile by handle (real implementation)
 */
router.get(
  '/:handle',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { handle } = getUserSchema.parse(req.params);
    const currentUserId = req.user?.id;

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { handle },
      select: {
        id: true,
        handle: true,
        email: true,
        bio: true,
        trustScore: true,
        createdAt: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: `User with handle @${handle} does not exist`
      });
    }

    // Check if current user follows this user
    let isFollowing = false;
    if (currentUserId && currentUserId !== user.id) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followeeId: {
            followerId: currentUserId,
            followeeId: user.id,
          }
        }
      });
      isFollowing = !!follow;
    }

    return res.json({
      user: {
        id: user.id,
        handle: user.handle,
        bio: user.bio,
        trustScore: user.trustScore,
        joinedAt: user.createdAt,
        stats: {
          posts: user._count.posts,
          followers: user._count.followers,
          following: user._count.following,
        },
        isFollowing,
      }
    });
  })
);

/**
 * GET /users/:handle/posts
 * Get user's posts (real implementation)
 */
router.get(
  '/:handle/posts',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { handle } = getUserSchema.parse(req.params);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string;

    // Get user
    const user = await prisma.user.findUnique({
      where: { handle },
      select: { id: true }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Get user's posts
    const posts = await prisma.post.findMany({
      where: {
        userId: user.id,
        isHidden: false,
      },
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            bio: true,
          }
        },
        reactions: {
          select: {
            type: true,
            userId: true,
          }
        },
        symbols: {
          include: {
            symbol: true,
          }
        },
        _count: {
          select: {
            reactions: true,
            replies: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit + 1,
      ...(cursor && {
        cursor: { id: parseInt(cursor) },
        skip: 1,
      }),
    });

    const hasMore = posts.length > limit;
    const items = hasMore ? posts.slice(0, -1) : posts;
    const nextCursor = hasMore ? items[items.length - 1].id.toString() : null;

    // Transform posts with reaction counts
    const transformedPosts = items.map(post => {
      const reactionCounts = {
        LIKE: 0,
        BOOST: 0,
        BOOKMARK: 0,
      };

      post.reactions.forEach(reaction => {
        if (reaction.type in reactionCounts) {
          reactionCounts[reaction.type as keyof typeof reactionCounts]++;
        }
      });

      return {
        id: post.id,
        text: post.text,
        media: post.media,
        createdAt: post.createdAt,
        user: post.user,
        reactionCounts,
        replyCount: post._count.replies,
        symbols: post.symbols.map(ps => ps.symbol),
      };
    });

    return res.json({
      posts: transformedPosts,
      hasMore,
      nextCursor,
    });
  })
);

/**
 * POST /users/:handle/follow
 * Follow/unfollow user (real implementation)
 */
router.post(
  '/:handle/follow',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { handle } = getUserSchema.parse(req.params);
    const currentUserId = req.user!.id;

    // Get target user
    const targetUser = await prisma.user.findUnique({
      where: { handle },
      select: { id: true, handle: true }
    });

    if (!targetUser) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    if (targetUser.id === currentUserId) {
      return res.status(400).json({
        error: 'Cannot follow yourself'
      });
    }

    // Check current follow status
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followeeId: {
          followerId: currentUserId,
          followeeId: targetUser.id,
        }
      }
    });

    let action: 'followed' | 'unfollowed';

    if (existingFollow) {
      // Unfollow
      await prisma.follow.delete({
        where: {
          followerId_followeeId: {
            followerId: currentUserId,
            followeeId: targetUser.id,
          }
        }
      });
      action = 'unfollowed';
    } else {
      // Follow
      await prisma.follow.create({
        data: {
          followerId: currentUserId,
          followeeId: targetUser.id,
        }
      });
      action = 'followed';

      // Create notification for follow
      await prisma.notification.create({
        data: {
          userId: targetUser.id,
          kind: 'FOLLOW',
          payload: {
            fromUserId: currentUserId,
            fromHandle: req.user!.handle,
            message: `@${req.user!.handle} started following you`,
          }
        }
      });
    }

    return res.json({
      success: true,
      action,
      user: {
        id: targetUser.id,
        handle: targetUser.handle,
      },
      isFollowing: action === 'followed',
    });
  })
);

export default router;
