/**
 * API Routes Index
 * Centralized export of all API routers for clean imports
 */

// Authentication routes
export { authRouter } from './auth/router';

// Core API routes
export { default as symbolsRouter } from './symbols';
export { default as postsRouter } from './posts/router';
export { default as feedRouter } from './feed/router';
export { default as socialRouter } from './social/router';
export { default as moderationRouter } from './moderation/router';
export { default as searchRouter } from './search/router';
export { default as notificationsRouter } from './notifications/router';

// Middleware exports
export { generalRateLimit } from './middleware/rateLimit';
export { errorHandler, notFoundHandler } from './middleware/error';

// Utility exports
export * from './validators';
