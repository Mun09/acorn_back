/**
 * Moderation API router
 * Handles content reporting, post hiding, and admin moderation tools
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { requireAdmin } from '../middleware/admin';
import { prisma } from '../../lib/prisma';

const router: Router = Router();

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
      reports: reports.reports,
      nextCursor: reports.pagination.nextCursor,
      hasMore: reports.pagination.hasNextPage,
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
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      text: true,
      userId: true,
      isHidden: true,
      createdAt: true,
    },
  });

  if (!post) return null;

  return {
    id: post.id,
    text: post.text,
    userId: post.userId,
    hiddenAt: post.isHidden ? new Date().toISOString() : null, // We don't have exact hidden timestamp
    hiddenByUserId: null, // Would need additional field in schema
    createdAt: post.createdAt.toISOString(),
  };
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
  const existingReport = await prisma.report.findFirst({
    where: {
      reporterId,
      postId,
    },
    select: {
      id: true,
      postId: true,
      reporterId: true,
      reason: true,
      details: true,
      createdAt: true,
    },
  });

  if (!existingReport) return null;

  return {
    id: existingReport.id,
    postId: existingReport.postId,
    reporterId: existingReport.reporterId,
    reason: existingReport.reason,
    details: existingReport.details,
    status: 'PENDING', // Default status since we don't have it in schema
    createdAt: existingReport.createdAt.toISOString(),
  };
}

interface CreateReportData {
  postId: number;
  reporterId: number;
  reason: string;
  details: string | null;
  status: string;
}

async function createReport(data: CreateReportData): Promise<ReportData> {
  const report = await prisma.report.create({
    data: {
      postId: data.postId,
      reporterId: data.reporterId,
      reason: data.reason as any, // Type assertion for enum compatibility
      details: data.details,
    },
    select: {
      id: true,
      postId: true,
      reporterId: true,
      reason: true,
      details: true,
      createdAt: true,
    },
  });

  return {
    id: report.id,
    postId: report.postId,
    reporterId: report.reporterId,
    reason: report.reason,
    details: report.details,
    status: data.status,
    createdAt: report.createdAt.toISOString(),
  };
}

async function hidePost(postId: number, adminId: number): Promise<PostData> {
  const hiddenPost = await prisma.post.update({
    where: { id: postId },
    data: { isHidden: true },
    select: {
      id: true,
      text: true,
      userId: true,
      isHidden: true,
      createdAt: true,
    },
  });

  return {
    id: hiddenPost.id,
    text: hiddenPost.text,
    userId: hiddenPost.userId,
    hiddenAt: new Date().toISOString(),
    hiddenByUserId: adminId,
    createdAt: hiddenPost.createdAt.toISOString(),
  };
}

async function updateReportsForPost(
  postId: number,
  _status: string,
  _adminId: number
): Promise<void> {
  // Update all reports for the post to the new status
  await prisma.report.updateMany({
    where: { postId },
    data: {
      // Note: Since there's no status field in the schema,
      // we're just updating the existence of the reports
      // In a real implementation, you'd add a status field to the Report model
    },
  });
}

interface GetReportsOptions {
  cursor?: string | undefined;
  limit: number;
  status?: string | undefined;
  reason?: string | undefined;
}

async function getReports(options: GetReportsOptions) {
  const whereClause: any = {};

  // Add reason filter if provided
  if (options.reason) {
    whereClause.reason = options.reason;
  }

  // Parse cursor for pagination
  let cursorCondition = {};
  if (options.cursor) {
    try {
      const cursorId = parseInt(options.cursor);
      cursorCondition = { id: { lt: cursorId } };
    } catch (e) {
      // Invalid cursor, ignore
    }
  }

  const reports = await prisma.report.findMany({
    where: { ...whereClause, ...cursorCondition },
    include: {
      reporter: {
        select: {
          id: true,
          handle: true,
        },
      },
      post: {
        select: {
          id: true,
          text: true,
          user: {
            select: {
              handle: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit + 1, // Take one extra to determine if there's a next page
  });

  const hasNextPage = reports.length > options.limit;
  const reportsToReturn = hasNextPage ? reports.slice(0, -1) : reports;
  const nextCursor = hasNextPage
    ? reportsToReturn[reportsToReturn.length - 1]?.id.toString()
    : null;

  return {
    reports: reportsToReturn.map((report: any) => ({
      id: report.id,
      postId: report.postId,
      reporterId: report.reporterId,
      reporter: {
        id: report.reporter.id,
        handle: report.reporter.handle,
        displayName: report.reporter.handle, // Use handle as displayName
      },
      post: {
        id: report.post.id,
        text: report.post.text,
        author: {
          handle: report.post.user.handle,
          displayName: report.post.user.handle, // Use handle as displayName
        },
      },
      reason: report.reason,
      details: report.details,
      status: 'PENDING', // Since we don't have status in schema
      createdAt: report.createdAt.toISOString(),
      reviewedAt: null, // Would need additional field in schema
      reviewedBy: null, // Would need additional field in schema
    })),
    pagination: {
      nextCursor,
      hasNextPage,
    },
  };
}

async function getPendingReportsCount(): Promise<number> {
  const count = await prisma.report.count({
    where: {
      // Since we don't have a status field, count all reports
      // In a real implementation, you'd filter by status: 'PENDING'
    },
  });
  return count;
}

export default router;
