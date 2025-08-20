import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { logger } from './lib/logger';
import { env } from './config/env';

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

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      uptime: process.uptime(),
    });
  });

  // API routes
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

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.originalUrl} not found`,
      statusCode: 404,
    });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);

    res.status(500).json({
      error: 'Internal Server Error',
      message:
        env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
      statusCode: 500,
    });
  });

  return app;
}
