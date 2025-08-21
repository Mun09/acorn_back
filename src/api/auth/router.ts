import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { JwtService } from '../../lib/jwt';
import { authenticateToken } from '../middleware/auth';
import { authRateLimit, highFrequencyRateLimit } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/error';
import { signupRequestSchema, loginRequestSchema } from '../validators';
import { logger } from '../../lib/logger';

const router = Router();

// Apply strict rate limiting to signup/login routes only
// Other routes will have their own rate limiting applied individually

// Request validation schemas - using common validators
const signupSchema = signupRequestSchema;
const loginSchema = loginRequestSchema;

// Standard error response interface
interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: any;
}

// Helper function to send error response
function sendError(
  res: Response,
  statusCode: number,
  error: string,
  message: string,
  details?: any
): void {
  res.status(statusCode).json({
    error,
    message,
    statusCode,
    ...(details && { details }),
  } as ApiError);
}

/**
 * POST /auth/signup
 * Register a new user
 */
router.post(
  '/signup',
  authRateLimit, // Strict rate limiting for signup
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // Validate request body
    const validatedData = signupSchema.parse(req.body);
    const { email, handle, password } = validatedData;

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { handle }],
      },
    });

    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'handle';
      sendError(res, 409, 'Conflict', `User with this ${field} already exists`);
      return;
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        handle,
        password: hashedPassword,
        bio: null,
        trustScore: 0,
        verifiedFlags: null as any,
      },
      select: {
        id: true,
        email: true,
        handle: true,
        bio: true,
        trustScore: true,
        verifiedFlags: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Generate JWT tokens (both access and refresh)
    const tokens = await JwtService.generateTokens({
      id: user.id,
      email: user.email,
      handle: user.handle,
    });

    logger.info(`New user registered: ${user.handle} (${user.email})`);

    res.status(201).json({
      message: 'User created successfully',
      data: {
        user,
        accessToken: tokens.accessToken.token,
        refreshToken: tokens.refreshToken.token,
        expiresIn: tokens.accessToken.expiresIn,
      },
    });
  })
);

/**
 * POST /auth/login
 * Authenticate user and return JWT token
 */
router.post(
  '/login',
  authRateLimit, // Strict rate limiting for login
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // Validate request body
    const validatedData = loginSchema.parse(req.body);
    const { email, password } = validatedData;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      sendError(res, 401, 'Unauthorized', 'Invalid email or password');
      return;
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      sendError(res, 401, 'Unauthorized', 'Invalid email or password');
      return;
    }

    // Generate JWT tokens (both access and refresh)
    const tokens = await JwtService.generateTokens({
      id: user.id,
      email: user.email,
      handle: user.handle,
    });

    logger.info(`User logged in: ${user.handle} (${user.email})`);

    res.status(200).json({
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          handle: user.handle,
          bio: user.bio,
          trustScore: user.trustScore,
          verifiedFlags: user.verifiedFlags,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        accessToken: tokens.accessToken.token,
        refreshToken: tokens.refreshToken.token,
        expiresIn: tokens.accessToken.expiresIn,
      },
    });
  })
);

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post(
  '/refresh',
  highFrequencyRateLimit, // More lenient rate limiting for refresh tokens
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      sendError(res, 400, 'Bad Request', 'Refresh token is required');
      return;
    }

    try {
      const newAccessToken = await JwtService.refreshAccessToken(refreshToken);

      res.status(200).json({
        message: 'Token refreshed successfully',
        data: {
          accessToken: newAccessToken.token,
          expiresIn: newAccessToken.expiresIn,
        },
      });
    } catch (error) {
      logger.error('Token refresh error:', error);
      sendError(res, 401, 'Unauthorized', 'Invalid or expired refresh token');
    }
  })
);

/**
 * POST /auth/logout
 * Logout user and revoke refresh token
 */
router.post(
  '/logout',
  highFrequencyRateLimit, // More lenient for logout
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body;

    if (refreshToken) {
      try {
        await JwtService.revokeRefreshToken(refreshToken);
      } catch (error) {
        logger.warn('Failed to revoke refresh token during logout:', error);
      }
    }

    res.status(200).json({
      message: 'Logged out successfully',
    });
  })
);

/**
 * POST /auth/logout-all
 * Logout user from all devices (revoke all refresh tokens)
 */
router.post(
  '/logout-all',
  authRateLimit, // Stricter rate limiting for security-sensitive operation
  authenticateToken,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        sendError(res, 401, 'Unauthorized', 'User not found');
        return;
      }

      await JwtService.revokeAllRefreshTokens(user.id);

      res.status(200).json({
        message: 'Logged out from all devices successfully',
      });
    } catch (error) {
      logger.error('Logout all error:', error);
      sendError(
        res,
        500,
        'Internal Server Error',
        'Failed to logout from all devices'
      );
    }
  })
);

/**
 * GET /auth/me
 * Get current user information (requires authentication)
 */
router.get(
  '/me',
  highFrequencyRateLimit, // More lenient rate limiting for user info
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // User is attached to request by authenticateToken middleware
      const user = req.user;

      if (!user) {
        sendError(res, 401, 'Unauthorized', 'User not found');
        return;
      }

      res.status(200).json({
        message: 'User information retrieved successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            handle: user.handle,
            bio: user.bio,
            trustScore: user.trustScore,
            verifiedFlags: user.verifiedFlags,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
        },
      });
    } catch (error) {
      logger.error('Get user error:', error);
      sendError(
        res,
        500,
        'Internal Server Error',
        'Failed to get user information'
      );
    }
  }
);

export { router as authRouter };
