/**
 * Database configuration and utilities
 */
import { prisma } from './prisma';
import { logger } from './logger';

// Re-export prisma instance for convenience
export { prisma };

// Database utility functions
export class DatabaseManager {
  /**
   * Test database connection
   */
  public static async testConnection(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info('✅ Database connection successful');
      return true;
    } catch (error) {
      logger.error('❌ Database connection failed:', error);
      return false;
    }
  }

  /**
   * Gracefully disconnect from database
   */
  public static async disconnect(): Promise<void> {
    try {
      await prisma.$disconnect();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection:', error);
    }
  }

  /**
   * Get database metrics
   */
  public static async getMetrics(): Promise<{
    users: number;
    posts: number;
    symbols: number;
    reactions: number;
  }> {
    try {
      const [users, posts, symbols, reactions] = await Promise.all([
        prisma.user.count(),
        prisma.post.count(),
        prisma.symbol.count(),
        prisma.reaction.count(),
      ]);

      return { users, posts, symbols, reactions };
    } catch (error) {
      logger.error('Error getting database metrics:', error);
      return { users: 0, posts: 0, symbols: 0, reactions: 0 };
    }
  }
}
