import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PRE_NEWS_FILE = 'data/prenews.json';
const PRE_NEWS_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
const PRE_NEWS_WINDOW_MS = 30 * 60 * 1000;

export function updatePreNewsStore(store, events, price, now = Date.now()) {
  const next = {};
  for (const [key, entry] of Object.entries(store || {})) {
    const capturedAt = entry && typeof entry === 'object' ? entry.capturedAt : null;
    const t = new Date(capturedAt || key.split('|')[0]).getTime();
    if (Number.isFinite(t) && now - t <= PRE_NEWS_HOLD_MS) next[key] = entry;
  }

  const p = Number(price);
  if (Number.isFinite(p) && p > 0) {
    for (const ev of events || []) {
      if (Number(ev.Importance) < 2) continue;
      const t = new Date(ev.Date).getTime();
      if (!Number.isFinite(t) || t <= now || t - now > PRE_NEWS_WINDOW_MS) continue;
      next[`${ev.Date}|${ev.Event}`] = { price: p, capturedAt: new Date(now).toISOString() };
    }
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

export async function main() {
  const events = await fetchCalendar();
  const price = await fetchMarket();
  const store = updatePreNewsStore(await readPreNews(), events, price);
  await fs.writeFile(PRE_NEWS_FILE, JSON.stringify(store, null, 2));
  console.log('Snapshot harga pra-news tersimpan:', Object.keys(store).length, 'event.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
