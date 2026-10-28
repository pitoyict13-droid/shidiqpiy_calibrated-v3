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

// Post-news regression: after a release, every pair must expose BUY/SELL + TP levels.
const tpSlFn = extractFunction('tpSl');
const pairRateFn = extractFunction('pairRate');
const newsPhaseFn = extractFunction('newsPhase');
const postNewsMomentumFn = extractFunction('postNewsMomentum');
const preNewsPriceFn = extractFunction('preNewsPrice');
const eventKeyFn = extractFunction('eventKey');
const postNewsExpiryFn = extractFunction('postNewsExpiry');

function buildTpSl(livePrice, forexRates, cryptoRates, store) {
  const body = `
    const WITA = 'Asia/Makassar';
    const POST_NEWS_HOLD_MS = 6 * 60 * 60 * 1000;
    const NEWS_SETTLE_MS = 60 * 1000;
    const fmtDate = d => new Intl.DateTimeFormat('en-IN', { timeZone: WITA, weekday: 'short', day: '2-digit', month: 'short' }).format(d);
    const fmtTime = d => new Intl.DateTimeFormat('en-IN', { timeZone: WITA, hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' WITA';
    ${eventKeyFn}
    ${preNewsPriceFn}
    ${newsPhaseFn}
    ${postNewsMomentumFn}
    ${postNewsExpiryFn}
    ${pairRateFn}
    ${tpSlFn}
    return tpSl;
  `;
  return new Function('LIVE_PRICE', 'FOREX_RATES', 'CRYPTO_RATES', 'localStorage', body)(livePrice, forexRates, cryptoRates, store);
}

const forexRates = { EUR: 0.92, GBP: 0.79, JPY: 150, CHF: 0.88, AUD: 0.65, CAD: 1.36 };
const cryptoRates = { 'BTC/USD': 65000, 'ETH/USD': 3200 };
const noStore = { getItem: () => null, setItem: () => {} };
const pastEvent = { Date: new Date(Date.now() - 60 * 60 * 1000).toISOString(), Event: 'CPI', Country: 'USD', Importance: 3, Forecast: '3.0%', Actual: '' };
const futureEvent = { Date: new Date(Date.now() + 60 * 60 * 1000).toISOString(), Event: 'Nonfarm Payrolls', Country: 'USD', Importance: 3, Forecast: '200K', Actual: '' };

const breakoutHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, pastEvent);
assert.match(breakoutHtml, /POST-NEWS/);
assert.match(breakoutHtml, /BUY/);
assert.match(breakoutHtml, /SELL/);
assert.match(breakoutHtml, /TP:/);
assert.match(breakoutHtml, /EUR\/USD/);
assert.match(breakoutHtml, /BTC\/USD/);

const upStore = { getItem: () => '3900', setItem: () => {} };
const momentumHtml = buildTpSl(4000, forexRates, cryptoRates, upStore)({ dir: 'wait', score: 40 }, pastEvent);
assert.match(momentumHtml, /POST-NEWS BUY/);
assert.match(momentumHtml, /XAU\/USD \(Gold\) — BUY/);
assert.match(momentumHtml, /EUR\/USD <b>BUY<\/b>/);
assert.match(momentumHtml, /USD\/JPY <b>SELL<\/b>/);

const straddleHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, futureEvent);
assert.match(straddleHtml, /STRADDLE/);
assert.match(straddleHtml, /BUY/);
assert.match(straddleHtml, /TP/);

const liveHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, { ...pastEvent, Date: new Date(Date.now() - 30 * 1000).toISOString() });
assert.match(liveHtml, /Rilis berlangsung/);

const lowImpactHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, { ...pastEvent, Importance: 1 });
assert.equal(lowImpactHtml, '');

const staleHtml = buildTpSl(4000, forexRates, cryptoRates, noStore)({ dir: 'wait', score: 40 }, { ...pastEvent, Date: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
assert.match(staleHtml, /kedaluwarsa/);
assert.doesNotMatch(staleHtml, /BUY/);

console.log('Passed post-news BUY/SELL + TP tests');
