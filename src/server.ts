import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { logger } from './lib/logger';
import { env } from './config/env';
import { DatabaseManager } from './lib/database';
import {
  authRouter,
  symbolsRouter,
  postsRouter,
  feedRouter,
  socialRouter,
  moderationRouter,
  searchRouter,
  notificationsRouter,
  generalRateLimit,
  errorHandler,
  notFoundHandler,
  usersRouter,
} from './api';

export function createServer(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());

  // CORS middleware
  app.use(
    cors({
      origin: env.NODE_ENV === 'production' ? false : true, // Configure based on environment
      credentials: true,
    })
  );

  // Request logging middleware
  app.use(
    morgan('combined', {
      stream: {
        write: (message: string) => logger.info(message.trim()),
      },
    })
  );

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Cookie parsing middleware
  app.use(cookieParser());

  // Apply general rate limiting
  app.use(generalRateLimit);

  // Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    const dbConnected = await DatabaseManager.testConnection();
    const metrics = await DatabaseManager.getMetrics();

    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      uptime: process.uptime(),
      database: {
        connected: dbConnected,
        metrics,
      },
    });
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/symbols', symbolsRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/feed', feedRouter);
  app.use('/api/social', socialRouter);
  app.use('/api/moderation', moderationRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/users', usersRouter); // Example for user-related routes

  app.get('/api/hello', (_req: Request, res: Response) => {
    res.status(200).json({
      message: 'Hello, World!',
      data: {
        greeting: 'Welcome to Acorn API',
        version: '1.0.0',
      },
    });
  });

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      message: 'Acorn API Server',
      status: 'running',
      timestamp: new Date().toISOString(),
    });
  });

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
