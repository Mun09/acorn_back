import { createServer } from './server';
import { logger } from './lib/logger';
import { env } from './config/env';
import { JwtService } from './lib/jwt';

async function main(): Promise<void> {
  try {
    const app = createServer();

    // Clean up expired refresh tokens on startup
    await JwtService.cleanupExpiredTokens();

    // Set up periodic cleanup (every 24 hours)
    setInterval(
      async () => {
        try {
          await JwtService.cleanupExpiredTokens();
          logger.info('Expired refresh tokens cleaned up');
        } catch (error) {
          logger.error('Failed to cleanup expired tokens:', error);
        }
      },
      24 * 60 * 60 * 1000
    ); // 24 hours

    app.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT}`);
      logger.info(`📚 Environment: ${env.NODE_ENV}`);
      logger.info(`🔗 Health check: http://localhost:${env.PORT}/health`);
      logger.info(`🔄 Refresh token cleanup scheduled every 24 hours`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
