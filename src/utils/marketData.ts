// =============================================================================
// Sumber harga & bar pasar.
//
// Urutan sumber (berlapis, yang paling baru menang):
//   1. Live dari browser : TradingView scanner (forex/XAU), gold-api, Binance
//   2. Snapshot server   : GET /api/market-data (membaca data/*.json dari disk)
//   3. File langsung     : data/*.json (mode statis / vite dev)
//   4. Tidak ada         : peta harga kosong -> tiket menolak Entry/SL/TP
//
// Tujuannya satu: Entry/SL/TP dihitung dari HARGA PASAR YANG TERSEDIA, bukan
// angka hardcode di server.
// =============================================================================

import type { MinuteBar, PriceQuote } from '../types/trading';
import { INSTRUMENT_LIST, normalizeSymbol, getInstrument } from './instruments.ts';

export interface MarketsFile {
  generatedAt?: string;
  pairs?: Record<string, { price?: number; previousClose?: number; bid?: number; ask?: number; spread?: number; bars?: MinuteBar[]; changePct?: number }>;
}

export interface ForexFile {
  generatedAt?: string;
  source?: string;
  quotes?: Record<string, { price?: number; changePct?: number }>;
}

export interface IndicesFile {
  generatedAt?: string;
  items?: { symbol?: string; price?: number; changePct?: number }[];
}

export interface CryptoFile {
  generatedAt?: string;
  pairs?: Record<string, number>;
}

export interface BrokerFile {
  generatedAt?: string;
  quotes?: Record<string, { bid?: number; ask?: number; mid?: number; spreadPips?: number }>;
}

export interface MarketDataBundle {
  markets?: MarketsFile | null;
  forex?: ForexFile | null;
  indices?: IndicesFile | null;
  crypto?: CryptoFile | null;
  broker?: BrokerFile | null;
  calendar?: unknown[] | null;
  source: string;
  generatedAt: string | null;
}

const BROKER_FRESH_MS = 30 * 60 * 1000;

const SCAN_TICKERS = [
  'OANDA:EURUSD', 'OANDA:GBPUSD', 'OANDA:USDJPY', 'OANDA:USDCHF', 'OANDA:AUDUSD',
  'OANDA:USDCAD', 'OANDA:NZDUSD', 'OANDA:GBPJPY', 'OANDA:EURJPY', 'OANDA:XAUUSD',
  'FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'FX:XAUUSD'
];

// --- Muat snapshot ---------------------------------------------------------------

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Ambil snapshot data. Urutan: endpoint server -> file langsung.
 * Semua gagal = bundle kosong (bukan error), caller yang memutuskan label UI.
 */
export async function fetchMarketSnapshot(): Promise<MarketDataBundle> {
  const server = await getJson('/api/market-data');
  if (server && server.markets) {
    return {
      markets: server.markets,
      forex: server.forex,
      indices: server.indices,
      crypto: server.crypto,
      broker: server.broker,
      calendar: server.calendar,
      source: 'server',
      generatedAt: server.generatedAt || null
    };
  }

  const [markets, forex, indices, crypto, broker, calendar] = await Promise.all([
    // Path absolut: benar baik saat dibuka dari / maupun /dist/index.html
    getJson('/data/markets.json'),
    getJson('/data/forex.json'),
    getJson('/data/indices.json'),
    getJson('/data/crypto.json'),
    getJson('/data/forex-broker.json'),
    getJson('/data/calendar.json')
  ]);

  return {
    markets,
    forex,
    indices,
    crypto,
    broker,
    calendar,
    source: markets || forex ? 'file' : 'none',
    generatedAt: (markets && markets.generatedAt) || (forex && forex.generatedAt) || null
  };
}

// --- Bangun peta harga ------------------------------------------------------------

const spreadFor = (symbol: string, bid: number, ask: number): number => {
  const inst = getInstrument(symbol);
  const pip = inst ? inst.pipSize : 0.0001;
  const diff = Math.abs(ask - bid);
  if (diff > 0) return Number((diff / pip).toFixed(2));
  return inst ? inst.spreadPips : 1;
};

function put(
  map: Record<string, PriceQuote>,
  rawSymbol: string,
  fields: { mid?: number; bid?: number; ask?: number; changePct?: number | null; source: string; at?: string }
): void {
  const symbol = normalizeSymbol(rawSymbol);
  if (!getInstrument(symbol)) return;
  const inst = getInstrument(symbol)!;
  let { bid, ask } = fields;
  let mid = fields.mid;
  if (!Number.isFinite(mid as number) && Number.isFinite(bid as number) && Number.isFinite(ask as number)) {
    mid = ((bid as number) + (ask as number)) / 2;
  }
  if (!Number.isFinite(mid as number)) return;
  mid = Number((mid as number).toFixed(inst.digits));
  if (!Number.isFinite(bid as number)) bid = mid;
  if (!Number.isFinite(ask as number)) ask = mid;
  if ((bid as number) > (ask as number)) {
    const t = bid;
    bid = ask;
    ask = t;
  }
  // Snapshot sering hanya punya mid (bid == ask). Beri spread tipikal instrumen
  // agar entry BUY (ask) dan SELL (bid) tidak berbeda nol dari harga tengah.
  if ((bid as number) === (ask as number)) {
    const half = (inst.spreadPips * inst.pipSize) / 2;
    bid = Number(((mid as number) - half).toFixed(inst.digits));
    ask = Number(((mid as number) + half).toFixed(inst.digits));
  }

  const existing = map[symbol];
  // Prioritas: broker (bid/ask asli) > live > snapshot.
  const rank = (src: string) => (src.includes('broker') ? 3 : src.includes('live') ? 2 : 1);
  if (existing && rank(existing.source) > rank(fields.source)) return;

  map[symbol] = {
    symbol,
    bid: Number(bid),
    ask: Number(ask),
    mid: mid as number,
    spreadPips: spreadFor(symbol, Number(bid), Number(ask)),
    source: fields.source,
    changePct: fields.changePct ?? existing?.changePct ?? null,
    updatedAt: fields.at || undefined
  };
}

/** Susun peta harga dari semua file snapshot (ditimpa live oleh caller). */
export function buildPriceMap(bundle: MarketDataBundle, now: number = Date.now()): Record<string, PriceQuote> {
  const map: Record<string, PriceQuote> = {};

  const generatedAt = bundle.markets?.generatedAt || bundle.forex?.generatedAt || '';
  const snapLabel = `snapshot${generatedAt ? ` ${new Date(generatedAt).toLocaleTimeString('id-ID')}` : ''}`;

  const forexQuotes = bundle.forex?.quotes || {};
  for (const [pair, q] of Object.entries(forexQuotes)) {
    if (!q || !Number.isFinite(q.price as number)) continue;
    put(map, pair, { mid: q.price, changePct: q.changePct ?? null, source: `forex.json ${snapLabel}` });
  }

  const marketPairs = bundle.markets?.pairs || {};
  for (const [pair, p] of Object.entries(marketPairs)) {
    if (!p) continue;
    const mid = Number.isFinite(p.price as number) ? (p.price as number) : undefined;
    const bid = Number.isFinite(p.bid as number) ? (p.bid as number) : undefined;
    const ask = Number.isFinite(p.ask as number) ? (p.ask as number) : undefined;
    // hitung perubahan % dari previousClose bila file tidak menyimpan changePct
    let changePct = p.changePct ?? null;
    if ((changePct === null || changePct === undefined) && mid && Number.isFinite(p.previousClose as number) && (p.previousClose as number) > 0) {
      changePct = Number((((mid - (p.previousClose as number)) / (p.previousClose as number)) * 100).toFixed(2));
    }
    put(map, pair, { mid, bid, ask, changePct, source: `markets.json ${snapLabel}` });
  }

  for (const item of bundle.indices?.items || []) {
    if (!item || !item.symbol || !Number.isFinite(item.price as number)) continue;
    put(map, item.symbol, { mid: item.price, changePct: item.changePct ?? null, source: `indices.json ${snapLabel}` });
  }

  const cryptoPairs = bundle.crypto?.pairs || {};
  for (const [pair, price] of Object.entries(cryptoPairs)) {
    if (!Number.isFinite(price as number)) continue;
    put(map, pair, { mid: price as number, source: `crypto.json ${snapLabel}` });
  }

  // Broker MT5 (bid/ask asli) bila masih segar.
  const brokerAt = Date.parse(bundle.broker?.generatedAt || '');
  if (Number.isFinite(brokerAt) && now - brokerAt <= BROKER_FRESH_MS) {
    for (const [pair, q] of Object.entries(bundle.broker?.quotes || {})) {
      if (!q || !Number.isFinite(q.bid as number) || !Number.isFinite(q.ask as number)) continue;
      put(map, pair, {
        bid: q.bid,
        ask: q.ask,
        mid: Number.isFinite(q.mid as number) ? q.mid : ((q.bid as number) + (q.ask as number)) / 2,
        source: 'broker MT5 (live)',
        at: bundle.broker?.generatedAt || undefined
      });
    }
  }

  return map;
}

export function barsFromBundle(bundle: MarketDataBundle): Record<string, MinuteBar[]> {
  const out: Record<string, MinuteBar[]> = {};
  for (const [pair, p] of Object.entries(bundle.markets?.pairs || {})) {
    const symbol = normalizeSymbol(pair);
    if (p && Array.isArray(p.bars) && p.bars.length) out[symbol] = p.bars;
  }
  return out;
}

export function availableSymbols(prices: Record<string, PriceQuote>): string[] {
  return INSTRUMENT_LIST.map((i) => i.symbol).filter((s) => prices[s] && Number.isFinite(prices[s].mid));
}

// --- Harga live -------------------------------------------------------------------

interface LiveResult {
  prices: Record<string, Partial<PriceQuote> & { symbol: string }>;
  source: string;
}

/** TradingView scanner (forex + XAU): simple request, content-type text/plain. */
async function fetchScannerQuotes(): Promise<LiveResult> {
  const res = await fetch('https://scanner.tradingview.com/forex/scan', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ symbols: { tickers: SCAN_TICKERS }, columns: ['name', 'close', 'change', 'update_mode'] }),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`scanner HTTP ${res.status}`);
  const payload = await res.json();
  const rows: any[] = Array.isArray(payload && payload.data) ? payload.data : [];
  const prices: LiveResult['prices'] = {};

  const wanted = SCAN_TICKERS.map((t) => t.split(':')[1]);
  for (const row of rows) {
    const parts = String((row && row.s) || '').split(':');
    const symbol = parts[1];
    if (!symbol || wanted.indexOf(symbol) === -1) continue;
    const close = Number(row.d && row.d[1]);
    if (!Number.isFinite(close) || close <= 0) continue;
    if (!prices[symbol]) prices[symbol] = { symbol, mid: close };
  }
  return { prices, source: 'live TradingView' };
}

async function fetchGoldQuote(): Promise<LiveResult> {
  const json = await getJson('https://api.gold-api.com/price/XAU');
  const price = Number(json && (json.price ?? json.value));
  if (!Number.isFinite(price) || price <= 0) throw new Error('gold-api tanpa harga');
  return { prices: { XAUUSD: { symbol: 'XAUUSD', mid: price } }, source: 'live gold-api' };
}

async function fetchCryptoQuotes(): Promise<LiveResult> {
  const url = 'https://api.binance.com/api/v3/ticker/price?symbols=' + encodeURIComponent('["BTCUSDT","ETHUSDT"]');
  const json = await getJson(url);
  if (!Array.isArray(json)) throw new Error('binance gagal');
  const prices: LiveResult['prices'] = {};
  for (const row of json) {
    const symbol = row && row.symbol === 'BTCUSDT' ? 'BTCUSD' : row && row.symbol === 'ETHUSDT' ? 'ETHUSD' : null;
    const price = Number(row && row.price);
    if (symbol && Number.isFinite(price) && price > 0) prices[symbol] = { symbol, mid: price };
  }
  if (!Object.keys(prices).length) throw new Error('binance kosong');
  return { prices, source: 'live Binance' };
}

let liveRetryAt = 0;
let liveFailures = 0;

/**
 * Tarik harga live dari beberapa sumber sekaligus (gagal satu tidak menggagalkan lain).
 * Kembali ke peta harga gabungan + label sumber; bila semua gagal memakai snapshot.
 */
export async function fetchLivePrices(
  snapshot: Record<string, PriceQuote>,
  now: number = Date.now()
): Promise<{ prices: Record<string, PriceQuote>; source: string; live: boolean }> {
  if (now < liveRetryAt) {
    return { prices: snapshot, source: describeSource(snapshot), live: false };
  }

  const results = await Promise.allSettled([fetchScannerQuotes(), fetchGoldQuote(), fetchCryptoQuotes()]);
  const merged: Record<string, PriceQuote> = { ...snapshot };
  const sources: string[] = [];
  let anyLive = false;

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    anyLive = true;
    sources.push(result.value.source);
    for (const [symbol, q] of Object.entries(result.value.prices)) {
      const inst = getInstrument(symbol);
      if (!inst || !Number.isFinite(q.mid as number)) continue;
      const mid = Number((q.mid as number).toFixed(inst.digits));
      const spreadPips = inst.spreadPips;
      const bid = Number((mid - (spreadPips * inst.pipSize) / 2).toFixed(inst.digits));
      const ask = Number((mid + (spreadPips * inst.pipSize) / 2).toFixed(inst.digits));
      merged[symbol] = {
        symbol,
        bid,
        ask,
        mid,
        spreadPips,
        source: `${result.value.source}`,
        updatedAt: new Date(now).toISOString()
      };
    }
  }

  if (anyLive) {
    liveFailures = 0;
    liveRetryAt = 0;
    return { prices: merged, source: [...new Set(sources)].join(' + '), live: true };
  }

  liveFailures++;
  liveRetryAt = now + 5 * 60 * 1000 * Math.min(liveFailures, 4);
  return { prices: snapshot, source: describeSource(snapshot), live: false };
}

export function describeSource(prices: Record<string, PriceQuote>): string {
  const sources = [...new Set(Object.values(prices).map((p) => p.source))];
  if (!sources.length) return 'tanpa data harga';
  return sources.slice(0, 2).join(' + ') + (sources.length > 2 ? ` (+${sources.length - 2})` : '');
}
