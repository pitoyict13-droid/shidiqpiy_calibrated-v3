// Registry instrumen "market yang tersedia": hanya simbol yang benar-benar punya
// harga di data/ (forex.json, markets.json, indices.json, crypto.json) yang boleh
// menghasilkan Entry/SL/TP. Setiap instrumen membawa spesifikasi pip/digit/nilai pip
// agar perhitungan SL, TP dan lot size tidak lagi memakai asumsi $10/pip untuk semua pair.

export type AssetClass = 'FX' | 'METAL' | 'INDEX' | 'CRYPTO';

export interface Instrument {
  symbol: string; // kanonik tanpa slash: EURUSD, XAUUSD, NAS100
  display: string; // EUR/USD
  base: string;
  quote: string;
  klass: AssetClass;
  digits: number; // presisi harga untuk pembulatan ticket
  pipSize: number; // jarak 1 pip dalam satuan harga (0.0001 / 0.01 / 0.1 / 1)
  contractSize: number; // unit base per 1 lot (FX 100k, logam 100 oz, index/crypto 1)
  spreadPips: number; // spread tipikal dalam pip (dipakai bila broker feed tidak ada)
  minSlPips: number; // minimum SL agresif per kelas (anti SL yang terlalu sempit)
  minSlPct?: number; // minimum SL sebagai % harga (index/crypto yang pip-nya besar)
  refMinuteRangePct: number; // baseline rata-rata range 1 menit untuk kalibrasi volatilitas
}

const FX = (
  symbol: string,
  base: string,
  quote: string,
  digits: number,
  pipSize: number,
  spreadPips: number,
  minSlPips: number,
  refMinuteRangePct: number
): Instrument => ({
  symbol,
  display: symbol.slice(0, 3) + '/' + symbol.slice(3),
  base,
  quote,
  klass: 'FX',
  digits,
  pipSize,
  contractSize: 100000,
  spreadPips,
  minSlPips,
  refMinuteRangePct
});

export const INSTRUMENTS: Record<string, Instrument> = {
  EURUSD: FX('EURUSD', 'EUR', 'USD', 5, 0.0001, 1.0, 12, 0.012),
  GBPUSD: FX('GBPUSD', 'GBP', 'USD', 5, 0.0001, 1.2, 12, 0.012),
  USDJPY: FX('USDJPY', 'USD', 'JPY', 3, 0.01, 1.1, 12, 0.013),
  USDCHF: FX('USDCHF', 'USD', 'CHF', 5, 0.0001, 1.4, 12, 0.014),
  AUDUSD: FX('AUDUSD', 'AUD', 'USD', 5, 0.0001, 1.2, 12, 0.012),
  USDCAD: FX('USDCAD', 'USD', 'CAD', 5, 0.0001, 1.5, 12, 0.015),
  NZDUSD: FX('NZDUSD', 'NZD', 'USD', 5, 0.0001, 1.4, 12, 0.012),
  GBPJPY: FX('GBPJPY', 'GBP', 'JPY', 3, 0.01, 2.0, 14, 0.013),
  EURJPY: FX('EURJPY', 'EUR', 'JPY', 3, 0.01, 1.8, 14, 0.012),
  XAUUSD: {
    symbol: 'XAUUSD',
    display: 'XAU/USD',
    base: 'XAU',
    quote: 'USD',
    klass: 'METAL',
    digits: 2,
    pipSize: 0.1, // 1 pip emas = $0.10
    contractSize: 100, // 1 lot = 100 oz
    spreadPips: 3.5,
    minSlPips: 30, // $3.00 minimum, di bawah itu SL mudah tersentuh noise
    refMinuteRangePct: 0.03
  },
  NAS100: {
    symbol: 'NAS100',
    display: 'NAS100',
    base: 'NAS100',
    quote: 'USD',
    klass: 'INDEX',
    digits: 2,
    pipSize: 1, // 1 pip = 1 point indeks
    contractSize: 1,
    spreadPips: 1.5,
    minSlPips: 25,
    minSlPct: 0.0015,
    refMinuteRangePct: 0.055
  },
  US500: {
    symbol: 'US500',
    display: 'US500',
    base: 'US500',
    quote: 'USD',
    klass: 'INDEX',
    digits: 2,
    pipSize: 1,
    contractSize: 1,
    spreadPips: 0.6,
    minSlPips: 8,
    minSlPct: 0.0012,
    refMinuteRangePct: 0.045
  },
  BTCUSD: {
    symbol: 'BTCUSD',
    display: 'BTC/USD',
    base: 'BTC',
    quote: 'USD',
    klass: 'CRYPTO',
    digits: 2,
    pipSize: 1,
    contractSize: 1,
    spreadPips: 4,
    minSlPips: 100,
    minSlPct: 0.004,
    refMinuteRangePct: 0.02
  },
  ETHUSD: {
    symbol: 'ETHUSD',
    display: 'ETH/USD',
    base: 'ETH',
    quote: 'USD',
    klass: 'CRYPTO',
    digits: 2,
    pipSize: 1,
    contractSize: 1,
    spreadPips: 1.5,
    minSlPips: 10,
    minSlPct: 0.006,
    refMinuteRangePct: 0.025
  }
};

export const INSTRUMENT_LIST: Instrument[] = Object.values(INSTRUMENTS);

/** 'EUR/USD' | 'eur-usd' | 'EURUSD' -> 'EURUSD' */
export function normalizeSymbol(input: string): string {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[\s/_-]+/g, '');
}

export function getInstrument(symbol: string): Instrument | null {
  return INSTRUMENTS[normalizeSymbol(symbol)] || null;
}

export function isTradableSymbol(symbol: string): boolean {
  return !!getInstrument(symbol);
}

/** Satuan tampilan: pips untuk FX/logam, pts untuk index & crypto. */
export function pipLabel(inst: Instrument): string {
  return inst.klass === 'FX' || inst.klass === 'METAL' ? 'pips' : 'pts';
}

/**
 * Nilai 1 pip (dalam USD) per 1 lot.
 * FX: contractSize x pipSize dalam mata uang quote, lalu dikonversi ke USD.
 * Logam/index/crypto dikutip langsung dalam USD sehingga hasilnya pas.
 */
export function pipValuePerLot(
  inst: Instrument,
  mid: number,
  usdRates?: Record<string, number>
): number {
  const notional = inst.contractSize * inst.pipSize;
  if (inst.quote === 'USD') return Number(notional.toFixed(4));
  const rate = usdRates ? usdRates[inst.quote] : undefined;
  if (Number.isFinite(rate) && (rate as number) > 0) return Number((notional * (rate as number)).toFixed(4));
  // Cadangan konvensional bila pasangan konversi tidak tersedia.
  return 10;
}

/** Bangun kurs USD dari harga tengah yang tersedia (EURUSD -> 1 EUR = x USD, dst). */
export function buildUsdRates(midPrices: Record<string, number>): Record<string, number> {
  const rates: Record<string, number> = { USD: 1 };
  for (const inst of INSTRUMENT_LIST) {
    if (inst.klass !== 'FX') continue;
    const mid = midPrices[inst.symbol];
    if (!Number.isFinite(mid) || (mid as number) <= 0) continue;
    if (inst.quote === 'USD' && inst.base !== 'USD') rates[inst.base] = mid as number;
    if (inst.base === 'USD' && inst.quote !== 'USD') rates[inst.quote] = 1 / (mid as number);
  }
  return rates;
}

/** Harga entry: BUY memakai ask, SELL memakai bid. */
export function entryPriceFor(
  side: 'BUY' | 'SELL',
  quote: { bid: number; ask: number; mid: number }
): number {
  if (!quote || !Number.isFinite(quote.mid)) return NaN;
  if (side === 'BUY' && Number.isFinite(quote.ask)) return quote.ask;
  if (side === 'SELL' && Number.isFinite(quote.bid)) return quote.bid;
  return quote.mid;
}

export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

/** Jarak harga -> pip instrumen tersebut. */
export function distanceToPips(inst: Instrument, priceDistance: number): number {
  return priceDistance / inst.pipSize;
}
