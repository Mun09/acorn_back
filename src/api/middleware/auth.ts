import { Request, Response, NextFunction } from 'express';
import { JwtService, JwtPayload } from '../../lib/jwt';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        handle: string;
        email: string;
        bio?: string | null;
        trustScore: number;
        verifiedFlags?: any;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}

export interface AuthError {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Authentication middleware - requires valid JWT token
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    let token = JwtService.extractTokenFromHeader(authHeader);

    // If no token in header, try to get from httpOnly cookie
    if (!token) {
      token = req.cookies?.['acorn_token'];
    }

    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token is required',
        statusCode: 401,
      } as AuthError);
      return;
    }

    // Verify token
    const decoded: JwtPayload = JwtService.verifyToken(token);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        handle: true,
        email: true,
        bio: true,
        trustScore: true,
        verifiedFlags: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found',
        statusCode: 401,
      } as AuthError);
      return;
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    logger.error('Authentication error:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Authentication failed';

    res.status(401).json({
      error: 'Unauthorized',
      message: errorMessage,
      statusCode: 401,
    } as AuthError);
  }
};

/**
 * Optional authentication middleware - doesn't require token but attaches user if present
 */
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = JwtService.extractTokenFromHeader(authHeader);

    if (token) {
      const decoded: JwtPayload = JwtService.verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });
      console.log('Optional auth user:', user);

      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // Log error but continue without authentication
    logger.warn('Optional auth failed:', error);
    next();
  }
};
