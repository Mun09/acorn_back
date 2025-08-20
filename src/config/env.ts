import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
config();

// Environment schema validation using Zod
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 3001)),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long'),
});

// Validate environment variables
function validateEnv(): z.infer<typeof envSchema> {
  try {
    const env = envSchema.parse(process.env);
    console.log('✅ Environment variables validated successfully');
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.issues.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error(
        '❌ Unexpected error during environment validation:',
        error
      );
    }
    process.exit(1);
  }
}

// Export validated environment configuration
export const env = validateEnv();

// Type-safe environment interface
export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
}

// Export individual environment variables for convenience
export const { NODE_ENV, PORT, DATABASE_URL, JWT_SECRET } = env;
