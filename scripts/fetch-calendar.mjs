import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PRE_NEWS_FILE = 'data/prenews.json';
const PRE_NEWS_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
const PRE_NEWS_WINDOW_MS = 2 * 60 * 60 * 1000;
const FOREX_SYMBOLS = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD'];

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

async function readPreNews() {
  try {
    return JSON.parse(await fs.readFile(PRE_NEWS_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

// 1. AMBIL DATA KALENDER (ForexFactory)
async function fetchCalendar() {
  const urls = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://nfs.faireconomy.media/ff_calendar_nextweek.json'
  ];
  
  const batches = await Promise.all(urls.map(async u => {
    try {
      const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  }));

  const rank = { Low: 1, Medium: 2, High: 3 };
  
  // FILTER KANADA & MINYAK/ENERGI DITAMBAHKAN DI SINI
  const keywords = /fed|fomc|interest rate|inflation|cpi|pce|payroll|employment|unemployment|jobless|gdp|pmi|ism|retail sales|consumer confidence|jolts|durable goods|powell|treasury|oil|crude|energy|gas|opec|eia|rig|inventories|distillate|gasoline/i;
  const allowedCountries = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD'];

  const events = batches.flat()
    .filter(e => allowedCountries.includes(String(e.country || '').toUpperCase()) && keywords.test(e.title || ''))
    .map(e => ({
      Date: e.date,
      Event: e.title,
      Country: e.country,
      Importance: rank[e.impact] || 1,
      Forecast: e.forecast || '',
      Previous: e.previous || '',
      Actual: e.actual || ''
    }));

  await fs.writeFile('data/calendar.json', JSON.stringify(events, null, 2));
  console.log('Berhasil menyimpan calendar.json dengan', events.length, 'berita.');
  return events;
}

// 2. AMBIL HARGA EMAS (Gold API)
async function fetchMarket() {
  try {
    const r = await fetch('https://api.gold-api.com/price/XAU');
    const j = await r.json();
    const price = Number(j.price);
    if (price > 0) {
      await fs.writeFile('data/market.json', JSON.stringify({
        generatedAt: new Date().toISOString(),
        symbol: "XAU/USD",
        price: String(price),
        change: "",
        percentChange: "",
        previousClose: ""
      }, null, 2));
      console.log('Berhasil menyimpan market.json dengan harga', price);
      return price;
    }
  } catch (e) {
    console.error('Gagal mengambil harga emas', e);
  }
  return null;
}

async function fetchForex() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
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
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]');
    const j = await r.json();
    if (Array.isArray(j)) {
      const btc = j.find(x => x.symbol === 'BTCUSDT');
      const eth = j.find(x => x.symbol === 'ETHUSDT');
      const out = { 'BTC/USD': Number(btc && btc.price), 'ETH/USD': Number(eth && eth.price) };
      if (out['BTC/USD'] > 0 && out['ETH/USD'] > 0) return out;
    }
  } catch (e) {
    console.error('Binance crypto gagal', e);
  }
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
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
  const store = updatePreNewsStore(await readPreNews(), events, { price, forex, crypto });
  await fs.writeFile(PRE_NEWS_FILE, JSON.stringify(store, null, 2));
  console.log('Snapshot harga pra-news tersimpan:', Object.keys(store).length, 'event.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
