import { createServer } from './server';
import { logger } from './lib/logger';
import { env } from './config/env';

async function main(): Promise<void> {
  try {
    const app = createServer();

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
