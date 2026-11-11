import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CALENDAR_FILE = 'data/calendar.json';
const MARKET_FILE = 'data/market.json';
const PRE_NEWS_FILE = 'data/prenews.json';
const PRE_NEWS_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
const PRE_NEWS_WINDOW_MS = 2 * 60 * 60 * 1000;
const FOREX_SYMBOLS = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD'];

const KEYWORDS = /fed|fomc|interest rate|rate decision|bank rate|cash rate|policy rate|inflation|cpi|ppi|pce|payroll|employment|unemployment|jobless|claimant|adp|jolts|hourly earnings|wage|gdp|pmi|ism|retail sales|consumer confidence|consumer sentiment|michigan|business confidence|sentix|zew|ifo|durable goods|industrial production|manufacturing|factory orders|wholesale|housing|building permits|home sales|trade balance|balance of trade|current account|powell|lagarde|bailey|ueda|bullock|macklem|treasury|oil|crude|energy|gas|opec|eia|api|rig|inventories|distillate|gasoline/i;
const ALLOWED_COUNTRIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD'];
const EXCLUDE_TITLE = /bond auction|bill auction|note auction|treasury auction|wasde|redbook|mortgage applications|mortgage rate|foreign exchange reserves/i;

function normalizeMarket(market) {
  if (market && typeof market === 'object') {
    const gold = Number(market.price ?? market.gold);
    return {
      gold: Number.isFinite(gold) && gold > 0 ? gold : null,
      forex: market.forex && typeof market.forex === 'object' ? market.forex : null,
      crypto: market.crypto && typeof market.crypto === 'object' ? market.crypto : null
    };
  }
  const gold = Number(market);
  return { gold: Number.isFinite(gold) && gold > 0 ? gold : null, forex: null, crypto: null };
}

export function updatePreNewsStore(store, events, market, now = Date.now()) {
  const next = {};
  for (const [key, entry] of Object.entries(store || {})) {
    const capturedAt = entry && typeof entry === 'object' ? entry.capturedAt : null;
    const t = new Date(capturedAt || key.split('|')[0]).getTime();
    if (Number.isFinite(t) && now - t <= PRE_NEWS_HOLD_MS) next[key] = entry;
  }

  const { gold, forex, crypto } = normalizeMarket(market);
  const hasPrices = gold != null || (forex && Object.keys(forex).length) || (crypto && Object.keys(crypto).length);
  if (!hasPrices) return next;

  for (const ev of events || []) {
    if (Number(ev.Importance) < 2) continue;
    const t = new Date(ev.Date).getTime();
    if (!Number.isFinite(t) || t <= now || t - now > PRE_NEWS_WINDOW_MS) continue;
    const key = `${ev.Date}|${ev.Event}`;
    const prevRaw = next[key] && typeof next[key] === 'object' ? next[key] : {};
    const prev = { ...prevRaw };
    if (prev.gold == null && prev.price != null) prev.gold = Number(prev.price);
    delete prev.price;
    const snap = { ...prev, capturedAt: new Date(now).toISOString() };
    if (gold != null) snap.gold = gold;
    if (forex) snap.forex = { ...(prev.forex || {}), ...forex };
    if (crypto) snap.crypto = { ...(prev.crypto || {}), ...crypto };
    next[key] = snap;
  }
  return next;
}

async function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) ?? fallback;
  } catch {
    return fallback;
  }
}

function formatTvValue(val, unit, scale) {
  if (val === null || val === undefined || val === '') return '';
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  const s = scale && ['K', 'M', 'B', 'T'].includes(String(scale).toUpperCase()) ? String(scale).toUpperCase() : '';
  const u = unit === '%' ? '%' : '';
  return `${n}${s}${u}`;
}

function mapTvImportance(imp) {
  if (imp === 1) return 3;
  if (imp === 0) return 2;
  return 1;
}

function normalizeCountry(c) {
  const u = String(c || '').trim().toUpperCase();
  return ({ US: 'USD', EU: 'EUR', GB: 'GBP', JP: 'JPY', AU: 'AUD', NZ: 'NZD', CA: 'CAD' }[u] || u);
}

function eventDedupKey(e) {
  const t = new Date(e.Date).getTime();
  const minuteBucket = Number.isFinite(t) ? Math.round(t / 60000) : String(e.Date || '');
  const titleNorm = String(e.Event || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${minuteBucket}|${normalizeCountry(e.Country)}|${titleNorm}`;
}

async function fetchTradingViewCalendar(now = new Date()) {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const tenDaysAgo = now.getTime() - 10 * 24 * 60 * 60 * 1000;
  const from = new Date(Math.min(monthStart, tenDaysAgo)).toISOString();
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=US,EU,GB,JP,AU,NZ,CA`;

  try {
    const r = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        'origin': 'https://www.tradingview.com',
        'referer': 'https://www.tradingview.com/'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) {
      console.warn('TradingView calendar HTTP', r.status);
      return [];
    }
    const j = await r.json();
    const list = Array.isArray(j?.result) ? j.result : [];
    return list
      .filter(e => {
        const country = normalizeCountry(e.currency || e.country);
        const title = String(e.title || '');
        if (!ALLOWED_COUNTRIES.includes(country)) return false;
        if (EXCLUDE_TITLE.test(title)) return false;
        return KEYWORDS.test(title) || mapTvImportance(e.importance) >= 2;
      })
      .map(e => ({
        Date: e.date,
        Event: e.title,
        Country: normalizeCountry(e.currency || e.country),
        Importance: mapTvImportance(e.importance),
        Forecast: formatTvValue(e.forecast, e.unit, e.scale),
        Previous: formatTvValue(e.previous, e.unit, e.scale),
        Actual: formatTvValue(e.actual, e.unit, e.scale),
        Unit: e.unit || '',
        Scale: e.scale || '',
        Source: 'TradingView'
      }));
  } catch (err) {
    console.warn('TradingView calendar gagal:', err.message);
    return [];
  }
}

async function fetchForexFactoryCalendar() {
  const urls = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json'
  ];
  const rank = { Low: 1, Medium: 2, High: 3 };

  for (const u of urls) {
    try {
      const r = await fetch(u, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12000)
      });
      if (!r.ok) continue;
      const batch = await r.json();
      if (!Array.isArray(batch)) continue;
      return batch
        .filter(e => ALLOWED_COUNTRIES.includes(normalizeCountry(e.country)) && KEYWORDS.test(e.title || ''))
        .map(e => ({
          Date: e.date,
          Event: e.title,
          Country: normalizeCountry(e.country),
          Importance: rank[e.impact] || 1,
          Forecast: e.forecast ?? '',
          Previous: e.previous ?? '',
          Actual: e.actual ?? '',
          Source: 'ForexFactory'
        }));
    } catch {
      // try next mirror
    }
  }
  return [];
}

function mergeCalendarEvents(existing, fresh, now = new Date()) {
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const minKeepTime = Math.min(currentMonthStart, now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const map = new Map();

  const upsert = (ev, preferFresh) => {
    const t = new Date(ev.Date).getTime();
    if (!Number.isFinite(t) || t < minKeepTime) return;
    const key = eventDedupKey(ev);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, ev);
      return;
    }
    const prevHasActual = String(prev.Actual ?? '').trim() !== '';
    const currHasActual = String(ev.Actual ?? '').trim() !== '';
    if (currHasActual && !prevHasActual) {
      map.set(key, { ...prev, ...ev });
    } else if (preferFresh && (currHasActual || !prevHasActual)) {
      map.set(key, {
        ...prev,
        ...ev,
        Actual: currHasActual ? ev.Actual : prev.Actual,
        Forecast: String(ev.Forecast ?? '').trim() !== '' ? ev.Forecast : prev.Forecast,
        Previous: String(ev.Previous ?? '').trim() !== '' ? ev.Previous : prev.Previous,
      });
    }
  };

  for (const ev of existing || []) upsert(ev, false);
  for (const ev of fresh || []) upsert(ev, true);

  return [...map.values()].sort((a, b) => new Date(a.Date) - new Date(b.Date));
}

// 1. AMBIL DATA KALENDER RIIL MARKET (TradingView primary + ForexFactory fallback, merge ke bulan berjalan)
export async function fetchCalendar() {
  const now = new Date();
  const existingRaw = await readJsonSafe(CALENDAR_FILE, []);
  const existing = Array.isArray(existingRaw) ? existingRaw : existingRaw?.events || [];

  const [tvEvents, ffEvents] = await Promise.all([
    fetchTradingViewCalendar(now),
    fetchForexFactoryCalendar()
  ]);

  // Utamakan TradingView karena menyediakan Actual, Forecast, dan Previous riil pasca rilis.
  // Dari ForexFactory hanya ambil pidato/rapat bank sentral yang tidak ada di TradingView, atau pakai penuh jika TradingView gagal.
  const tvSpeechKeys = new Set(tvEvents.map(e => `${Math.round(new Date(e.Date).getTime() / 60000)}|${e.Country}`));
  const ffExtra = tvEvents.length > 0
    ? ffEvents.filter(e => /speak|speech|meeting|minutes|press/i.test(e.Event) && !tvSpeechKeys.has(`${Math.round(new Date(e.Date).getTime() / 60000)}|${e.Country}`))
    : ffEvents;
  const combinedFresh = tvEvents.length > 0 ? [...tvEvents, ...ffExtra] : ffEvents;
  if (combinedFresh.length === 0 && existing.length > 0) {
    console.warn('Feed kalender kosong; mempertahankan data/calendar.json yang ada.');
    return existing;
  }

  const cleanExisting = tvEvents.length > 0
    ? existing.filter(e => e.Source !== 'ForexFactory' || /speak|speech|meeting|minutes|press/i.test(e.Event || ''))
    : existing;
  const merged = mergeCalendarEvents(cleanExisting, combinedFresh, now);
  await fs.mkdir('data', { recursive: true });
  await fs.writeFile(CALENDAR_FILE, JSON.stringify(merged, null, 2));
  const withActual = merged.filter(e => String(e.Actual ?? '').trim() !== '').length;
  console.log(`Berhasil menyimpan calendar.json dengan ${merged.length} berita (${withActual} memiliki Actual).`);
  return merged;
}

// 2. AMBIL HARGA EMAS (Gold API + CoinGecko PAXG fallback + Twelve Data optional)
async function fetchMarket() {
  const existingMarket = await readJsonSafe(MARKET_FILE, {});
  const key = process.env.TWELVE_DATA_API_KEY;

  if (key) {
    try {
      const r = await fetch(`https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${key}`, {
        signal: AbortSignal.timeout(12000)
      });
      const j = await r.json();
      const price = Number(j.close);
      if (r.ok && j.status !== 'error' && Number.isFinite(price) && price > 0) {
        await fs.writeFile(MARKET_FILE, JSON.stringify({
          generatedAt: new Date().toISOString(),
          symbol: 'XAU/USD',
          price: String(price),
          change: j.change ?? '',
          percentChange: j.percent_change ?? '',
          previousClose: j.previous_close ?? existingMarket.previousClose ?? ''
        }, null, 2));
        console.log('Berhasil menyimpan market.json dari Twelve Data:', price);
        return price;
      }
    } catch (e) {
      console.warn('Twelve Data gagal:', e.message);
    }
  }

  try {
    const r = await fetch('https://api.gold-api.com/price/XAU', { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const price = Number(j.price);
    if (Number.isFinite(price) && price > 0) {
      await fs.writeFile(MARKET_FILE, JSON.stringify({
        generatedAt: new Date().toISOString(),
        symbol: 'XAU/USD',
        price: String(price),
        change: '',
        percentChange: '',
        previousClose: existingMarket.previousClose ?? ''
      }, null, 2));
      console.log('Berhasil menyimpan market.json dengan harga', price);
      return price;
    }
  } catch (e) {
    console.warn('Gold API gagal:', e.message);
  }

  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd', {
      signal: AbortSignal.timeout(12000)
    });
    const j = await r.json();
    const price = Number(j?.['pax-gold']?.usd);
    if (Number.isFinite(price) && price > 0) {
      await fs.writeFile(MARKET_FILE, JSON.stringify({
        generatedAt: new Date().toISOString(),
        symbol: 'XAU/USD',
        price: String(price),
        change: '',
        percentChange: '',
        previousClose: existingMarket.previousClose ?? ''
      }, null, 2));
      console.log('Berhasil menyimpan market.json dari CoinGecko PAXG:', price);
      return price;
    }
  } catch (e) {
    console.error('Gagal mengambil harga emas', e);
  }
  return null;
}

async function fetchForex() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const rates = j && j.rates;
    if (!rates) return null;
    const out = {};
    for (const s of FOREX_SYMBOLS) {
      const v = Number(rates[s]);
      if (Number.isFinite(v) && v > 0) out[s] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch (e) {
    console.error('Gagal mengambil kurs forex', e);
    return null;
  }
}

async function fetchCrypto() {
  const endpoints = [
    'https://data-api.binance.vision/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]',
    'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]'
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j)) {
        const btc = j.find(x => x.symbol === 'BTCUSDT');
        const eth = j.find(x => x.symbol === 'ETHUSDT');
        const out = { 'BTC/USD': Number(btc && btc.price), 'ETH/USD': Number(eth && eth.price) };
        if (out['BTC/USD'] > 0 && out['ETH/USD'] > 0) return out;
      }
    } catch {
      // fallback to next
    }
  }
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd', {
      signal: AbortSignal.timeout(10000)
    });
    const j = await r.json();
    const out = { 'BTC/USD': Number(j.bitcoin && j.bitcoin.usd), 'ETH/USD': Number(j.ethereum && j.ethereum.usd) };
    if (out['BTC/USD'] > 0 && out['ETH/USD'] > 0) return out;
  } catch (e) {
    console.error('CoinGecko crypto gagal', e);
  }
  return null;
}

export async function main() {
  const events = await fetchCalendar();
  const [price, forex, crypto] = await Promise.all([fetchMarket(), fetchForex(), fetchCrypto()]);
  const store = updatePreNewsStore(await readJsonSafe(PRE_NEWS_FILE, {}), events, { price, forex, crypto });
  await fs.writeFile(PRE_NEWS_FILE, JSON.stringify(store, null, 2));
  console.log('Snapshot harga pra-news tersimpan:', Object.keys(store).length, 'event.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
