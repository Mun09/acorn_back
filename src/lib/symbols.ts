/**
 * Symbol extraction and normalization utilities
 * Extracts financial symbols ($TSLA, $AAPL, BTC, ETH) from text
 */

export interface ExtractedSymbol {
  raw: string; // Original text as found ($TSLA, btc)
  ticker: string; // Normalized ticker (TSLA, BTC)
  exchange?: string; // Exchange code (KS, KQ, etc.)
  kind?: 'STOCK' | 'CRYPTO';
}

// Major crypto symbols (most common cryptocurrencies)
const CRYPTO_SYMBOLS = new Set([
  'BTC',
  'ETH',
  'USDT',
  'BNB',
  'XRP',
  'USDC',
  'STETH',
  'ADA',
  'DOGE',
  'SOL',
  'TRX',
  'AVAX',
  'DOT',
  'MATIC',
  'SHIB',
  'LTC',
  'BCH',
  'LINK',
  'ATOM',
  'ETC',
  'XMR',
  'ICP',
  'NEAR',
  'UNI',
  'APT',
  'QNT',
  'FIL',
  'VET',
  'HBAR',
  'ALGO',
  'MANA',
  'SAND',
  'AXS',
  'FLOW',
  'XTZ',
  'EGLD',
  'THETA',
  'KLAY',
  'AAVE',
  'MKR',
]);

// Known exchange codes (to filter out from symbol extraction)
const KNOWN_EXCHANGES = new Set([
  'NYSE',
  'NASDAQ',
  'NYS',
  'NAS',
  'LSE',
  'TSE',
  'HKG',
  'KS',
  'KQ',
  'KN', // Korean exchanges
  'SS',
  'SZ', // Chinese exchanges
]);

/**
 * Regular expressions for symbol detection
 */
const SYMBOL_PATTERNS = {
  // Stock symbols with $ prefix: $TSLA, $AAPL, $005930.KS
  stock: /\$([A-Z0-9]{1,6}(?:\.[A-Z]{1,3})?)/g,

  // Crypto symbols without $: BTC, ETH (standalone words)
  crypto: /\b([A-Z]{2,5})\b/g,

  // Korean stock codes: 6 digit numbers with optional exchange
  koreanStock: /\b(\d{6})(?:\.([A-Z]{2}))?\b/g,
} as const;

/**
 * Normalize a ticker symbol
 */
function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase().trim();
}

/**
 * Parse exchange information from ticker
 */
function parseExchange(ticker: string): { ticker: string; exchange?: string } {
  // Check for exchange suffix (e.g., "005930.KS")
  const exchangeMatch = ticker.match(/^(.+)\.([A-Z]{1,3})$/);
  if (exchangeMatch && exchangeMatch[1] && exchangeMatch[2]) {
    const baseTicker = exchangeMatch[1];
    const exchange = exchangeMatch[2];
    return {
      ticker: normalizeTicker(baseTicker),
      exchange: exchange.toUpperCase(),
    };
  }

  return { ticker: normalizeTicker(ticker) };
}

/**
 * Determine symbol kind based on ticker and context
 */
function determineSymbolKind(
  ticker: string,
  exchange?: string,
  hasPrefix: boolean = false
): 'STOCK' | 'CRYPTO' | undefined {
  // If it has $ prefix, it's likely a stock
  if (hasPrefix) {
    return 'STOCK';
  }

  // If it has a known exchange, it's a stock
  if (exchange) {
    return 'STOCK';
  }

  // If it's in crypto list, it's crypto
  if (CRYPTO_SYMBOLS.has(ticker)) {
    return 'CRYPTO';
  }

  // For Korean 6-digit codes, it's stock
  if (/^\d{6}$/.test(ticker)) {
    return 'STOCK';
  }

  // If it's 2-5 letters without context, could be either - leave undefined
  // This allows for domain ambiguity as requested
  return undefined;
}

/**
 * Extract stock symbols with $ prefix
 */
function extractStockSymbols(text: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const matches = text.matchAll(SYMBOL_PATTERNS.stock);

  for (const match of matches) {
    const raw = match[0]; // Full match including $
    const tickerWithExchange = match[1]; // Ticker part without $

    if (!tickerWithExchange) continue;

    const { ticker, exchange } = parseExchange(tickerWithExchange);
    const kind = determineSymbolKind(ticker, exchange, true);

    symbols.push({
      raw,
      ticker,
      ...(exchange && { exchange }),
      ...(kind && { kind }),
    });
  }

  return symbols;
}

/**
 * Extract Korean stock symbols (6-digit codes)
 */
function extractKoreanStockSymbols(text: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const matches = text.matchAll(SYMBOL_PATTERNS.koreanStock);

  for (const match of matches) {
    const raw = match[0]; // Full match
    const ticker = match[1]; // 6-digit code
    const exchange = match[2] || 'KS'; // Default to KS if no exchange specified

    if (!ticker) continue;

    symbols.push({
      raw,
      ticker,
      exchange: exchange.toUpperCase(),
      kind: 'STOCK',
    });
  }

  return symbols;
}

/**
 * Extract crypto symbols (standalone uppercase words)
 */
function extractCryptoSymbols(
  text: string,
  excludeStockSymbols: Set<string>
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const matches = text.matchAll(SYMBOL_PATTERNS.crypto);

  for (const match of matches) {
    const raw = match[0];
    const matchedTicker = match[1];

    if (!matchedTicker) continue;

    const ticker = normalizeTicker(matchedTicker);

    // Skip if this was already captured as a stock symbol
    if (excludeStockSymbols.has(ticker)) {
      continue;
    }

    // Skip if it's a known exchange code (to avoid false positives)
    if (KNOWN_EXCHANGES.has(ticker)) {
      continue;
    }

    // Skip common English words that might be false positives
    if (isCommonWord(ticker)) {
      continue;
    }

    const kind = determineSymbolKind(ticker, undefined, false);

    symbols.push({
      raw,
      ticker,
      ...(kind && { kind }),
    });
  }

  return symbols;
}

/**
 * Check if a word is a common English word (to avoid false positives)
 */
function isCommonWord(word: string): boolean {
  const commonWords = new Set([
    'THE',
    'AND',
    'FOR',
    'ARE',
    'BUT',
    'NOT',
    'YOU',
    'ALL',
    'CAN',
    'HAD',
    'HER',
    'WAS',
    'ONE',
    'OUR',
    'OUT',
    'DAY',
    'GET',
    'HAS',
    'HIM',
    'HIS',
    'HOW',
    'ITS',
    'NEW',
    'NOW',
    'OLD',
    'SEE',
    'TWO',
    'WHO',
    'BOY',
    'DID',
    'MAY',
    'PUT',
    'SAY',
    'SHE',
    'TOO',
    'USE',
    'CEO',
    'CFO',
    'IPO',
    'API',
    'URL',
    'GPS',
    'DVD',
    'USB',
    'RAM',
    'CPU',
    'GPU',
    'SSD',
    'HDD',
    'LCD',
    'LED',
    'PDF',
    'FAQ',
    'LOL',
    'OMG',
    'TBH',
    'IMO',
    'FYI',
    'ETA',
    'EOD',
    'COD',
    'VIP',
    'CEO',
    'CTO',
    'CMO',
  ]);

  return commonWords.has(word);
}

/**
 * Remove duplicate symbols based on ticker and exchange
 */
function deduplicateSymbols(symbols: ExtractedSymbol[]): ExtractedSymbol[] {
  const seen = new Set<string>();
  const result: ExtractedSymbol[] = [];

  for (const symbol of symbols) {
    const key = `${symbol.ticker}:${symbol.exchange || 'null'}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(symbol);
    }
  }

  return result;
}

/**
 * Extract all financial symbols from text
 *
 * @param text - Input text to extract symbols from
 * @returns Array of extracted and normalized symbols
 *
 * @example
 * ```typescript
 * const text = "Buying $TSLA and $AAPL today. Also looking at BTC and 005930.KS";
 * const symbols = extractSymbolsFromText(text);
 * // Returns:
 * // [
 * //   { raw: "$TSLA", ticker: "TSLA", kind: "STOCK" },
 * //   { raw: "$AAPL", ticker: "AAPL", kind: "STOCK" },
 * //   { raw: "BTC", ticker: "BTC", kind: "CRYPTO" },
 * //   { raw: "005930.KS", ticker: "005930", exchange: "KS", kind: "STOCK" }
 * // ]
 * ```
 */
export function extractSymbolsFromText(text: string): ExtractedSymbol[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const allSymbols: ExtractedSymbol[] = [];

  // Extract stock symbols with $ prefix
  const stockSymbols = extractStockSymbols(text);
  allSymbols.push(...stockSymbols);

  // Extract Korean stock symbols
  const koreanStockSymbols = extractKoreanStockSymbols(text);
  allSymbols.push(...koreanStockSymbols);

  // Create set of already found tickers to avoid duplicates in crypto extraction
  const foundTickers = new Set(
    [...stockSymbols, ...koreanStockSymbols].map(s => s.ticker)
  );

  // Extract crypto symbols (excluding already found stock tickers)
  const cryptoSymbols = extractCryptoSymbols(text, foundTickers);
  allSymbols.push(...cryptoSymbols);

  // Remove duplicates and return
  return deduplicateSymbols(allSymbols);
}

/**
 * Validate if a ticker symbol is valid
 */
export function isValidTicker(ticker: string): boolean {
  if (!ticker || typeof ticker !== 'string') {
    return false;
  }

  const normalized = ticker.trim().toUpperCase();

  // Must be 1-6 characters for stocks, 2-5 for crypto
  if (normalized.length < 1 || normalized.length > 6) {
    return false;
  }

  // Must contain only letters and numbers
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    return false;
  }

  return true;
}

/**
 * Format symbol for display
 */
export function formatSymbol(symbol: ExtractedSymbol): string {
  if (symbol.kind === 'STOCK' && !symbol.ticker.startsWith('$')) {
    const base = `$${symbol.ticker}`;
    return symbol.exchange ? `${base}.${symbol.exchange}` : base;
  }

  return symbol.ticker;
}

/**
 * Get symbol information for database storage
 */
export function getSymbolInfo(symbol: ExtractedSymbol): {
  ticker: string;
  exchange: string | null;
  kind: 'STOCK' | 'CRYPTO' | null;
} {
  return {
    ticker: symbol.ticker,
    exchange: symbol.exchange || null,
    kind: symbol.kind || null,
  };
}

// Export patterns for testing
export const symbolPatterns = SYMBOL_PATTERNS;
export const cryptoSymbols = CRYPTO_SYMBOLS;
