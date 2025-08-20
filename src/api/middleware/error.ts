import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../lib/logger';

// Standard error response interface
export interface StandardError {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  details?: any;
  stack?: string;
}

// Error codes for better error categorization
export enum ErrorCode {
  // Client errors (4xx)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_REQUEST = 'INVALID_REQUEST',

  // Server errors (5xx)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
}

// Custom error class with additional context
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: ErrorCode;
  public readonly isOperational: boolean;
  public readonly details?: any;

  constructor(
    message: string,
    statusCode: number,
    errorCode: ErrorCode,
    isOperational = true,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.details = details;

    // Ensure the name of this error is the same as the class name
    this.name = this.constructor.name;

    // This clips the constructor invocation from the stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Create a standardized error response
 */
function createErrorResponse(
  error: Error,
  req: Request,
  statusCode: number = 500,
  errorCode: string = ErrorCode.INTERNAL_SERVER_ERROR
): StandardError {
  const response: StandardError = {
    error: errorCode,
    message: error.message || 'An unexpected error occurred',
    statusCode,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  };

  // Add details for specific error types
  if (error instanceof AppError && error.details) {
    response.details = error.details;
  }

  if (error instanceof ZodError) {
    response.details = error.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
  }

  // Include stack trace in development
  if (process.env['NODE_ENV'] === 'development' && error.stack) {
    response.stack = error.stack;
  }

  return response;
}

/**
 * Global error handler middleware
 * Must be placed after all routes and other middleware
 */
export const errorHandler: ErrorRequestHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let errorCode = ErrorCode.INTERNAL_SERVER_ERROR;

  // Handle different error types
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    errorCode = error.errorCode;
  } else if (error instanceof ZodError) {
    statusCode = 400;
    errorCode = ErrorCode.VALIDATION_ERROR;
  } else if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = ErrorCode.VALIDATION_ERROR;
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    errorCode = ErrorCode.AUTHENTICATION_REQUIRED;
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    errorCode = ErrorCode.INSUFFICIENT_PERMISSIONS;
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    errorCode = ErrorCode.RESOURCE_NOT_FOUND;
  } else if (error.name === 'ConflictError') {
    statusCode = 409;
    errorCode = ErrorCode.RESOURCE_CONFLICT;
  }

  // Create standardized error response
  const errorResponse = createErrorResponse(error, req, statusCode, errorCode);

  // Log error with appropriate level
  const logContext = {
    error: error.message,
    statusCode,
    errorCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    stack: error.stack,
  };

  if (statusCode >= 500) {
    logger.error('Server error occurred', logContext);
  } else if (statusCode >= 400) {
    logger.warn('Client error occurred', logContext);
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found handler
 * Should be placed after all routes but before error handler
 */
export const notFoundHandler = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const error = new AppError(
    `Route ${req.method} ${req.path} not found`,
    404,
    ErrorCode.RESOURCE_NOT_FOUND
  );
  next(error);
};

/**
 * Async error wrapper to catch errors in async route handlers
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
};

// Pre-configured error factories for common scenarios

export const createValidationError = (message: string, details?: any) =>
  new AppError(message, 400, ErrorCode.VALIDATION_ERROR, true, details);

export const createAuthenticationError = (
  message: string = 'Authentication required'
) => new AppError(message, 401, ErrorCode.AUTHENTICATION_REQUIRED);

export const createAuthorizationError = (
  message: string = 'Insufficient permissions'
) => new AppError(message, 403, ErrorCode.INSUFFICIENT_PERMISSIONS);

export const createNotFoundError = (resource: string = 'Resource') =>
  new AppError(`${resource} not found`, 404, ErrorCode.RESOURCE_NOT_FOUND);

export const createConflictError = (message: string) =>
  new AppError(message, 409, ErrorCode.RESOURCE_CONFLICT);

export const createRateLimitError = (message: string = 'Rate limit exceeded') =>
  new AppError(message, 429, ErrorCode.RATE_LIMIT_EXCEEDED);

export const createDatabaseError = (
  message: string = 'Database operation failed'
) => new AppError(message, 500, ErrorCode.DATABASE_ERROR, true);

export const createInternalError = (
  message: string = 'Internal server error'
) => new AppError(message, 500, ErrorCode.INTERNAL_SERVER_ERROR, false);
