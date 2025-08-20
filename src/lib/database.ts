/**
 * Database configuration and utilities
 */
import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

class DatabaseManager {
  private static instance: PrismaClient;

  public static getInstance(): PrismaClient {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new PrismaClient({
        log: ['query', 'info', 'warn', 'error'],
      });

      logger.info('Database connection initialized');
    }

    return DatabaseManager.instance;
  }

  public static async disconnect(): Promise<void> {
    if (DatabaseManager.instance) {
      await DatabaseManager.instance.$disconnect();
      logger.info('Database connection closed');
    }
  }
}

export const prisma = DatabaseManager.getInstance();
