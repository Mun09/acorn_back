/**
 * Simple test script for symbol extraction utilities
 */
import { extractSymbolsFromText, formatSymbol, getSymbolInfo } from './symbols';

// Test cases
const testCases = [
  'Buying $TSLA and $AAPL today. Also looking at BTC and ETH.',
  'Korean stocks: 005930.KS and 035720.KQ are performing well.',
  'Mixed: $NVDA, 005930, BTC, and $GOOGL.NASDAQ',
  'False positives: THE AND FOR BUT crypto like BTC is real.',
  'Edge cases: $A, $SYMBOL, TOOLONG, 12, $123ABC',
  'Exchange codes: $TSLA.NYSE, 005930.KS, ETH, $AAPL',
];

console.log('🧪 Testing Symbol Extraction Utilities\n');

testCases.forEach((text, index) => {
  console.log(`Test ${index + 1}: "${text}"`);
  const symbols = extractSymbolsFromText(text);

  if (symbols.length === 0) {
    console.log('  No symbols found\n');
    return;
  }

  symbols.forEach(symbol => {
    console.log(`  ✓ Found: ${JSON.stringify(symbol)}`);
    console.log(`    Formatted: ${formatSymbol(symbol)}`);
    console.log(`    DB Info: ${JSON.stringify(getSymbolInfo(symbol))}`);
  });
  console.log('');
});

console.log('✅ Symbol extraction test completed!');
