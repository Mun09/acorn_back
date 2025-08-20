import { z } from 'zod';

// Common validation patterns and schemas

/**
 * Handle validation
 * - 3-20 characters
 * - Letters, numbers, underscores only
 * - Cannot start with underscore
 */
export const handleSchema = z
  .string()
  .min(3, 'Handle must be at least 3 characters')
  .max(20, 'Handle must be at most 20 characters')
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Handle can only contain letters, numbers, and underscores'
  )
  .regex(/^[a-zA-Z]/, 'Handle must start with a letter');

/**
 * Email validation with stricter rules
 */
export const emailSchema = z
  .string()
  .email('Invalid email format')
  .max(254, 'Email is too long')
  .toLowerCase()
  .refine(
    email => !email.includes('+') || email.indexOf('+') < email.indexOf('@'),
    'Invalid email format'
  );

/**
 * Password validation
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - Optional: special characters
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain at least one uppercase letter, one lowercase letter, and one number'
  );

/**
 * Strong password with special characters
 */
export const strongPasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password is too long')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
    'Password must contain uppercase, lowercase, number, and special character'
  );

/**
 * Post text content validation
 * - 1-280 characters (Twitter-like)
 * - Trim whitespace
 */
export const postTextSchema = z
  .string()
  .trim()
  .min(1, 'Post content cannot be empty')
  .max(280, 'Post content must be 280 characters or less');

/**
 * Comment text validation
 * - 1-500 characters
 */
export const commentTextSchema = z
  .string()
  .trim()
  .min(1, 'Comment cannot be empty')
  .max(500, 'Comment must be 500 characters or less');

/**
 * Bio text validation
 * - Optional, up to 160 characters
 */
export const bioSchema = z
  .string()
  .trim()
  .max(160, 'Bio must be 160 characters or less')
  .optional()
  .nullable();

/**
 * Stock ticker symbol validation
 * - 1-5 uppercase letters
 * - Common stock symbols format
 */
export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Ticker symbol is required')
  .max(5, 'Ticker symbol must be 5 characters or less')
  .regex(/^[A-Z]+$/, 'Ticker symbol must contain only uppercase letters');

/**
 * Crypto ticker validation (can include numbers and dots)
 * - Examples: BTC, ETH, DOT, ADA
 */
export const cryptoTickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Crypto ticker must be at least 2 characters')
  .max(10, 'Crypto ticker must be 10 characters or less')
  .regex(
    /^[A-Z0-9.]+$/,
    'Crypto ticker must contain only uppercase letters, numbers, and dots'
  );

/**
 * Price validation (positive number with up to 2 decimal places)
 */
export const priceSchema = z
  .number()
  .positive('Price must be positive')
  .finite('Price must be a valid number')
  .refine(
    price => Number(price.toFixed(2)) === price,
    'Price can have at most 2 decimal places'
  );

/**
 * Percentage validation (-100 to 100)
 */
export const percentageSchema = z
  .number()
  .min(-100, 'Percentage cannot be less than -100%')
  .max(100, 'Percentage cannot be more than 100%')
  .finite('Percentage must be a valid number');

/**
 * Pagination validation
 */
export const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 1))
    .pipe(
      z
        .number()
        .min(1, 'Page must be at least 1')
        .max(1000, 'Page cannot exceed 1000')
    ),
  limit: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 10))
    .pipe(
      z
        .number()
        .min(1, 'Limit must be at least 1')
        .max(100, 'Limit cannot exceed 100')
    ),
});

/**
 * Sort order validation
 */
export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

/**
 * Date range validation
 */
export const dateRangeSchema = z
  .object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine(data => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  }, 'Start date must be before end date');

/**
 * Search query validation
 */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1, 'Search query cannot be empty')
  .max(100, 'Search query must be 100 characters or less')
  .regex(/^[a-zA-Z0-9\s\-_.@#$]+$/, 'Search query contains invalid characters');

/**
 * URL validation (optional)
 */
export const urlSchema = z
  .string()
  .url('Invalid URL format')
  .max(2048, 'URL is too long')
  .optional()
  .nullable();

/**
 * Tag validation for posts
 * - 1-30 characters
 * - Letters, numbers, underscores, hyphens
 */
export const tagSchema = z
  .string()
  .trim()
  .min(1, 'Tag cannot be empty')
  .max(30, 'Tag must be 30 characters or less')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Tag can only contain letters, numbers, underscores, and hyphens'
  );

/**
 * Array of tags validation
 */
export const tagsSchema = z
  .array(tagSchema)
  .max(10, 'Cannot have more than 10 tags')
  .optional();

/**
 * ID validation (positive integer)
 */
export const idSchema = z
  .string()
  .transform(val => parseInt(val, 10))
  .pipe(z.number().int().positive('ID must be a positive integer'));

/**
 * Optional ID validation
 */
export const optionalIdSchema = z
  .string()
  .optional()
  .transform(val => (val ? parseInt(val, 10) : undefined))
  .pipe(z.number().int().positive().optional());

// Common request schemas

/**
 * Common signup schema
 */
export const signupRequestSchema = z.object({
  email: emailSchema,
  handle: handleSchema,
  password: passwordSchema,
  bio: bioSchema,
});

/**
 * Common login schema
 */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

/**
 * Update profile schema
 */
export const updateProfileSchema = z.object({
  handle: handleSchema.optional(),
  bio: bioSchema,
  email: emailSchema.optional(),
});

/**
 * Create post schema
 */
export const createPostSchema = z.object({
  text: postTextSchema,
  tags: tagsSchema,
  replyTo: optionalIdSchema,
  quotePostId: optionalIdSchema,
});

/**
 * Query parameters for posts listing
 */
export const postsQuerySchema = paginationSchema.extend({
  sortBy: z.enum(['createdAt', 'likes', 'replies']).default('createdAt'),
  sortOrder: sortOrderSchema,
  userId: optionalIdSchema,
  tag: tagSchema.optional(),
  search: searchQuerySchema.optional(),
});

/**
 * Symbol query schema
 */
export const symbolQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Query is required')
    .max(10, 'Query too long'),
  type: z.enum(['stock', 'crypto', 'all']).default('all'),
});

// Export commonly used combinations
export const validators = {
  handle: handleSchema,
  email: emailSchema,
  password: passwordSchema,
  strongPassword: strongPasswordSchema,
  postText: postTextSchema,
  commentText: commentTextSchema,
  bio: bioSchema,
  ticker: tickerSchema,
  cryptoTicker: cryptoTickerSchema,
  price: priceSchema,
  percentage: percentageSchema,
  pagination: paginationSchema,
  sortOrder: sortOrderSchema,
  dateRange: dateRangeSchema,
  searchQuery: searchQuerySchema,
  url: urlSchema,
  tag: tagSchema,
  tags: tagsSchema,
  id: idSchema,
  optionalId: optionalIdSchema,
} as const;
