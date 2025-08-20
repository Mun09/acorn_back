import { extractSymbolsFromText } from './symbols';

const testText =
  'Looking at $NVDA and $AMD for tech plays. Also considering BTC and ETH for crypto exposure. Korean stocks like 005930.KS are interesting too.';

console.log('Input text:', testText);
console.log(
  'Extracted symbols:',
  JSON.stringify(extractSymbolsFromText(testText), null, 2)
);
