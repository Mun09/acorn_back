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
        displayName: targetUser.displayName,
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
    }
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
      }
    }
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
    }
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
      }
    }
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
  // Mock notification creation
  console.log('Creating notification:', data);
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
  // Mock notifications
  const mockNotifications = Array.from(
    { length: Math.min(options.limit, 10) },
    (_, i) => {
      const types = ['MENTION', 'REPLY', 'REACTION', 'FOLLOW'] as const;
      const type =
        options.type || types[Math.floor(Math.random() * types.length)]!;

      return {
        id: i + 1,
        type,
        userId,
        fromUserId: Math.floor(Math.random() * 10) + 1,
        fromUser: {
          handle: `user${Math.floor(Math.random() * 10) + 1}`,
          displayName: `User ${Math.floor(Math.random() * 10) + 1}`,
        },
        message: getNotificationMessage(type),
        relatedEntityId:
          type !== 'FOLLOW' ? Math.floor(Math.random() * 100) + 1 : null,
        readAt: Math.random() > 0.6 ? new Date().toISOString() : null,
        createdAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      };
    }
  );

  return {
    items: mockNotifications,
    nextCursor:
      mockNotifications.length === options.limit
        ? `cursor_${Date.now()}`
        : null,
    hasMore: mockNotifications.length === options.limit,
  };
}

function getNotificationMessage(type: string): string {
  switch (type) {
    case 'MENTION':
      return 'mentioned you in a post';
    case 'REPLY':
      return 'replied to your post';
    case 'REACTION':
      return 'reacted to your post';
    case 'FOLLOW':
      return 'started following you';
    default:
      return 'interacted with you';
  }
}

async function getUnreadNotificationCount(_userId: number): Promise<number> {
  // Mock unread count
  return Math.floor(Math.random() * 10);
}

async function getNotificationById(id: number) {
  // Mock notification lookup
  return {
    id,
    userId: 1, // Mock user ID
    type: 'MENTION' as const,
    message: 'mentioned you in a post',
    readAt: null,
    createdAt: new Date().toISOString(),
  };
}

async function markNotificationAsRead(id: number): Promise<void> {
  // Mock mark as read
  console.log(`Marked notification ${id} as read`);
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
