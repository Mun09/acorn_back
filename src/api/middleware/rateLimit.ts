import { Request, Response, NextFunction } from 'express';
import { logger } from '../../lib/logger';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting (consider Redis for production)
const requestStore = new Map<string, RequestRecord>();

// Cleanup old entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, record] of requestStore.entries()) {
      if (now > record.resetTime) {
        requestStore.delete(key);
      }
    }
  },
  5 * 60 * 1000
);

/**
 * Rate limiting middleware factory
 * @param config Rate limit configuration
 * @returns Express middleware function
 */
export function createRateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later',
  } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = getClientKey(req);
    const now = Date.now();

    // Get or create request record
    let record = requestStore.get(key);

    if (!record || now > record.resetTime) {
      // Create new record or reset expired one
      record = {
        count: 0,
        resetTime: now + windowMs,
      };
      requestStore.set(key, record);
    }

    // Check if limit exceeded
    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);

      logger.warn(`Rate limit exceeded for ${key}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        currentCount: record.count,
        maxRequests,
        retryAfter,
      });

      res.status(429).json({
        error: 'Too Many Requests',
        message,
        statusCode: 429,
        retryAfter,
        limit: maxRequests,
        windowMs,
      });
      return;
    }

    // Increment counter before response
    record.count++;

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': Math.max(
        0,
        maxRequests - record.count
      ).toString(),
      'X-RateLimit-Reset': Math.ceil(record.resetTime / 1000).toString(),
      'X-RateLimit-Window': Math.ceil(windowMs / 1000).toString(),
    });

    next();
  };
}

/**
 * Get unique key for client identification
 * Priority: User ID > IP address
 */
function getClientKey(req: Request): string {
  // If user is authenticated, use user ID
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }

  // Fallback to IP address
  const forwarded = req.get('X-Forwarded-For');
  const ip = forwarded ? forwarded.split(',')[0]?.trim() : req.ip || 'unknown';
  return `ip:${ip}`;
}

// Pre-configured rate limiters for common use cases

/**
 * General API rate limiter: 200 requests per minute (increased for normal API usage)
 */
export const generalRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 200,
  message: 'Too many requests from this IP, please try again in a minute',
});

/**
 * High frequency rate limiter for frequently called endpoints: 500 requests per minute
 * Use for endpoints like /me, /refresh, health checks, etc.
 */
export const highFrequencyRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 500,
  message: 'Too many requests, please slow down',
});

/**
 * Auth rate limiter: 10 attempts per 15 minutes (increased slightly)
 */
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: true, // Don't count successful logins
});

/**
 * Strict rate limiter for sensitive operations: 30 requests per hour (increased)
 */
export const strictRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 30,
  message: 'Rate limit exceeded for sensitive operation',
});

/**
 * Post creation rate limiter: 50 posts per hour (increased)
 */
export const postRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 50,
  message: 'Too many posts created, please wait before posting again',
});

/**
 * Lenient rate limiter for read-only operations: 1000 requests per hour
 * Use for data fetching endpoints that don't modify state
 */
export const readOnlyRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 1000,
  message: 'Too many read requests, please slow down',
});
