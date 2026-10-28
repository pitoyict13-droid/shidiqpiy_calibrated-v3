import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}() not found in index.html`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}()`);
}

const numFn = extractFunction('num');
const countryFn = extractFunction('countryCode');
const biasFn = extractFunction('goldBias');
const analyzeFn = extractFunction('analyze');
const analyze = new Function(`${numFn}\n${countryFn}\n${biasFn}\n${analyzeFn}\nreturn analyze;`)();

const cases = [
  [{Event:'Nonfarm Payrolls', Actual:150000, Forecast:200000}, 'long'],
  [{Event:'Nonfarm Payrolls', Actual:250000, Forecast:200000}, 'short'],
  [{Event:'Unemployment Rate', Actual:4.2, Forecast:4.0}, 'long'],
  [{Event:'Unemployment Rate', Actual:3.8, Forecast:4.0}, 'short'],
  [{Event:'Initial Jobless Claims', Actual:230000, Forecast:220000}, 'long'],
  [{Event:'Initial Jobless Claims', Actual:210000, Forecast:220000}, 'short'],
  [{Event:'CPI', Actual:2.8, Forecast:3.0}, 'long'],
  [{Event:'CPI', Actual:3.2, Forecast:3.0}, 'short'],
  [{Event:'Unknown Indicator', Actual:10, Forecast:9}, 'wait'],
  [{Event:'CPI', Actual:null, Forecast:3.0}, 'wait'],
];

for (const [input, expected] of cases) {
  assert.equal(analyze(input).dir, expected, JSON.stringify(input));
}

console.log(`Passed ${cases.length}/${cases.length} actual index.html signal tests`);

// Post-news regression: momentum is calculated per pair (not gold for every pair).
const tpSlFn = extractFunction('tpSl');
const pairRateFromFn = extractFunction('pairRateFrom');
const pairRateFn = extractFunction('pairRate');
const newsPhaseFn = extractFunction('newsPhase');
const momentumForFn = extractFunction('momentumFor');
const postNewsMomentumFn = extractFunction('postNewsMomentum');
const eventAssetsFn = extractFunction('eventAssets');
const focusPairFn = extractFunction('focusPair');
const normalizeSnapshotFn = extractFunction('normalizeSnapshot');
const preNewsSnapshotFn = extractFunction('preNewsSnapshot');
const preNewsPriceFn = extractFunction('preNewsPrice');
const eventKeyFn = extractFunction('eventKey');
const dateEventKeyFn = extractFunction('dateEventKey');
const postNewsExpiryFn = extractFunction('postNewsExpiry');

function buildTpSl(livePrice, forexRates, cryptoRates, store, preNews = {}) {
  const body = `
    const WITA = 'Asia/Makassar';
    const POST_NEWS_HOLD_MS = 6 * 60 * 60 * 1000;
    const NEWS_SETTLE_MS = 60 * 1000;
    const fmtDate = d => new Intl.DateTimeFormat('en-IN', { timeZone: WITA, weekday: 'short', day: '2-digit', month: 'short' }).format(d);
    const fmtTime = d => new Intl.DateTimeFormat('en-IN', { timeZone: WITA, hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' WITA';
    ${countryFn}
    ${normalizeSnapshotFn}
    ${dateEventKeyFn}
    ${eventKeyFn}
    ${preNewsSnapshotFn}
    ${preNewsPriceFn}
    ${newsPhaseFn}
    ${pairRateFromFn}
    ${pairRateFn}
    ${momentumForFn}
    ${postNewsMomentumFn}
    ${eventAssetsFn}
    ${focusPairFn}
    ${postNewsExpiryFn}
    ${tpSlFn}
    return tpSl;
  `;
  return new Function('LIVE_PRICE', 'FOREX_RATES', 'CRYPTO_RATES', 'localStorage', 'PRE_NEWS', body)(livePrice, forexRates, cryptoRates, store, preNews);
}

const forexRates = { EUR: 0.92, GBP: 0.79, JPY: 150, CHF: 0.88, AUD: 0.65, CAD: 1.36 };
const cryptoRates = { 'BTC/USD': 65000, 'ETH/USD': 3200 };
const noStore = { getItem: () => null, setItem: () => {} };
const jsonStore = value => ({ getItem: () => JSON.stringify(value), setItem: () => {} });
const baseSnapshot = {
  gold: 3900,
  forex: { EUR: 0.95, GBP: 0.80, JPY: 155, CHF: 0.90, AUD: 0.66, CAD: 1.38 },
  crypto: { 'BTC/USD': 62000, 'ETH/USD': 3000 },
  capturedAt: new Date().toISOString(),
};

const pastUsd = { Date: new Date(Date.now() - 60 * 60 * 1000).toISOString(), Event: 'CPI', Country: 'USD', Importance: 3, Forecast: '3.0%', Actual: '' };
const pastAud = { ...pastUsd, Event: 'CPI m/m', Country: 'AUD' };
const futureUsd = { Date: new Date(Date.now() + 60 * 60 * 1000).toISOString(), Event: 'Nonfarm Payrolls', Country: 'USD', Importance: 3, Forecast: '200K', Actual: '' };

const breakoutHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, pastUsd);
assert.match(breakoutHtml, /POST-NEWS/);
assert.match(breakoutHtml, /BUY/);
assert.match(breakoutHtml, /SELL/);
assert.match(breakoutHtml, /TP:/);
assert.match(breakoutHtml, /EUR\/USD/);
assert.match(breakoutHtml, /BTC\/USD/);

// USD event: every USD-quoted pair uses its own momentum.
const usdHtml = buildTpSl(4000, forexRates, cryptoRates, jsonStore(baseSnapshot))({ dir: 'wait', score: 40 }, pastUsd);
assert.match(usdHtml, /POST-NEWS/);
assert.match(usdHtml, /XAU\/USD \(Gold\) — BUY/);
assert.match(usdHtml, /dari 3900\.00/);
assert.match(usdHtml, /EUR\/USD <b>BUY<\/b>/);
assert.match(usdHtml, /USD\/JPY <b>SELL<\/b>/);
assert.match(usdHtml, /BTC\/USD <b>BUY<\/b>/);

// AUD event: only AUD/USD gets a directional signal; gold and crypto panels are hidden.
const audHtml = buildTpSl(4000, forexRates, cryptoRates, jsonStore(baseSnapshot))({ dir: 'wait', score: 40 }, pastAud);
assert.match(audHtml, /POST-NEWS/);
assert.match(audHtml, /AUD\/USD <b>BUY<\/b>/);
assert.match(audHtml, /\+1\.54%/);
assert.doesNotMatch(audHtml, /XAU\/USD/);
assert.doesNotMatch(audHtml, /BTC\/USD/);
assert.doesNotMatch(audHtml, /ETH\/USD/);
assert.doesNotMatch(audHtml, /POST-NEWS BREAKOUT \(OCO\)/);
assert.doesNotMatch(audHtml, /EUR\/USD <b>BUY<\/b>/);
assert.doesNotMatch(audHtml, /USD\/JPY <b>SELL<\/b>/);

// AUD pre-news: no gold straddle or crypto panel either.
const futureAud = { ...futureUsd, Event: 'CPI m/m', Country: 'AUD' };
const audStraddleHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, futureAud);
assert.match(audStraddleHtml, /AUD\/USD/);
assert.doesNotMatch(audStraddleHtml, /XAU\/USD/);
assert.doesNotMatch(audStraddleHtml, /STRATEGI STRADDLE \(OCO\)/);
assert.doesNotMatch(audStraddleHtml, /BTC\/USD/);
assert.doesNotMatch(audStraddleHtml, /ETH\/USD/);

// Directed AUD event must not leak a gold panel either.
const audDirectedHtml = buildTpSl(4000, forexRates, cryptoRates, jsonStore(baseSnapshot))({ dir: 'long', score: 70 }, pastAud);
assert.doesNotMatch(audDirectedHtml, /XAU\/USD/);
assert.doesNotMatch(audDirectedHtml, /BTC\/USD/);
assert.doesNotMatch(audDirectedHtml, /ETH\/USD/);

// Legacy localStorage snapshot (gold only) is merged with per-pair repo data.
const localGold = { getItem: () => '3900', setItem: () => {} };
const repoForex = { [`${pastUsd.Date}|CPI`]: { forex: baseSnapshot.forex, crypto: baseSnapshot.crypto } };
const mergedHtml = buildTpSl(4000, forexRates, cryptoRates, localGold, repoForex)({ dir: 'wait', score: 40 }, pastUsd);
assert.match(mergedHtml, /EUR\/USD <b>BUY<\/b>/);
assert.match(mergedHtml, /USD\/JPY <b>SELL<\/b>/);
assert.match(mergedHtml, /dari 3900\.00/);

// Legacy repo snapshot ({price}) is still treated as a gold base price.
const repoSnapshots = { [`${pastUsd.Date}|CPI`]: { price: 3950, capturedAt: pastUsd.Date } };
const repoHtml = buildTpSl(4000, forexRates, cryptoRates, noStore, repoSnapshots)({ dir: 'wait', score: 40 }, pastUsd);
assert.match(repoHtml, /XAU\/USD \(Gold\) — BUY/);
assert.match(repoHtml, /dari 3950\.00/);
assert.match(repoHtml, /EUR\/USD <b style="color:var\(--amber\)">BREAKOUT<\/b>/);

const straddleHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, futureUsd);
assert.match(straddleHtml, /STRADDLE/);
assert.match(straddleHtml, /BUY/);
assert.match(straddleHtml, /TP/);

const liveHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, { ...pastUsd, Date: new Date(Date.now() - 30 * 1000).toISOString() });
assert.match(liveHtml, /Rilis berlangsung/);

const lowImpactHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, { ...pastUsd, Importance: 1 });
assert.equal(lowImpactHtml, '');

const staleHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, { ...pastUsd, Date: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
assert.match(staleHtml, /kedaluwarsa/);
assert.doesNotMatch(staleHtml, /BUY/);

console.log('Passed post-news per-pair momentum + TP tests');

// Global crypto board: always visible outside event cards.
const boardStart = source.indexOf('id="cryptoBoard"');
const calendarStart = source.indexOf('id="calendar"');
assert.ok(boardStart > -1, 'crypto board section missing');
assert.ok(calendarStart > -1 && boardStart < calendarStart, 'crypto board must render before the calendar');

const cryptoBoardFn = extractFunction('cryptoBoardHtml');
const cryptoBoardHtml = new Function(`${cryptoBoardFn}\nreturn cryptoBoardHtml;`)();

const boardHtml = cryptoBoardHtml(
  { 'BTC/USD': 80934.65, 'ETH/USD': 3200.5 },
  { 'BTC/USD': 1.234, 'ETH/USD': -0.5 }
);
assert.match(boardHtml, /BTC\/USD/);
assert.match(boardHtml, /\$80,934\.65/);
assert.match(boardHtml, /\$3,200\.50/);
assert.match(boardHtml, /▲ \+1\.23% 24h/);
assert.match(boardHtml, /▼ -0\.50% 24h/);
assert.match(boardHtml, /SL\/TP 1% \/ 2%/);
assert.match(boardHtml, /SL\/TP 1\.5% \/ 3%/);

const boardNoChange = cryptoBoardHtml({ 'BTC/USD': 80000, 'ETH/USD': 3000 }, {});
assert.match(boardNoChange, /24h change n\/a/);
assert.doesNotMatch(boardNoChange, /NaN/);

const boardEmpty = cryptoBoardHtml({}, {});
assert.match(boardEmpty, /Menunggu harga crypto/);
assert.doesNotMatch(boardEmpty, /NaN|\$undefined/);

console.log('Passed global crypto board tests');

