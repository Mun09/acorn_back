/**
 * Moderation API router
 * Handles content reporting, post hiding, and admin moderation tools
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { authenticateToken } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();

// Validation schemas
const createReportSchema = z.object({
  postId: z.coerce.number().positive(),
  reason: z.enum([
    'SPAM',
    'HARASSMENT',
    'HATE_SPEECH',
    'MISINFORMATION',
    'INAPPROPRIATE_CONTENT',
    'COPYRIGHT',
    'OTHER',
  ]),
  details: z.string().max(1000).optional(),
});

const hidePostParamsSchema = z.object({
  id: z.coerce.number().positive(),
});

const getReportsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED']).optional(),
  reason: z
    .enum([
      'SPAM',
      'HARASSMENT',
      'HATE_SPEECH',
      'MISINFORMATION',
      'INAPPROPRIATE_CONTENT',
      'COPYRIGHT',
      'OTHER',
    ])
    .optional(),
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
 * POST /reports
 * Create a new content report
 */
router.post(
  '/reports',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { postId, reason, details } = validateData(
      createReportSchema,
      req.body
    );
    const reporterId = req.user!.id;

    // Check if post exists
    const post = await getPostById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user already reported this post
    const existingReport = await findExistingReport(reporterId, postId);
    if (existingReport) {
      return res.status(400).json({
        error: 'You have already reported this post',
        existingReportId: existingReport.id,
      });
    }

    // Create the report
    const report = await createReport({
      postId,
      reporterId,
      reason,
      details: details || null,
      status: 'PENDING',
    });

    return res.status(201).json({
      success: true,
      report: {
        id: report.id,
        postId: report.postId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt,
      },
      message: 'Report submitted successfully',
    });
  })
);

/**
 * POST /posts/:id/hide
 * Hide a post (admin only)
 */
router.post(
  '/posts/:id/hide',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = validateData(hidePostParamsSchema, req.params);
    const adminId = req.user!.id;

    // Check if post exists
    const post = await getPostById(id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.hiddenAt) {
      return res.status(400).json({
        error: 'Post is already hidden',
        hiddenAt: post.hiddenAt,
      });
    }

    // Hide the post
    const hiddenPost = await hidePost(id, adminId);

    // Update related reports to RESOLVED status
    await updateReportsForPost(id, 'RESOLVED', adminId);

    return res.json({
      success: true,
      post: {
        id: hiddenPost.id,
        hiddenAt: hiddenPost.hiddenAt,
        hiddenByUserId: hiddenPost.hiddenByUserId,
      },
      message: 'Post hidden successfully',
    });
  })
);

/**
 * GET /reports
 * Get reports list with filtering and pagination (admin only)
 */
router.get(
  '/reports',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { cursor, limit, status, reason } = validateData(
      getReportsQuerySchema,
      req.query
    );

    const reports = await getReports({
      cursor,
      limit,
      status,
      reason,
    });

    res.json({
      reports: reports.items,
      nextCursor: reports.nextCursor,
      hasMore: reports.hasMore,
      totalPending: await getPendingReportsCount(),
      filters: {
        status,
        reason,
      },
    });
  })
);

// Mock database functions (replace with actual Prisma queries)

interface PostData {
  id: number;
  text: string;
  userId: number;
  hiddenAt: string | null;
  hiddenByUserId: number | null;
  createdAt: string;
}

async function getPostById(postId: number): Promise<PostData | null> {
  // Mock post lookup
  const mockPosts: PostData[] = [
    {
      id: 1,
      text: 'This is a sample post content',
      userId: 1,
      hiddenAt: null,
      hiddenByUserId: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: 2,
      text: 'Another post that might be reported',
      userId: 2,
      hiddenAt: null,
      hiddenByUserId: null,
      createdAt: new Date().toISOString(),
    },
  ];

  return mockPosts.find(p => p.id === postId) || null;
}

interface ReportData {
  id: number;
  postId: number;
  reporterId: number;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
}

async function findExistingReport(
  reporterId: number,
  postId: number
): Promise<ReportData | null> {
  // Mock existing report check
  // In real implementation: SELECT * FROM reports WHERE reporterId = ? AND postId = ?
  return Math.random() > 0.8
    ? {
        id: 1,
        postId,
        reporterId,
        reason: 'SPAM',
        details: null,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      }
    : null;
}

interface CreateReportData {
  postId: number;
  reporterId: number;
  reason: string;
  details: string | null;
  status: string;
}

async function createReport(data: CreateReportData): Promise<ReportData> {
  // Mock report creation
  const report: ReportData = {
    id: Math.floor(Math.random() * 1000000),
    ...data,
    createdAt: new Date().toISOString(),
  };

  console.log('Creating report:', report);
  return report;
}

async function hidePost(postId: number, adminId: number): Promise<PostData> {
  // Mock post hiding
  const hiddenPost: PostData = {
    id: postId,
    text: 'Hidden post content',
    userId: 1,
    hiddenAt: new Date().toISOString(),
    hiddenByUserId: adminId,
    createdAt: new Date().toISOString(),
  };

  console.log(`Post ${postId} hidden by admin ${adminId}`);
  return hiddenPost;
}

async function updateReportsForPost(
  postId: number,
  status: string,
  adminId: number
): Promise<void> {
  // Mock reports update
  console.log(
    `Updated reports for post ${postId} to status ${status} by admin ${adminId}`
  );
}

interface GetReportsOptions {
  cursor?: string | undefined;
  limit: number;
  status?: string | undefined;
  reason?: string | undefined;
}

async function getReports(options: GetReportsOptions) {
  // Mock reports list
  const mockReports = Array.from(
    { length: Math.min(options.limit, 15) },
    (_, i) => {
      const reasons = [
        'SPAM',
        'HARASSMENT',
        'HATE_SPEECH',
        'MISINFORMATION',
        'INAPPROPRIATE_CONTENT',
      ];
      const statuses = ['PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED'];

      const reason =
        options.reason || reasons[Math.floor(Math.random() * reasons.length)]!;
      const status =
        options.status ||
        statuses[Math.floor(Math.random() * statuses.length)]!;

      return {
        id: i + 1,
        postId: Math.floor(Math.random() * 100) + 1,
        reporterId: Math.floor(Math.random() * 50) + 1,
        reporter: {
          id: Math.floor(Math.random() * 50) + 1,
          handle: `user${Math.floor(Math.random() * 50) + 1}`,
          displayName: `User ${Math.floor(Math.random() * 50) + 1}`,
        },
        post: {
          id: Math.floor(Math.random() * 100) + 1,
          text: `Post content that was reported for ${reason}`,
          author: {
            handle: `author${Math.floor(Math.random() * 50) + 1}`,
            displayName: `Author ${Math.floor(Math.random() * 50) + 1}`,
          },
        },
        reason,
        details:
          Math.random() > 0.5
            ? `Additional details about ${reason.toLowerCase()} violation`
            : null,
        status,
        createdAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
        reviewedAt:
          status !== 'PENDING'
            ? new Date(Date.now() - i * 30 * 60 * 1000).toISOString()
            : null,
        reviewedBy:
          status !== 'PENDING'
            ? {
                id: 999,
                handle: 'admin',
                displayName: 'Admin User',
              }
            : null,
      };
    }
  );

  return {
    items: mockReports,
    nextCursor:
      mockReports.length === options.limit ? `cursor_${Date.now()}` : null,
    hasMore: mockReports.length === options.limit,
  };
}

async function getPendingReportsCount(): Promise<number> {
  // Mock pending reports count
  return Math.floor(Math.random() * 50) + 5;
}

export default router;
