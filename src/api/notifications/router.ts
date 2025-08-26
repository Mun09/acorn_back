/**
 * Notifications Router
 * Handles notification listing, marking as read, and unread count
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { prisma } from '../../lib/prisma';

const router: Router = Router();

// Validation schemas
const notificationQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : 1)),
  limit: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : 20)),
  type: z.enum(['MENTION', 'REPLY', 'REACTION', 'FOLLOW']).optional(),
  unread: z
    .string()
    .optional()
    .transform(val => val === 'true'),
});

const markAsReadSchema = z.object({
  notificationIds: z.array(z.string()).optional(),
});

router.use(authenticateToken);

/**
 * GET /api/notifications
 * Get paginated notifications for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const query = notificationQuerySchema.parse(req.query);
    const { page, limit, type, unread } = query;
    const offset = (page - 1) * limit;

    const where: any = {
      userId: req.user!.id,
    };

    if (type) {
      where.kind = type;
    }

    if (unread !== undefined) {
      where.readAt = unread ? null : { not: null };
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.notification.count({ where }),
    ]);

    res.json({
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notifications count for the authenticated user
 */
router.get('/unread-count', async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: {
        userId: req.user!.id,
        readAt: null,
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

/**
 * PATCH /api/notifications/mark-read
 * Mark notifications as read
 */
router.patch('/mark-read', async (req, res) => {
  try {
    const { notificationIds } = markAsReadSchema.parse(req.body);

    const where: any = {
      userId: req.user!.id,
      readAt: null,
    };

    if (notificationIds && notificationIds.length > 0) {
      where.id = { in: notificationIds.map(id => parseInt(id)) };
    }

    const updated = await prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });

    res.json({ updated: updated.count });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

/**
 * PATCH /api/notifications/:id/mark-read
 * Mark a specific notification as read
 */
router.patch('/:id/mark-read', async (req, res) => {
  try {
    const idParam = req.params['id'];
    if (!idParam) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const notificationId = parseInt(idParam);

    if (isNaN(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId: req.user!.id,
      },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.readAt) {
      return res.json({ message: 'Notification already read' });
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    return res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res
      .status(500)
      .json({ error: 'Failed to mark notification as read' });
  }
});

export default router;
