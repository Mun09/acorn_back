/**
 * Symbol-related API routes
 */
import { Router } from 'express';
import { z } from 'zod';
import { extractSymbolsFromText, formatSymbol } from '../lib/symbols';
import { asyncHandler } from './middleware/error';

const router = Router();

// Validation helper
function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.error.message}`);
  }
  return result.data;
}

// Validation schemas
const extractSymbolsSchema = z.object({
  text: z.string().min(1).max(10000),
  includeFormatted: z.boolean().optional().default(false),
});

/**
 * POST /api/symbols/extract
 * Extract financial symbols from text
 */
router.post(
  '/extract',
  asyncHandler(async (req, res) => {
    const { text, includeFormatted } = validateData(
      extractSymbolsSchema,
      req.body
    );

    const symbols = extractSymbolsFromText(text);

    const response = {
      symbols,
      count: symbols.length,
      ...(includeFormatted && {
        formatted: symbols.map(s => ({
          ...s,
          formatted: formatSymbol(s),
        })),
      }),
    };

    res.json(response);
  })
);

/**
 * GET /api/symbols/demo
 * Demo endpoint with sample text for testing
 */
router.get(
  '/demo',
  asyncHandler(async (_req, res) => {
    const sampleTexts = [
      'Just bought $TSLA at $250! Also watching BTC and ETH movements.',
      'Korean market: 005930.KS (Samsung) and 035720.KQ (Kakao) looking good.',
      'Portfolio update: $AAPL, $GOOGL.NASDAQ, BTC, and 000660.KS positions.',
      'Crypto watch: BTC, ETH, ADA, SOL all moving up today!',
    ];

    const results = sampleTexts.map(text => ({
      text,
      symbols: extractSymbolsFromText(text),
    }));

    res.json({
      message: 'Symbol extraction demo',
      samples: results,
    });
  })
);

export default router;
