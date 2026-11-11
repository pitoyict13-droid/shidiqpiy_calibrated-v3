// =============================================================================
// Engine kalibrasi sinyal pasca-news.
//
// Prinsip:
//  1. Deviasi (Actual vs Forecast/Previous) dinormalisasi ke z-score memakai
//     parameter MILIK EVENT (standardDeviationUnit, moderateThreshold,
//     highImpactThreshold) — bukan angka hardcode.
//  2. Arah ditentukan per instrumen lewat kaki pair (base/quote), bukan tebakan:
//     event EUR pada EURUSD -> BUY, event USD pada EURUSD -> SELL, dst.
//  3. Sinyal hanya "tradable" saat fase rilis ACTIVE, impact >= MEDIUM, |z| melewati
//     ambang, dan harga pasar tersedia. Selain itu NO TRADE dengan alasan jelas.
//  4. SL/TP memakai volatilitas terealisasi (bar 1 menit) + spread buffer + minimum
//     per kelas aset, dengan R:R tetap 1:1.5 / 1:2.8.
//  5. Bila reaksi harga terukur pasca-rilis berlawanan dengan fundamental, harga
//     yang menang (sinyal mengikuti harga) dan alasannya ditampilkan.
// =============================================================================

import type {
  EconomicEvent,
  CalibrationResult,
  ImpactLevel,
  MarketBias,
  ExecutionStrategy,
  SignalPhase,
  PairTicket,
  PriceQuote,
  MinuteBar,
  PriceReaction
} from '../types/trading';
import {
  getInstrument,
  normalizeSymbol,
  pipValuePerLot,
  buildUsdRates,
  entryPriceFor,
  roundTo,
  pipLabel,
  INSTRUMENT_LIST
} from './instruments.ts';

// --- Indikator dengan polaritas terbalik (angka naik = mata uang melemah) -------
export const INVERSE_INDICATORS = [
  'unemployment rate',
  'unemployment',
  'jobless claims',
  'initial claims',
  'continuing claims',
  'claimant count',
  'claims'
];

const IMPACT_COOLDOWN_MIN: Record<ImpactLevel, number> = { HIGH: 1.0, MEDIUM: 1.0, LOW: 1.0 };
const IMPACT_CONFIDENCE_BONUS: Record<ImpactLevel, number> = { HIGH: 6, MEDIUM: 3, LOW: -6 };
const IMPACT_VOL_SCALE: Record<ImpactLevel, number> = { HIGH: 1, MEDIUM: 0.8, LOW: 0.6 };

// Beta kelas aset terhadap gerakan "setara FX" yang berasal dari expectedVolatilityPips.
const CLASS_BETA: Record<string, number> = { FX: 1, METAL: 1, INDEX: 1.15, CRYPTO: 1.6 };

// Referensi harga bila peta harga tidak ikut dikirim (dipakai kalulator & test).
const REFERENCE_MIDS: Record<string, number> = {
  EURUSD: 1.11,
  GBPUSD: 1.34,
  USDJPY: 158,
  USDCHF: 0.82,
  AUDUSD: 0.69,
  USDCAD: 1.41,
  NZDUSD: 0.55,
  GBPJPY: 212,
  EURJPY: 177,
  XAUUSD: 4070,
  NAS100: 27000,
  US500: 7380,
  BTCUSD: 76000,
  ETHUSD: 2240
};

// DXY-like proxy: kekuatan USD turunan dari mata uang lain (bobot dolar indeks).
const USD_PROXY_WEIGHT: Record<string, number> = {
  EUR: -0.576,
  JPY: -0.136,
  GBP: -0.119,
  CAD: -0.091,
  CHF: -0.036,
  AUD: -0.1,
  NZD: -0.06
};

const GROWTH_CATEGORIES = ['LABOR', 'GROWTH', 'CONSUMER', 'MANUFACTURING'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// --- Polaritas & skala sigma ---------------------------------------------------

export function isInverseIndicator(event: EconomicEvent): boolean {
  const hay = `${event.title || ''} ${event.calibration?.indicatorType || ''}`.toLowerCase();
  return INVERSE_INDICATORS.some((name) => hay.includes(name));
}

/**
 * Penyamaan skala antara unit deviasi dan unit sigma.
 * Contoh bug lama: FOMC forecast/previous dalam "%", sigma = 25 (bps) sehingga
 * z selalu ~0. Untuk unit "%" dengan sigma >= 1, sigma dinyatakan dalam bps.
 */
export function sigmaScale(event: EconomicEvent): number {
  const unit = String(event.unit || event.calibration?.unit || '').toLowerCase().trim();
  const sigma = Number(event.calibration?.standardDeviationUnit) || 1;
  return unit === '%' && sigma >= 1 ? 100 : 1;
}

export interface SurpriseResult {
  rawDeviation: number; // Actual - Base pada satuan data (untuk tampilan)
  signedDeviation: number; // sudah dikalikan polaritas (+ = mata uang event bullish)
  zScore: number;
  basis: 'actual-forecast' | 'actual-previous' | 'none';
}

export function computeSurprise(
  event: EconomicEvent,
  actual: number,
  forecast?: number | null,
  previous?: number | null
): SurpriseResult {
  const f = forecast === undefined ? event.forecast : forecast;
  const p = previous === undefined ? event.previous : previous;
  const polarity = isInverseIndicator(event) ? -1 : 1;
  const sigma = Number(event.calibration?.standardDeviationUnit) || 1;

  let base: number | null = null;
  let basis: SurpriseResult['basis'] = 'none';
  if (isNum(f)) {
    base = f;
    basis = 'actual-forecast';
  } else if (isNum(p)) {
    base = p;
    basis = 'actual-previous';
  }

  if (base === null || !isNum(actual)) {
    return { rawDeviation: NaN, signedDeviation: NaN, zScore: NaN, basis: 'none' };
  }

  const rawDeviation = actual - base;
  const signedDeviation = polarity * rawDeviation;
  const zScore = (signedDeviation * sigmaScale(event)) / sigma;
  return { rawDeviation, signedDeviation, zScore, basis };
}

/**
 * Ambang z-score dari parameter event sendiri, dengan lantai konservatif
 * (1.6 kuat / 0.5 moderat) agar event dengan threshold terlalu longgar tetap disaring.
 * Impact MEDIUM menambah +0.2σ; LOW tidak menghasilkan sinyal tradable.
 */
export function thresholdsFor(event: EconomicEvent, impact: ImpactLevel = event.impact): {
  zStrong: number;
  zModerate: number;
} {
  const cal = event.calibration;
  const sigma = Number(cal?.standardDeviationUnit) || 1;
  const rawStrong = Number(cal?.highImpactThreshold);
  const rawModerate = Number(cal?.moderateThreshold);

  let zStrong = Number.isFinite(rawStrong) && rawStrong > 0 ? Math.max(1.6, rawStrong / sigma) : 1.6;
  let zModerate = Number.isFinite(rawModerate) && rawModerate > 0 ? Math.max(0.5, rawModerate / sigma) : 0.5;

  if (impact === 'MEDIUM') {
    zStrong += 0.2;
    zModerate += 0.2;
  }
  return { zStrong: Number(zStrong.toFixed(3)), zModerate: Number(zModerate.toFixed(3)) };
}

// --- Fase rilis (cooldown / window / expired) ----------------------------------

export interface PhaseResult {
  phase: SignalPhase;
  minutesSinceRelease: number | null;
  cooldownMinutes: number;
  releaseMs: number | null;
  validUntil: string | null;
}

export function signalPhase(event: EconomicEvent, now: number = Date.now(), cooldownOverride?: number): PhaseResult {
  const cooldown = cooldownOverride ?? IMPACT_COOLDOWN_MIN[event.impact] ?? 1.0;
  const hasActual = event.status !== 'UPCOMING' && isNum(event.actual);
  const releaseMs = Date.parse(event.releasedAt || event.scheduledTime || '');

  if (!hasActual || !Number.isFinite(releaseMs)) {
    return { phase: 'PRE_RELEASE', minutesSinceRelease: null, cooldownMinutes: cooldown, releaseMs: null, validUntil: null };
  }

  const minutes = Math.max(0, (now - releaseMs) / 60000);
  const invalidation = Math.max(Number(event.calibration?.invalidationTimeMinutes) || 45, cooldown);
  const validUntil = new Date(releaseMs + invalidation * 60000).toISOString();

  let phase: SignalPhase;
  if (minutes < cooldown) phase = 'COOLDOWN';
  else if (minutes <= invalidation) phase = 'ACTIVE';
  else phase = 'EXPIRED';

  return { phase, minutesSinceRelease: Number(minutes.toFixed(1)), cooldownMinutes: cooldown, releaseMs, validUntil };
}

// --- Pemetaan arah per instrumen -----------------------------------------------

export interface DirectionResult {
  action: 'BUY' | 'SELL' | 'NONE';
  via: string;
  reason: string;
}

/** Kekuatan USD turunan dari event non-USD (bobot dolar indeks + proxy risk). */
export function usdStrengthFromEvent(event: EconomicEvent, z: number): number {
  if (event.currency === 'USD') return z;
  const weight = USD_PROXY_WEIGHT[event.currency];
  if (weight === undefined) return 0;
  return weight * z;
}

/**
 * Arah untuk SATU instrumen dari z-score kejutan.
 * - FX: kaki pair menentukan (base -> searah, quote -> berbanding terbalik).
 * - Cross tanpa USD: hanya event USD pada cross ber-JPY yang punya jalur jelas
 *   (USD kuat -> JPY lemah -> XXX/JPY naik); sisanya NONE (disiplin, tidak nebak).
 * - Logam/kripto: mengikuti kekuatan USD turunan.
 * - Index: data pertumbuhan/tenaga kerja = risk on/off langsung; inflasi/kebijakan
 *   suku bunga = tekanan rate terhadap ekuitas.
 */
export function resolvePairAction(
  event: EconomicEvent,
  pair: string,
  z: number,
  zModerate: number = 0.5
): DirectionResult {
  const inst = getInstrument(pair);
  if (!inst) {
    return { action: 'NONE', via: 'unavailable', reason: `${normalizeSymbol(pair)} tidak tersedia di data pasar.` };
  }
  if (!isNum(z)) {
    return { action: 'NONE', via: 'no-data', reason: 'Actual/Forecast belum tersedia untuk menghitung deviasi.' };
  }
  if (Math.abs(z) < zModerate) {
    return {
      action: 'NONE',
      via: 'below-threshold',
      reason: `Deviasi ${z >= 0 ? '+' : ''}${z.toFixed(2)}σ di bawah ambang ${zModerate.toFixed(2)}σ — tidak ada edge.`
    };
  }

  const bullish = z > 0; // mata uang event melemah/kuat menurut polarity yang sudah dikoreksi
  const strength = Math.abs(z).toFixed(2);
  const name = event.currency;

  if (inst.klass === 'INDEX') {
    if (event.category === 'INFLATION' || event.category === 'CENTRAL_BANK') {
      const usd = usdStrengthFromEvent(event, z);
      if (Math.abs(usd) < 0.25) {
        return { action: 'NONE', via: 'rate-proxy', reason: 'Dorongan kebijakan moneter terlalu lemah untuk menggerakkan indeks.' };
      }
      return usd > 0
        ? { action: 'SELL', via: 'rate-pressure', reason: `${strength}σ hawkish/USD kuat -> tekanan suku bunga menekan ${inst.display}.` }
        : { action: 'BUY', via: 'rate-pressure', reason: `${strength}σ dovish/USD lemah -> pelonggaran rate mendukung ${inst.display}.` };
    }
    return bullish
      ? { action: 'BUY', via: 'growth-risk', reason: `${name} beat ${strength}σ -> risk-on, ${inst.display} menguat.` }
      : { action: 'SELL', via: 'growth-risk', reason: `${name} miss ${strength}σ -> risk-off, ${inst.display} melemah.` };
  }

  if (inst.klass === 'CRYPTO' || inst.symbol === 'XAUUSD') {
    const usd = usdStrengthFromEvent(event, z);
    if (Math.abs(usd) < 0.25) {
      return {
        action: 'NONE',
        via: 'usd-proxy',
        reason: `Katalis ${name} tidak cukup kuat untuk menggerakkan ${inst.display} lewat jalur USD.`
      };
    }
    const what = inst.symbol === 'XAUUSD' ? 'Emas' : 'Aset kripto';
    return usd > 0
      ? { action: 'SELL', via: 'usd-proxy', reason: `USD kuat ${strength}σ -> ${what} tertekan.` }
      : { action: 'BUY', via: 'usd-proxy', reason: `USD lemah ${strength}σ -> ${what} menjadi pelarian.` };
  }

  // FX: kaki pair menentukan arah.
  if (event.currency === inst.base) {
    return bullish
      ? { action: 'BUY', via: 'direct-leg', reason: `${name} bullish ${strength}σ -> beli ${inst.display} (kaki base).` }
      : { action: 'SELL', via: 'direct-leg', reason: `${name} bearish ${strength}σ -> jual ${inst.display} (kaki base).` };
  }
  if (event.currency === inst.quote) {
    return bullish
      ? { action: 'SELL', via: 'direct-leg', reason: `${name} bullish ${strength}σ -> jual ${inst.display} (kaki quote menguat).` }
      : { action: 'BUY', via: 'direct-leg', reason: `${name} bearish ${strength}σ -> beli ${inst.display} (kaki quote melemah).` };
  }
  if (event.currency === 'USD' && (inst.base === 'JPY' || inst.quote === 'JPY')) {
    return bullish
      ? { action: 'BUY', via: 'usd-risk-jpy', reason: `USD kuat ${strength}σ -> JPY melemah, ${inst.display} naik.` }
      : { action: 'SELL', via: 'usd-risk-jpy', reason: `USD lemah ${strength}σ -> JPY menguat, ${inst.display} turun.` };
  }

  return {
    action: 'NONE',
    via: 'no-leg',
    reason: `Event ${name} bukan kaki ${inst.display} — tidak ada jalur harga yang jelas, sinyal tidak ditebak.`
  };
}

/** Edge pre-news: Forecast vs Previous dengan polaritas & skala yang sama. */
export function preNewsEdge(event: EconomicEvent): number | null {
  if (!isNum(event.forecast) || !isNum(event.previous)) return null;
  const polarity = isInverseIndicator(event) ? -1 : 1;
  const sigma = Number(event.calibration?.standardDeviationUnit) || 1;
  if (sigma <= 0) return null;
  const z = ((event.forecast - event.previous) * polarity * sigmaScale(event)) / sigma;
  return Number.isFinite(z) ? Number(z.toFixed(3)) : null;
}

// --- Reaksi harga & volatilitas terealisasi -----------------------------------

const REACTION_SETTLE_MIN = 15;
const REACTION_HORIZON_MIN = 45;
const REACTION_MIN_MOVE_PCT = 0.05;
const REACTION_MAX_BASE_AGE_MIN = 30;

/** Ukur gerakan harga dari bar 1 menit di sekitar waktu rilis (k = menit unix/60). */
export function reactionFromBars(
  bars: MinuteBar[] | undefined,
  releaseMs: number,
  opts: { settleMin?: number; horizonMin?: number; minMovePct?: number; maxBaseAgeMin?: number } = {}
): PriceReaction | null {
  const settleMin = opts.settleMin ?? REACTION_SETTLE_MIN;
  const horizonMin = opts.horizonMin ?? REACTION_HORIZON_MIN;
  const minMovePct = opts.minMovePct ?? REACTION_MIN_MOVE_PCT;
  const maxBaseAgeMin = opts.maxBaseAgeMin ?? REACTION_MAX_BASE_AGE_MIN;

  const release = Number(releaseMs);
  if (!Number.isFinite(release) || !Array.isArray(bars)) return null;

  const rows = bars
    .map((bar) => ({ t: Number(bar && bar.k) * 60000, c: Number(bar && bar.c) }))
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.c) && row.c > 0)
    .sort((a, b) => a.t - b.t);
  if (!rows.length) return null;

  let base: { t: number; c: number } | null = null;
  for (const row of rows) {
    if (row.t <= release) base = row;
    else break;
  }
  if (!base || release - base.t > maxBaseAgeMin * 60000) return null;

  let last: { t: number; c: number } | null = null;
  for (const row of rows) {
    if (row.t >= release + settleMin * 60000 && row.t <= release + horizonMin * 60000) last = row;
  }
  if (!last || last.t <= base.t) return null;

  const movePct = Number(((last.c - base.c) / base.c * 100).toFixed(3));
  return {
    baseClose: base.c,
    lastClose: last.c,
    movePct,
    dir: Math.abs(movePct) < minMovePct ? null : movePct > 0 ? 'long' : 'short',
    minutes: Math.round((last.t - release) / 60000)
  };
}

/** Rata-rata range 1 menit (dalam %) dari bar terakhir; 0 bila bar tidak berguna. */
export function realizedMinuteRangePct(bars: MinuteBar[] | undefined, lookback = 240): number {
  if (!Array.isArray(bars) || !bars.length) return 0;
  const window = bars.slice(-lookback);
  let sum = 0;
  let count = 0;
  for (const bar of window) {
    if (!bar || !isNum(bar.h) || !isNum(bar.l) || !isNum(bar.c) || bar.c <= 0) continue;
    const range = ((bar.h - bar.l) / bar.c) * 100;
    if (range <= 0) continue; // bar sintetis/datar tidak ikut dihitung
    sum += range;
    count++;
  }
  return count ? sum / count : 0;
}

/** Rasio volatilitas terealisasi vs baseline instrumen (dikunci 0.7 - 1.5). */
export function volatilityRatio(inst: { refMinuteRangePct: number }, bars: MinuteBar[] | undefined): number {
  const realized = realizedMinuteRangePct(bars);
  if (!(realized > 0) || !(inst.refMinuteRangePct > 0)) return 1;
  return clamp(realized / inst.refMinuteRangePct, 0.7, 1.5);
}

// --- Sentimen pasar objektif (change % & momentum bar intraday) ---------------

const SENTIMENT_MIN_CHANGE_PCT: Record<string, number> = {
  FX: 0.15,
  METAL: 0.25,
  INDEX: 0.2,
  CRYPTO: 0.8
};

const SENTIMENT_MIN_BAR_PCT: Record<string, number> = {
  FX: 0.06,
  METAL: 0.12,
  INDEX: 0.1,
  CRYPTO: 0.3
};

/** Hitung perubahan % jangka pendek (30-60 menit terakhir) dari bar 1-menit. */
export function recentBarMomentumPct(bars: MinuteBar[] | undefined, windowMin = 60): number | null {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const rows = bars
    .map((b) => ({ t: Number(b && b.k) * 60000, c: Number(b && b.c), h: Number(b && b.h), l: Number(b && b.l) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.c) && r.c > 0 && r.h > r.l)
    .sort((a, b) => a.t - b.t);
  if (rows.length < 2) return null;

  const last = rows[rows.length - 1];
  const cutoff = last.t - windowMin * 60000;
  let first = rows[0];
  for (const r of rows) {
    if (r.t >= cutoff) {
      first = r;
      break;
    }
  }
  if (last.t - first.t < 5 * 60000 || first.c <= 0) return null;
  return Number((((last.c - first.c) / first.c) * 100).toFixed(3));
}

/**
 * Hitung sentimen basket USD rata-rata dari pair mayor USD bila quote XAU/USD
 * sendiri belum membawa changePct (mis. snapshot/gold-api hanya mengirim harga mid).
 */
export function usdBasketChangePct(prices?: Record<string, PriceQuote>): number | null {
  if (!prices) return null;
  const legs: { sym: string; sign: 1 | -1 }[] = [
    { sym: 'EURUSD', sign: -1 },
    { sym: 'GBPUSD', sign: -1 },
    { sym: 'AUDUSD', sign: -1 },
    { sym: 'NZDUSD', sign: -1 },
    { sym: 'USDJPY', sign: 1 },
    { sym: 'USDCHF', sign: 1 },
    { sym: 'USDCAD', sign: 1 }
  ];
  let sum = 0;
  let count = 0;
  for (const { sym, sign } of legs) {
    const c = prices[sym]?.changePct;
    if (isNum(c) && c !== 0) {
      sum += sign * c;
      count++;
    }
  }
  if (count < 3) return null;
  return Number((sum / count).toFixed(3));
}

/**
 * Resolusi arah tunggal BUY/SELL dari sentimen pasar aktual:
 * - perubahan % harian (quote.changePct dari TradingView/snapshot), dan/atau
 * - momentum harga intraday dari bar 1-menit, dan/atau
 * - untuk XAU/USD bila changePct XAU kosong/0: inversi sentimen basket USD.
 * Bila harian & intraday bertentangan di atas ambang -> NONE (disiplin, tidak menebak).
 */
export function resolveMarketSentiment(
  inst: { symbol?: string; display: string; klass: string },
  quote?: PriceQuote | null,
  bars?: MinuteBar[],
  prices?: Record<string, PriceQuote>
): DirectionResult {
  const minChg = SENTIMENT_MIN_CHANGE_PCT[inst.klass] ?? 0.15;
  const minBar = SENTIMENT_MIN_BAR_PCT[inst.klass] ?? 0.06;

  const rawChg = quote && isNum(quote.changePct) ? quote.changePct : null;
  const chg = rawChg !== null && rawChg !== 0 ? rawChg : null;
  const barPct = recentBarMomentumPct(bars);

  const chgDir: 'BUY' | 'SELL' | 'NONE' =
    chg !== null && Math.abs(chg) >= minChg ? (chg > 0 ? 'BUY' : 'SELL') : 'NONE';
  const barDir: 'BUY' | 'SELL' | 'NONE' =
    barPct !== null && Math.abs(barPct) >= minBar ? (barPct > 0 ? 'BUY' : 'SELL') : 'NONE';

  if (chgDir !== 'NONE' && barDir !== 'NONE') {
    if (chgDir !== barDir) {
      return {
        action: 'NONE',
        via: 'sentiment-conflict',
        reason: `Sentimen harian (${chg! > 0 ? '+' : ''}${chg!.toFixed(2)}%) bertentangan dengan momentum intraday (${barPct! > 0 ? '+' : ''}${barPct!.toFixed(2)}%).`
      };
    }
    return {
      action: chgDir,
      via: 'market-sentiment',
      reason: `Sentimen pasar ${inst.display} ${chgDir === 'BUY' ? 'bullish' : 'bearish'} (${chg! > 0 ? '+' : ''}${chg!.toFixed(2)}% harian, ${barPct! > 0 ? '+' : ''}${barPct!.toFixed(2)}% intraday).`
    };
  }

  if (barDir !== 'NONE') {
    return {
      action: barDir,
      via: 'market-sentiment',
      reason: `Momentum intraday ${inst.display} ${barDir === 'BUY' ? 'menguat' : 'melemah'} (${barPct! > 0 ? '+' : ''}${barPct!.toFixed(2)}%).`
    };
  }

  if (chgDir !== 'NONE') {
    return {
      action: chgDir,
      via: 'market-sentiment',
      reason: `Sentimen sesi ${inst.display} ${chgDir === 'BUY' ? 'bullish' : 'bearish'} (${chg! > 0 ? '+' : ''}${chg!.toFixed(2)}%).`
    };
  }

  if (inst.symbol === 'XAUUSD' && chg === null) {
    const usdAvg = usdBasketChangePct(prices);
    if (usdAvg !== null && Math.abs(usdAvg) >= 0.08) {
      const action = usdAvg > 0 ? 'SELL' : 'BUY';
      return {
        action,
        via: 'market-sentiment',
        reason: `Sentimen basket USD ${usdAvg > 0 ? 'menguat' : 'melemah'} (${usdAvg > 0 ? '+' : ''}${usdAvg.toFixed(2)}%) -> ${action} ${inst.display}.`
      };
    }
  }

  return { action: 'NONE', via: 'market-sentiment', reason: 'Sentimen pasar netral — belum ada arah dominan.' };
}

// --- Perhitungan utama ----------------------------------------------------------

interface CalibrationInput {
  event: EconomicEvent;
  actual: number;
  forecast?: number | null;
  previous?: number | null;
  accountBalance?: number;
  riskPercent?: number;
  now?: number;
  prices?: Record<string, PriceQuote>;
}

export function calculateCalibration({
  event,
  actual,
  forecast,
  previous,
  accountBalance = 10000,
  riskPercent = 1.0,
  now = Date.now(),
  prices = {}
}: CalibrationInput): CalibrationResult {
  const cal = event.calibration;
  const sigma = Number(cal.standardDeviationUnit) || 1;
  const surprise = computeSurprise(event, actual, forecast, previous);
  const z = surprise.zScore;
  const absZ = Math.abs(z);
  const { zStrong, zModerate } = thresholdsFor(event);

  // Bias relatif terhadap mata uang event.
  let bias: MarketBias = 'NEUTRAL';
  let biasLabel: string;
  if (z >= zStrong) {
    bias = 'STRONG_BUY';
    biasLabel = `STRONG BULLISH SURPRISE (+${z.toFixed(2)}σ)`;
  } else if (z >= zModerate) {
    bias = 'BUY';
    biasLabel = `MODERATE BULLISH BIAS (+${z.toFixed(2)}σ)`;
  } else if (z <= -zStrong) {
    bias = 'STRONG_SELL';
    biasLabel = `STRONG BEARISH MISS (${z.toFixed(2)}σ)`;
  } else if (z <= -zModerate) {
    bias = 'SELL';
    biasLabel = `MODERATE BEARISH BIAS (${z.toFixed(2)}σ)`;
  } else {
    bias = 'NEUTRAL';
    biasLabel = `INLINE WITH CONSENSUS (${z >= 0 ? '+' : ''}${Number.isFinite(z) ? z.toFixed(2) : '—'}σ)`;
  }

  // Confidence: fungsi |z| terhadap ambang event, bonus impact, penalti basis.
  let confidenceScore: number;
  if (!Number.isFinite(z)) {
    confidenceScore = 30;
  } else if (absZ >= zStrong) {
    confidenceScore = 74 + Math.min(20, (absZ - zStrong) * 9);
  } else if (absZ >= zModerate) {
    const span = Math.max(0.3, zStrong - zModerate);
    confidenceScore = 56 + ((absZ - zModerate) / span) * 17;
  } else {
    confidenceScore = 40 + absZ * 6;
  }
  confidenceScore += IMPACT_CONFIDENCE_BONUS[event.impact] ?? 0;
  if (surprise.basis === 'actual-previous') confidenceScore -= 6;
  confidenceScore = Math.round(clamp(confidenceScore, 5, 98));

  // Proyeksi pergerakan (dalam pip pasangan referensi mayor).
  const vol = cal.expectedVolatilityPips || { low: 20, moderate: 45, extreme: 80 };
  let expectedPips: number;
  if (!Number.isFinite(z)) {
    expectedPips = vol.low;
  } else if (absZ >= zStrong) {
    expectedPips = vol.moderate + (vol.extreme - vol.moderate) * Math.min(1.5, absZ / (zStrong * 1.15));
  } else if (absZ >= zModerate) {
    const span = Math.max(0.3, zStrong - zModerate);
    expectedPips = vol.low + (vol.moderate - vol.low) * clamp((absZ - zModerate) / span, 0, 1);
  } else {
    expectedPips = vol.low * 0.7;
  }
  const impactScale = IMPACT_VOL_SCALE[event.impact] ?? 1;
  expectedPips = Math.round(clamp(expectedPips * impactScale, vol.low * 0.5, vol.extreme * 1.3));

  // Strategi eksekusi.
  let strategy: ExecutionStrategy;
  let strategyDescription: string;
  let optimalTiming: string;
  if (Number.isFinite(z) && absZ >= zStrong) {
    strategy = 'MOMENTUM_BREAKOUT';
    strategyDescription =
      'Deviasi ekstrem melewati ambang kuat event — momentum directional, masuk setelah spread pulih (T+15 menit) pada retest/continuation.';
    optimalTiming = `${cal.optimalExecutionWindow || 'T+60s to T+180s'} · TIDAK MASUK sebelum cooldown ${IMPACT_COOLDOWN_MIN[event.impact]} menit`;
  } else if (Number.isFinite(z) && absZ >= zModerate) {
    strategy = 'PULLBACK_RETRACEMENT';
    strategyDescription =
      'Deviasi moderat dengan bias jelas — tunggu pullback 38.2%-50% ke FVG/level pembukaan, jangan kejar candle pertama.';
    optimalTiming = `${cal.optimalExecutionWindow || 'T+60s to T+180s'} · setelah cooldown ${IMPACT_COOLDOWN_MIN[event.impact]} menit`;
  } else {
    strategy = 'NO_TRADE_INLINE';
    strategyDescription =
      'Deviasi di dalam band noise konsensus — probabilitas chop/whipsaw tinggi, modal dipertahankan.';
    optimalTiming = 'Amati range 15 menit pertama sebelum mempertahankan kontinuitas tren.';
  }

  // SL/TP referensi (dikonversi per instrumen di buildPairTicket).
  const spreadBuffer = Number(cal.liquiditySpreadBufferPips) || 2.5;
  let stopLossPips = Math.max(12, Math.round(expectedPips * 0.4 + spreadBuffer));
  stopLossPips = Math.min(stopLossPips, Math.max(12, Math.round(expectedPips * 0.85)));
  const takeProfit1Pips = Math.round(stopLossPips * 1.5);
  const takeProfit2Pips = Math.round(stopLossPips * 2.8);
  const riskRewardRatio = `1 : ${(takeProfit2Pips / stopLossPips).toFixed(1)}`;

  // Position sizing (dihitung ulang per pair di tiket, ini nilai referensi $10/pip).
  const riskAmount = (accountBalance * riskPercent) / 100;
  const recommendedPositionSizeLots = Number(
    Math.max(0.01, riskAmount / Math.max(1, stopLossPips * 10)).toFixed(2)
  );

  // Fase rilis & gate.
  const phaseResult = signalPhase(event, now);
  const gate = gateSignal({ event, z, zModerate, phase: phaseResult.phase, bias });
  const minutesSinceRelease = phaseResult.minutesSinceRelease;

  // Matriks korelasi: semua instrumen yang tersedia di data pasar.
  const correlatedAssets: CalibrationResult['correlatedAssets'] = [];
  if (Number.isFinite(z)) {
    for (const inst of INSTRUMENT_LIST) {
      if (inst.klass === 'CRYPTO' || inst.klass === 'INDEX') continue;
      const quote = prices[inst.symbol];
      const mid = quote && isNum(quote.mid) ? quote.mid : REFERENCE_MIDS[inst.symbol];
      if (!isNum(mid)) continue;
      const dir = resolvePairAction(event, inst.symbol, z, zModerate);
      if (dir.action === 'NONE') continue;
      const { pips } = expectedMoveForInstrument({
        inst,
        basePips: expectedPips,
        mid,
        impact: event.impact,
        bars: undefined
      });
      correlatedAssets.push({
        symbol: inst.display,
        direction: dir.action === 'BUY' ? 'BULLISH' : 'BEARISH',
        expectedPips: pips,
        reason: dir.reason
      });
      if (correlatedAssets.length >= 5) break;
    }
  }

  return {
    rawDeviation: Number.isFinite(surprise.rawDeviation) ? Number(surprise.rawDeviation.toFixed(3)) : NaN,
    signedDeviation: Number.isFinite(surprise.signedDeviation) ? Number(surprise.signedDeviation.toFixed(3)) : NaN,
    normalizedZScore: Number.isFinite(z) ? Number(z.toFixed(2)) : NaN,
    zStrong,
    zModerate,
    deviationBasis: surprise.basis,
    bias,
    biasLabel,
    confidenceScore,
    expectedPips,
    strategy,
    strategyDescription,
    stopLossPips,
    takeProfit1Pips,
    takeProfit2Pips,
    riskRewardRatio,
    recommendedPositionSizeLots,
    optimalTiming,
    phase: phaseResult.phase,
    tradable: gate.tradable,
    gateReason: gate.reason,
    minutesSinceRelease,
    validUntil: phaseResult.validUntil,
    correlatedAssets
  };
}

export interface GateResult {
  tradable: boolean;
  reason: string;
}

/** Gate eksekusi: setup -> impact -> fase rilis -> harga. */
export function gateSignal({
  event,
  z,
  zModerate,
  phase,
  bias
}: {
  event: EconomicEvent;
  z: number;
  zModerate: number;
  phase: SignalPhase;
  bias: MarketBias;
}): GateResult {
  if (!Number.isFinite(z)) {
    return { tradable: false, reason: 'Actual/Forecast tidak tersedia — tidak ada deviasi untuk dikalibrasi.' };
  }
  if (bias === 'NEUTRAL' || Math.abs(z) < zModerate) {
    return { tradable: false, reason: `Deviasi belum melewati ambang ${zModerate.toFixed(2)}σ — NO TRADE.` };
  }
  if (event.impact === 'LOW') {
    return { tradable: false, reason: 'Impact LOW — tidak diperdagangkan, hanya pemantauan.' };
  }
  if (phase === 'PRE_RELEASE') {
    return { tradable: false, reason: 'Data belum dirilis — hanya skenario pre-news yang berlaku.' };
  }
  if (phase === 'COOLDOWN') {
    return { tradable: false, reason: `Cooldown pasca-rilis — spread masih melebar, tunggu konfirmasi.` };
  }
  if (phase === 'EXPIRED') {
    return { tradable: false, reason: 'Momentum rilis sudah habis (melewati invalidationTimeMinutes).' };
  }
  return { tradable: true, reason: '' };
}

// --- Perkiraan pergerakan per instrumen ----------------------------------------

export function expectedMoveForInstrument({
  inst,
  basePips,
  mid,
  impact,
  bars
}: {
  inst: { symbol: string; klass: string; pipSize: number; refMinuteRangePct: number };
  basePips: number;
  mid: number;
  impact: ImpactLevel;
  bars?: MinuteBar[];
}): { pct: number; pips: number } {
  // basePips disusun pada pasangan referensi mayor (~1.10), jadi dikonversi ke % dulu
  // agar lintas pair (JPY cross, logam, index, kripto) memakai gerakan yang setara.
  const fxRefPct = (basePips * 0.0001) / 1.1 * 100;
  const beta = CLASS_BETA[inst.klass] ?? 1;
  const impactScale = IMPACT_VOL_SCALE[impact] ?? 1;
  const volRatio = volatilityRatio(inst, bars);
  const pct = fxRefPct * beta * impactScale * volRatio;
  const pips = isNum(mid) && mid > 0 ? Math.round(((pct / 100) * mid) / inst.pipSize) : 0;
  return { pct: Number(pct.toFixed(4)), pips };
}

// --- Tiket eksekusi per instrumen ----------------------------------------------

interface PairTicketInput {
  event: EconomicEvent;
  calibration: CalibrationResult;
  pair: string;
  quote?: PriceQuote | null;
  prices?: Record<string, PriceQuote>;
  bars?: MinuteBar[];
  now?: number;
  accountBalance?: number;
  riskPercent?: number;
}

export function buildPairTicket({
  event,
  calibration,
  pair,
  quote = null,
  prices = {},
  bars,
  now = Date.now(),
  accountBalance = 10000,
  riskPercent = 1.0
}: PairTicketInput): PairTicket {
  const symbol = normalizeSymbol(pair);
  const inst = getInstrument(symbol);
  const { zStrong, zModerate } = thresholdsFor(event);
  const phaseInfo = signalPhase(event, now);

  const baseTicket = (over: Partial<PairTicket>): PairTicket => ({
    pair: symbol,
    display: inst ? inst.display : symbol,
    action: 'NONE',
    phase: phaseInfo.phase,
    tradable: false,
    gateReason: 'Instrumen tidak tersedia di data pasar.',
    directionReason: '',
    via: 'unavailable',
    entryPrice: NaN,
    slPrice: NaN,
    tp1Price: NaN,
    tp2Price: NaN,
    slPips: 0,
    tp1Pips: 0,
    tp2Pips: 0,
    expectedPips: 0,
    expectedMovePct: 0,
    pipValue: 0,
    lots: 0,
    riskAmount: Number(((accountBalance * riskPercent) / 100).toFixed(2)),
    digits: 2,
    pipUnit: 'pips',
    spreadPips: 0,
    priceSource: quote?.source || 'unavailable',
    priceAvailable: false,
    reaction: null,
    validUntil: phaseInfo.validUntil,
    ...over
  });

  if (!inst) return baseTicket({ gateReason: `${symbol} tidak tersedia di data pasar.` });

  const priceAvailable = !!quote && isNum(quote.mid) && quote.mid > 0;
  const mid = priceAvailable ? (quote as PriceQuote).mid : (REFERENCE_MIDS[symbol] ?? NaN);
  const { pct, pips } = expectedMoveForInstrument({
    inst,
    basePips: calibration.expectedPips,
    mid,
    impact: event.impact,
    bars
  });

  const spreadPips = priceAvailable
    ? Number(quote!.spreadPips) || inst.spreadPips
    : inst.spreadPips;

  // SL: proporsional terhadap ekspektasi + buffer spread (minimal spread x 1.5),
  // dibatasi minimum kelas aset agar tidak terlalu sempit.
  const buffer = Math.max(Number(event.calibration?.liquiditySpreadBufferPips) || 2.5, spreadPips * 1.5);
  const minSlByPct = inst.minSlPct && isNum(mid) ? Math.ceil(((inst.minSlPct * mid) / inst.pipSize)) : 0;
  const minSl = Math.max(inst.minSlPips, minSlByPct);
  let slPips = Math.max(minSl, Math.round(pips * 0.4 + buffer));
  slPips = Math.min(slPips, Math.max(minSl, Math.round(pips * 0.9)));
  const tp1Pips = Math.round(slPips * 1.5);
  const tp2Pips = Math.round(slPips * 2.8);

  // Arah: fundamental dulu, dikonfirmasi/diubah oleh reaksi harga terukur,
  // atau sentimen pasar bila rilis inline namun impact >= MEDIUM & jendela ACTIVE.
  const direction = resolvePairAction(event, symbol, calibration.normalizedZScore, zModerate);
  let action = direction.action;
  let via = direction.via;
  let directionReason = direction.reason;

  const releaseMs = phaseInfo.releaseMs;
  const reaction = releaseMs !== null ? reactionFromBars(bars, releaseMs) : null;
  if (reaction && reaction.dir && action !== 'NONE') {
    const fundamental: 'long' | 'short' = action === 'BUY' ? 'long' : 'short';
    if (reaction.dir !== fundamental) {
      action = reaction.dir === 'long' ? 'BUY' : 'SELL';
      via = 'price-reaction';
      directionReason = `Reaksi harga ${reaction.movePct > 0 ? '+' : ''}${reaction.movePct}% pasca-rilis berlawanan dengan Actual — sinyal mengikuti harga (${reaction.minutes} menit pasca rilis).`;
    } else {
      via = `${via}+reaction`;
      directionReason += ` Reaksi harga terkonfirmasi searah (+${reaction.movePct}% / ${reaction.minutes} menit).`;
    }
  } else if (
    action === 'NONE' &&
    event.impact !== 'LOW' &&
    phaseInfo.phase === 'ACTIVE' &&
    calibration.deviationBasis !== 'none'
  ) {
    if (reaction && reaction.dir) {
      action = reaction.dir === 'long' ? 'BUY' : 'SELL';
      via = 'price-reaction';
      directionReason = `Rilis inline konsensus, namun reaksi harga pasca-rilis jelas (${reaction.movePct > 0 ? '+' : ''}${reaction.movePct}% / ${reaction.minutes} menit).`;
    } else {
      const sentiment = resolveMarketSentiment(inst, quote, bars, prices);
      if (sentiment.action !== 'NONE') {
        action = sentiment.action;
        via = sentiment.via;
        directionReason = `Deviasi news inline — ${sentiment.reason}`;
      }
    }
  }

  const viaOverride = via === 'price-reaction' || via === 'market-sentiment';

  // Gate final.
  let gateReason = '';
  let tradable = true;
  if (calibration.deviationBasis === 'none') {
    tradable = false;
    gateReason = 'Actual/Forecast tidak tersedia — tidak ada deviasi untuk dikalibrasi.';
  } else if (action === 'NONE') {
    tradable = false;
    gateReason = directionReason;
  } else if (!viaOverride && Math.abs(calibration.normalizedZScore) < zModerate) {
    tradable = false;
    gateReason = `|z| < ${zModerate.toFixed(2)}σ (butuh ${zStrong.toFixed(2)}σ untuk sinyal kuat) — NO TRADE.`;
  } else if (event.impact === 'LOW') {
    tradable = false;
    gateReason = 'Impact LOW — tidak diperdagangkan.';
  } else if (phaseInfo.phase === 'PRE_RELEASE') {
    tradable = false;
    gateReason = 'Belum rilis — Entry/SL/TP di bawah ini masih skenario simulasi.';
  } else if (phaseInfo.phase === 'COOLDOWN') {
    tradable = false;
    const leftSec = Math.ceil(((phaseInfo.cooldownMinutes ?? 1.0) - (phaseInfo.minutesSinceRelease ?? 0)) * 60);
    gateReason = leftSec > 0
      ? `Fase Spreading (T < 60s) — masuk setelah ${leftSec} detik lagi (spread belum normal).`
      : 'Cooldown pasca-rilis — spread belum normal, tunggu konfirmasi M1.';
  } else if (phaseInfo.phase === 'EXPIRED') {
    tradable = false;
    gateReason = 'Momentum pasca-rilis sudah habis — NO TRADE.';
  } else if (!priceAvailable) {
    tradable = false;
    gateReason = 'Harga pasar instrumen ini tidak tersedia — Entry/SL/TP tidak dihitung.';
  }

  // Harga ticket.
  let entryPrice = NaN;
  let pullbackEntryPrice: number | undefined = undefined;
  let slPrice = NaN;
  let tp1Price = NaN;
  let tp2Price = NaN;
  if (action !== 'NONE' && priceAvailable) {
    const q = quote as PriceQuote;
    entryPrice = roundTo(entryPriceFor(action, q), inst.digits);
    const dir = action === 'BUY' ? 1 : -1;
    const pullbackPips = Math.max(5, Math.round(pips * 0.382));
    pullbackEntryPrice = roundTo(entryPrice - dir * pullbackPips * inst.pipSize, inst.digits);
    slPrice = roundTo(entryPrice - dir * slPips * inst.pipSize, inst.digits);
    tp1Price = roundTo(entryPrice + dir * tp1Pips * inst.pipSize, inst.digits);
    tp2Price = roundTo(entryPrice + dir * tp2Pips * inst.pipSize, inst.digits);
  }

  // Straddle Pending Order OCO hanya untuk fallback bila arah BUY/SELL benar-benar tidak terbentuk.
  let straddle: PairTicket['straddle'] = null;
  if (priceAvailable && action === 'NONE' && phaseInfo.phase === 'ACTIVE' && event.impact !== 'LOW') {
    const q = quote as PriceQuote;
    const bufferPips = inst.symbol === 'XAUUSD'
      ? Math.max(35, Math.round(spreadPips * 2 + 25))
      : inst.klass === 'INDEX'
      ? Math.max(30, Math.round(spreadPips * 3 + 20))
      : Math.max(15, Math.round(spreadPips * 2.5 + 10));
    const buyStopPrice = roundTo(q.ask + bufferPips * inst.pipSize, inst.digits);
    const sellStopPrice = roundTo(q.bid - bufferPips * inst.pipSize, inst.digits);
    const stopLossPips = Math.max(inst.minSlPips, Math.round(bufferPips * 1.2));
    const takeProfitPips = Math.round(stopLossPips * 2.0);
    straddle = {
      buyStopPrice,
      sellStopPrice,
      bufferPips,
      stopLossPips,
      takeProfitPips
    };
  }

  // Sizing lot dengan nilai pip instrumen (bukan asumsi $10).
  const mids: Record<string, number> = {};
  for (const [sym, q] of Object.entries(prices || {})) {
    if (q && isNum(q.mid) && q.mid > 0) mids[sym] = q.mid;
  }
  if (priceAvailable && !mids[symbol]) mids[symbol] = mid;
  const usdRates = buildUsdRates(mids);
  const pipValue = pipValuePerLot(inst, mid, usdRates);
  const riskAmount = Number(((accountBalance * riskPercent) / 100).toFixed(2));
  const lots =
    slPips > 0 && pipValue > 0 ? Number(Math.max(0.01, riskAmount / (slPips * pipValue)).toFixed(2)) : 0.01;

  return baseTicket({
    action,
    tradable,
    gateReason,
    directionReason,
    via,
    entryPrice,
    pullbackEntryPrice,
    slPrice,
    tp1Price,
    tp2Price,
    slPips,
    tp1Pips,
    tp2Pips,
    expectedPips: pips,
    expectedMovePct: pct,
    pipValue,
    lots,
    digits: inst.digits,
    pipUnit: pipLabel(inst),
    spreadPips,
    priceSource: priceAvailable ? quote!.source : 'unavailable',
    priceAvailable,
    reaction,
    signalType: 'POST_NEWS',
    straddle
  });
}

/** Tiket eksekusi Pra-News: single BUY/SELL (bias news/impact atau sentimen pasar); Straddle OCO hanya bila keduanya netral. */
export function buildPreNewsTicket({
  event,
  pair,
  quote = null,
  prices = {},
  bars,
  accountBalance = 10000,
  riskPercent = 1.0,
  now = Date.now()
}: {
  event: EconomicEvent;
  pair: string;
  quote?: PriceQuote | null;
  prices?: Record<string, PriceQuote>;
  bars?: MinuteBar[];
  accountBalance?: number;
  riskPercent?: number;
  now?: number;
}): PairTicket {
  const symbol = normalizeSymbol(pair);
  const inst = getInstrument(symbol);
  const { zModerate } = thresholdsFor(event);
  const zPre = preNewsEdge(event);
  const priceAvailable = !!quote && isNum(quote.mid) && quote.mid > 0;
  const mid = priceAvailable ? (quote as PriceQuote).mid : (REFERENCE_MIDS[symbol] ?? NaN);

  const baseExpectedPips = event.calibration?.expectedVolatilityPips?.moderate || 45;
  const { pct, pips } = inst
    ? expectedMoveForInstrument({ inst, basePips: baseExpectedPips, mid, impact: event.impact, bars })
    : { pct: 0, pips: 0 };

  const spreadPips = inst ? (priceAvailable ? Number(quote!.spreadPips) || inst.spreadPips : inst.spreadPips) : 2;
  const buffer = inst ? Math.max(Number(event.calibration?.liquiditySpreadBufferPips) || 2.5, spreadPips * 1.5) : 3;
  const minSlByPct = inst && inst.minSlPct && isNum(mid) ? Math.ceil((inst.minSlPct * mid) / inst.pipSize) : 0;
  const minSl = inst ? Math.max(inst.minSlPips, minSlByPct) : 15;
  let slPips = Math.max(minSl, Math.round(pips * 0.4 + buffer));
  slPips = Math.min(slPips, Math.max(minSl, Math.round(pips * 0.9)));
  const tp1Pips = Math.round(slPips * 1.5);
  const tp2Pips = Math.round(slPips * 2.8);

  if (!inst) {
    return {
      pair: symbol,
      display: symbol,
      action: 'NONE',
      phase: 'PRE_RELEASE',
      tradable: false,
      gateReason: `${symbol} tidak tersedia di data pasar.`,
      directionReason: '',
      via: 'unavailable',
      entryPrice: NaN,
      slPrice: NaN,
      tp1Price: NaN,
      tp2Price: NaN,
      slPips: 0,
      tp1Pips: 0,
      tp2Pips: 0,
      expectedPips: 0,
      expectedMovePct: 0,
      pipValue: 0,
      lots: 0,
      riskAmount: (accountBalance * riskPercent) / 100,
      digits: 2,
      pipUnit: 'pips',
      spreadPips: 0,
      priceSource: 'unavailable',
      priceAvailable: false,
      reaction: null,
      validUntil: event.scheduledTime,
      signalType: 'PRE_NEWS',
      straddle: null
    };
  }

  const hasNewsEdge = event.impact !== 'LOW' && zPre !== null && Math.abs(zPre) >= zModerate;
  let direction: DirectionResult = hasNewsEdge
    ? resolvePairAction(event, symbol, zPre as number, zModerate)
    : { action: 'NONE', via: 'pre-news', reason: 'Forecast inline konsensus — cek sentimen pasar.' };

  if (event.impact !== 'LOW' && direction.action === 'NONE') {
    const sentiment = resolveMarketSentiment(inst, quote, bars, prices);
    if (sentiment.action !== 'NONE') {
      direction = sentiment;
    }
  }

  const action = event.impact === 'LOW' ? ('NONE' as const) : direction.action;
  let entryPrice = NaN;
  let pullbackEntryPrice: number | undefined = undefined;
  let slPrice = NaN;
  let tp1Price = NaN;
  let tp2Price = NaN;

  if (action !== 'NONE' && priceAvailable) {
    const q = quote as PriceQuote;
    entryPrice = roundTo(entryPriceFor(action, q), inst.digits);
    const dir = action === 'BUY' ? 1 : -1;
    const pullbackPips = Math.max(5, Math.round(pips * 0.382));
    pullbackEntryPrice = roundTo(entryPrice - dir * pullbackPips * inst.pipSize, inst.digits);
    slPrice = roundTo(entryPrice - dir * slPips * inst.pipSize, inst.digits);
    tp1Price = roundTo(entryPrice + dir * tp1Pips * inst.pipSize, inst.digits);
    tp2Price = roundTo(entryPrice + dir * tp2Pips * inst.pipSize, inst.digits);
  }

  // Straddle OCO HANYA diisi bila arah BUY/SELL tidak terpenuhi oleh data news maupun sentimen pasar.
  let straddle: PairTicket['straddle'] = null;
  if (priceAvailable && action === 'NONE' && event.impact !== 'LOW') {
    const q = quote as PriceQuote;
    const bufferPips = inst.symbol === 'XAUUSD'
      ? Math.max(35, Math.round(spreadPips * 2 + 25))
      : inst.klass === 'INDEX'
      ? Math.max(30, Math.round(spreadPips * 3 + 20))
      : Math.max(15, Math.round(spreadPips * 2.5 + 10));
    straddle = {
      buyStopPrice: roundTo(q.ask + bufferPips * inst.pipSize, inst.digits),
      sellStopPrice: roundTo(q.bid - bufferPips * inst.pipSize, inst.digits),
      bufferPips,
      stopLossPips: Math.max(inst.minSlPips, Math.round(bufferPips * 1.2)),
      takeProfitPips: Math.round(Math.max(inst.minSlPips, Math.round(bufferPips * 1.2)) * 2.0)
    };
  }

  const mids: Record<string, number> = {};
  for (const [sym, q] of Object.entries(prices || {})) {
    if (q && isNum(q.mid) && q.mid > 0) mids[sym] = q.mid;
  }
  if (priceAvailable && !mids[symbol]) mids[symbol] = mid;
  const usdRates = buildUsdRates(mids);
  const pipValue = pipValuePerLot(inst, mid, usdRates);
  const riskAmount = Number(((accountBalance * riskPercent) / 100).toFixed(2));
  const lots = slPips > 0 && pipValue > 0 ? Number(Math.max(0.01, riskAmount / (slPips * pipValue)).toFixed(2)) : 0.01;

  const tradable = action !== 'NONE' && event.impact !== 'LOW' && priceAvailable;
  let gateReason = '';
  if (event.impact === 'LOW') {
    gateReason = 'Impact LOW — tidak diperdagangkan.';
  } else if (!priceAvailable) {
    gateReason = 'Harga pasar tidak tersedia.';
  } else if (action === 'NONE') {
    gateReason = 'Bias pra-news & sentimen pasar netral — fallback Straddle OCO.';
  }

  const directionReason =
    action !== 'NONE'
      ? direction.via === 'market-sentiment'
        ? direction.reason
        : `Bias pra-news ${zPre! > 0 ? '+' : ''}${zPre!.toFixed(2)}σ (${direction.reason})`
      : 'Konsensus & sentimen netral — fallback Straddle OCO breakout.';

  return {
    pair: symbol,
    display: inst.display,
    action,
    phase: 'PRE_RELEASE',
    tradable,
    gateReason,
    directionReason,
    via: direction.via || 'pre-news',
    entryPrice,
    pullbackEntryPrice,
    slPrice,
    tp1Price,
    tp2Price,
    slPips,
    tp1Pips,
    tp2Pips,
    expectedPips: pips,
    expectedMovePct: pct,
    pipValue,
    lots,
    riskAmount,
    digits: inst.digits,
    pipUnit: pipLabel(inst),
    spreadPips,
    priceSource: priceAvailable ? quote!.source : 'unavailable',
    priceAvailable,
    reaction: null,
    validUntil: event.scheduledTime,
    signalType: 'PRE_NEWS',
    straddle
  };
}

export interface SignalEvaluation {
  calibration: CalibrationResult;
  ticket: PairTicket;
}

/** Satu panggilan: kalibrasi event + tiket eksekusi instrumen. */
export function evaluateSignal(
  params: CalibrationInput & { pair: string; quote?: PriceQuote | null; bars?: MinuteBar[] }
): SignalEvaluation {
  const { pair, quote, bars, accountBalance, riskPercent, now, prices, ...rest } = params;
  const calibration = calculateCalibration({
    ...rest,
    accountBalance,
    riskPercent,
    now,
    prices
  });
  const ticket = buildPairTicket({
    event: params.event,
    calibration,
    pair,
    quote,
    prices: params.prices,
    bars,
    now,
    accountBalance,
    riskPercent
  });
  return { calibration, ticket };
}
