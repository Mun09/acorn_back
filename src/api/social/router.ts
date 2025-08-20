/**
 * Social API router
 * Handles follow/unfollow, notifications, and social interactions
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { authenticateToken } from '../middleware/auth';
import { extractMentionsFromText, getUniqueHandles } from '../../lib/mentions';
import { prisma } from '../../lib/prisma';

const router = Router();

// Validation schemas
const followParamsSchema = z.object({
  handle: z.string().min(3).max(30),
});

const notificationParamsSchema = z.object({
  id: z.coerce.number().positive(),
});

const notificationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  type: z.enum(['MENTION', 'REPLY', 'REACTION', 'FOLLOW']).optional(),
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
 * POST /follow/:handle
 * Toggle follow/unfollow for a user by handle
 */
router.post(
  '/follow/:handle',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { handle } = validateData(followParamsSchema, req.params);
    const currentUserId = req.user!.id;

    // Mock implementation - would use actual database
    // Check if target user exists
    const targetUser = await findUserByHandle(handle);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.id === currentUserId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    // Check current follow status
    const isCurrentlyFollowing = await checkFollowStatus(
      currentUserId,
      targetUser.id
    );

    let action: 'followed' | 'unfollowed';

    if (isCurrentlyFollowing) {
      // Unfollow
      await unfollowUser(currentUserId, targetUser.id);
      action = 'unfollowed';
    } else {
      // Follow
      await followUser(currentUserId, targetUser.id);
      action = 'followed';

      // Create follow notification
      await createNotification({
        type: 'FOLLOW',
        userId: targetUser.id,
        fromUserId: currentUserId,
        relatedEntityId: null,
        message: `@${req.user!.handle} started following you`,
      });
    }

    return res.json({
      success: true,
      action,
      user: {
        id: targetUser.id,
        handle: targetUser.handle,
        displayName: targetUser.handle, // Use handle as display name
      },
      isFollowing: action === 'followed',
    });
  })
);

/**
 * GET /notifications
 * Get user's notifications with pagination
 */
router.get(
  '/notifications',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { cursor, limit, type } = validateData(
      notificationQuerySchema,
      req.query
    );
    const userId = req.user!.id;

    const notifications = await getNotifications(userId, {
      cursor,
      limit,
      type,
    });

    return res.json({
      notifications: notifications.items,
      nextCursor: notifications.nextCursor,
      hasMore: notifications.hasMore,
      unreadCount: await getUnreadNotificationCount(userId),
    });
  })
);

/**
 * POST /notifications/:id/read
 * Mark a notification as read
 */
router.post(
  '/notifications/:id/read',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { id } = validateData(notificationParamsSchema, req.params);
    const userId = req.user!.id;

    const notification = await getNotificationById(id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.userId !== userId) {
      return res
        .status(403)
        .json({ error: 'Not authorized to mark this notification as read' });
    }

    if (notification.readAt) {
      return res
        .status(400)
        .json({ error: 'Notification already marked as read' });
    }

    await markNotificationAsRead(id);

    return res.json({
      success: true,
      notification: {
        id: notification.id,
        readAt: new Date().toISOString(),
      },
    });
  })
);

// Real database functions using Prisma

async function findUserByHandle(handle: string) {
  return await prisma.user.findUnique({
    where: { handle },
    select: {
      id: true,
      handle: true,
      email: true,
      bio: true,
    },
  });
}

async function checkFollowStatus(
  followerId: number,
  followingId: number
): Promise<boolean> {
  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followeeId: {
        followerId,
        followeeId: followingId,
      },
    },
  });
  return !!follow;
}

async function followUser(
  followerId: number,
  followingId: number
): Promise<void> {
  await prisma.follow.create({
    data: {
      followerId,
      followeeId: followingId,
    },
  });
}

async function unfollowUser(
  followerId: number,
  followingId: number
): Promise<void> {
  await prisma.follow.delete({
    where: {
      followerId_followeeId: {
        followerId,
        followeeId: followingId,
      },
    },
  });
}

interface NotificationData {
  type: 'MENTION' | 'REPLY' | 'REACTION' | 'FOLLOW';
  userId: number;
  fromUserId: number;
  relatedEntityId: number | null;
  message: string;
}

async function createNotification(data: NotificationData): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: data.userId,
      kind: data.type,
      payload: {
        fromUserId: data.fromUserId,
        relatedEntityId: data.relatedEntityId,
        message: data.message,
      },
    },
  });
}

interface GetNotificationsOptions {
  cursor?: string | undefined;
  limit: number;
  type?: 'MENTION' | 'REPLY' | 'REACTION' | 'FOLLOW' | undefined;
}

async function getNotifications(
  userId: number,
  options: GetNotificationsOptions
) {
  let whereClause: any = {
    userId,
  };

  if (options.type) {
    whereClause.kind = options.type;
  }

  let cursorClause: any = {};
  if (options.cursor) {
    try {
      const cursorData = JSON.parse(
        Buffer.from(options.cursor, 'base64').toString()
      );
      cursorClause = {
        id: {
          lt: cursorData.id,
        },
      };
    } catch (error) {
      // Invalid cursor, ignore
    }
  }

  whereClause = { ...whereClause, ...cursorClause };

  const notifications = await prisma.notification.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    take: options.limit + 1,
    include: {
      user: {
        select: {
          id: true,
          handle: true,
        },
      },
    },
  });

  const hasMore = notifications.length > options.limit;
  const items = hasMore ? notifications.slice(0, -1) : notifications;

  const formattedItems = await Promise.all(
    items.map(async (notification: any) => {
      const payload = notification.payload as any;

      // Get the fromUser information if fromUserId exists
      let fromUser = null;
      if (payload.fromUserId) {
        const user = await prisma.user.findUnique({
          where: { id: payload.fromUserId },
          select: {
            id: true,
            handle: true,
          },
        });

        if (user) {
          fromUser = {
            handle: user.handle,
            displayName: user.handle,
          };
        }
      }

      return {
        id: notification.id,
        type: notification.kind,
        userId: notification.userId,
        fromUserId: payload.fromUserId,
        fromUser,
        message: payload.message,
        relatedEntityId: payload.relatedEntityId,
        readAt: notification.readAt?.toISOString() || null,
        createdAt: notification.createdAt.toISOString(),
      };
    })
  );

  const nextCursor =
    hasMore && items.length > 0
      ? Buffer.from(
          JSON.stringify({
            id: items[items.length - 1]!.id,
            createdAt: items[items.length - 1]!.createdAt,
          })
        ).toString('base64')
      : null;

  return {
    items: formattedItems,
    nextCursor,
    hasMore,
  };
}

async function getUnreadNotificationCount(userId: number): Promise<number> {
  return await prisma.notification.count({
    where: {
      userId,
      readAt: null,
    },
  });
}

async function getNotificationById(id: number) {
  return await prisma.notification.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      kind: true,
      payload: true,
      readAt: true,
      createdAt: true,
    },
  });
}

async function markNotificationAsRead(id: number): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: {
      readAt: new Date(),
    },
  });
}

/**
 * Utility function to create mention notifications
 * Called when creating posts/comments with mentions
 */
export async function createMentionNotifications(
  text: string,
  fromUserId: number,
  fromUserHandle: string,
  relatedEntityId: number,
  entityType: 'post' | 'comment' = 'post'
): Promise<void> {
  const mentions = extractMentionsFromText(text);
  const uniqueHandles = getUniqueHandles(mentions);

  for (const handle of uniqueHandles) {
    const mentionedUser = await findUserByHandle(handle);
    if (mentionedUser && mentionedUser.id !== fromUserId) {
      await createNotification({
        type: 'MENTION',
        userId: mentionedUser.id,
        fromUserId,
        relatedEntityId,
        message: `@${fromUserHandle} mentioned you in a ${entityType}`,
      });
    }
  }
}

/**
 * Utility function to create reply notifications
 */
export async function createReplyNotification(
  originalPostUserId: number,
  fromUserId: number,
  fromUserHandle: string,
  relatedEntityId: number
): Promise<void> {
  if (originalPostUserId !== fromUserId) {
    await createNotification({
      type: 'REPLY',
      userId: originalPostUserId,
      fromUserId,
      relatedEntityId,
      message: `@${fromUserHandle} replied to your post`,
    });
  }
}

/**
 * Utility function to create reaction notifications
 */
export async function createReactionNotification(
  postUserId: number,
  fromUserId: number,
  fromUserHandle: string,
  relatedEntityId: number,
  reactionType: string
): Promise<void> {
  if (postUserId !== fromUserId) {
    await createNotification({
      type: 'REACTION',
      userId: postUserId,
      fromUserId,
      relatedEntityId,
      message: `@${fromUserHandle} ${reactionType.toLowerCase()}d your post`,
    });
  }
}

export default router;
