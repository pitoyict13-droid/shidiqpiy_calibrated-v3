// =============================================================================
// Pembaca data/calendar.json (Forex Factory weekly export) menjadi EconomicEvent.
//
// Yang dijembatani di sini:
//  - Importance 1/2/3  -> Impact LOW/MEDIUM/HIGH
//  - "0.6%" / "165K" / "1,234.5" -> angka + unit yang konsisten
//  - judul event       -> kategori & parameter kalibrasi (sigma, ambang, volatilitas)
//  - mata uang event   -> daftar pair yang BENAR-BENAR tersedia di data pasar
//  - skenario pre-news -> 3 kartu BULLISH/NEUTRAL/BEARISH agar UI tidak kosong
// =============================================================================

import type {
  EconomicEvent,
  ImpactLevel,
  CurrencyCode,
  ScenarioTrigger,
  CalibrationParameters,
  EventStatus
} from '../types/trading';
import { normalizeSymbol } from './instruments.ts';
import { isInverseIndicator, resolvePairAction } from './calibrator.ts';

export interface CalendarRow {
  Date?: string;
  Event?: string;
  Country?: string;
  Importance?: number | string;
  Forecast?: string;
  Previous?: string;
  Actual?: string;
}

const SUPPORTED_CURRENCY = new Set<string>(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'XAU']);

// Pasangan per mata uang event — selalu difilter terhadap instrumen yang tersedia.
const PAIRS_BY_CURRENCY: Record<string, string[]> = {
  USD: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'NAS100', 'US500'],
  EUR: ['EURUSD', 'EURJPY'],
  GBP: ['GBPUSD', 'GBPJPY'],
  JPY: ['USDJPY', 'EURJPY', 'GBPJPY'],
  AUD: ['AUDUSD'],
  CAD: ['USDCAD'],
  CHF: ['USDCHF'],
  NZD: ['NZDUSD'],
  XAU: ['XAUUSD']
};

interface PresetRule {
  test: RegExp;
  category: EconomicEvent['category'];
  unit: string;
  sigma: number;
  high: number;
  moderate: number;
  vol: { low: number; moderate: number; extreme: number };
  buffer: number;
  window: string;
  invalidation: number;
}

// Parameter indikator yang sudah terkalibrasi (dipakai untuk event baru dari kalender).
const PRESETS: PresetRule[] = [
  {
    test: /non.?farm|payroll|\bnfp\b/,
    category: 'LABOR',
    unit: 'k',
    sigma: 30,
    high: 60,
    moderate: 35,
    vol: { low: 35, moderate: 75, extreme: 140 },
    buffer: 4.5,
    window: 'T+90s to T+300s (Fair Value Gap retest)',
    invalidation: 60
  },
  {
    test: /\badp\b|private payroll/,
    category: 'LABOR',
    unit: 'k',
    sigma: 20,
    high: 40,
    moderate: 25,
    vol: { low: 20, moderate: 45, extreme: 85 },
    buffer: 3.0,
    window: 'T+60s to T+180s',
    invalidation: 45
  },
  {
    test: /jobless claims|initial claims|unemployment claims|continuing claims/,
    category: 'LABOR',
    unit: 'k',
    sigma: 10,
    high: 20,
    moderate: 12,
    vol: { low: 18, moderate: 35, extreme: 65 },
    buffer: 2.5,
    window: 'T+45s to T+180s',
    invalidation: 45
  },
  {
    test: /unemployment rate|jobless rate/,
    category: 'LABOR',
    unit: '%',
    sigma: 0.2,
    high: 0.3,
    moderate: 0.2,
    vol: { low: 22, moderate: 48, extreme: 90 },
    buffer: 2.5,
    window: 'T+45s to T+180s',
    invalidation: 45
  },
  {
    test: /average hourly earnings|hourly earnings|\bwage\b/,
    category: 'LABOR',
    unit: '%',
    sigma: 0.1,
    high: 0.2,
    moderate: 0.1,
    vol: { low: 25, moderate: 50, extreme: 95 },
    buffer: 2.8,
    window: 'T+60s to T+180s',
    invalidation: 45
  },
  {
    test: /core cpi|\bcpi\b|core pce|\bpce\b|\bppi\b|producer price|inflation rate/,
    category: 'INFLATION',
    unit: '%',
    sigma: 0.1,
    high: 0.2,
    moderate: 0.1,
    vol: { low: 25, moderate: 50, extreme: 95 },
    buffer: 2.8,
    window: 'T+60s to T+180s (After 1-min initial liquidity sweep)',
    invalidation: 45
  },
  {
    test: /interest rate|rate decision|refinancing rate|bank rate|federal funds|policy rate/,
    category: 'CENTRAL_BANK',
    unit: '%',
    sigma: 25, // bps — sigmaScale() mengubah selisih % menjadi bps
    high: 25,
    moderate: 25,
    vol: { low: 40, moderate: 90, extreme: 180 },
    buffer: 5.0,
    window: 'T+120s / press conference T+30m',
    invalidation: 120
  },
  {
    test: /gdp|gross domestic product/,
    category: 'GROWTH',
    unit: '%',
    sigma: 0.2,
    high: 0.4,
    moderate: 0.2,
    vol: { low: 25, moderate: 55, extreme: 100 },
    buffer: 3.0,
    window: 'T+60s to T+180s',
    invalidation: 60
  },
  {
    test: /retail sales|personal spending|personal income/,
    category: 'CONSUMER',
    unit: '%',
    sigma: 0.2,
    high: 0.3,
    moderate: 0.2,
    vol: { low: 20, moderate: 45, extreme: 85 },
    buffer: 2.2,
    window: 'T+30s to T+120s',
    invalidation: 40
  },
  {
    test: /ism|\bpmi\b|purchasing managers|s&p global/,
    category: 'MANUFACTURING',
    unit: 'pts',
    sigma: 1.0,
    high: 1.5,
    moderate: 0.8,
    vol: { low: 25, moderate: 50, extreme: 85 },
    buffer: 2.5,
    window: 'T+45s to T+180s',
    invalidation: 45
  },
  {
    test: /consumer confidence|consumer sentiment|michigan|conference board|business confidence|ifo|zew/,
    category: 'CONSUMER',
    unit: 'pts',
    sigma: 2.5,
    high: 5,
    moderate: 3,
    vol: { low: 20, moderate: 45, extreme: 80 },
    buffer: 2.5,
    window: 'T+45s to T+180s',
    invalidation: 45
  },
  {
    test: /durable goods/,
    category: 'MANUFACTURING',
    unit: '%',
    sigma: 0.5,
    high: 1.0,
    moderate: 0.5,
    vol: { low: 25, moderate: 50, extreme: 95 },
    buffer: 3.0,
    window: 'T+60s to T+180s',
    invalidation: 45
  },
  {
    test: /trade balance|current account/,
    category: 'GROWTH',
    unit: 'B',
    sigma: 3,
    high: 6,
    moderate: 3,
    vol: { low: 20, moderate: 45, extreme: 85 },
    buffer: 2.5,
    window: 'T+60s to T+180s',
    invalidation: 45
  },
  {
    test: /housing starts|building permits|new home sales|existing home sales|pending home sales/,
    category: 'GROWTH',
    unit: 'k',
    sigma: 50,
    high: 100,
    moderate: 60,
    vol: { low: 20, moderate: 45, extreme: 85 },
    buffer: 2.5,
    window: 'T+60s to T+180s',
    invalidation: 45
  }
];

const DEFAULT_PRESET: Omit<PresetRule, 'test'> = {
  category: 'GROWTH',
  unit: '',
  sigma: 1,
  high: 2,
  moderate: 1,
  vol: { low: 20, moderate: 45, extreme: 85 },
  buffer: 2.5,
  window: 'T+60s to T+180s',
  invalidation: 45
};

export function impactFromImportance(importance: unknown): ImpactLevel {
  const n = Number(importance);
  if (n >= 3) return 'HIGH';
  if (n === 2) return 'MEDIUM';
  return 'LOW';
}

/** "0.6%" -> 0.6, "165K" -> 165, "1,234.5" -> 1234.5, ""/"-" -> null */
export function parseCalendarNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text || text === '-' || text === '/' || /^n\/?a$/i.test(text)) return null;
  const cleaned = text.replace(/,/g, '').replace(/[\s]+/g, '');
  const match = cleaned.match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** Ambil unit dari sufiks string data ("0.6%" -> '%', "165K" -> 'k'). */
export function parseCalendarUnit(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  const match = text.match(/([%kKmMbB])\s*$/);
  if (!match) return null;
  const suffix = match[1];
  if (suffix === '%') return '%';
  return suffix.toLowerCase();
}

export function inferCategory(title: string): EconomicEvent['category'] {
  const t = title.toLowerCase();
  if (/interest rate|rate decision|refinancing|bank rate|federal funds|policy rate|fomc/.test(t)) return 'CENTRAL_BANK';
  if (/cpi|pce|ppi|inflation/.test(t)) return 'INFLATION';
  if (/payroll|nfp|employment|unemployment|claims|wage|earnings|jobless/.test(t)) return 'LABOR';
  if (/ism|\bpmi\b|manufacturing|industrial production|factory orders/.test(t)) return 'MANUFACTURING';
  if (/retail sales|consumer confidence|consumer sentiment|personal spending|personal income/.test(t)) return 'CONSUMER';
  return 'GROWTH';
}

function matchPreset(title: string): PresetRule {
  const t = title.toLowerCase();
  return PRESETS.find((rule) => rule.test.test(t)) || ({ ...DEFAULT_PRESET, test: /$^/ } as PresetRule);
}

/** Susun parameter kalibrasi event dari preset indikator (atau default berbasis forecast). */
export function buildCalibrationFor(title: string, unit: string, forecast: number | null, previous: number | null): CalibrationParameters {
  const preset = matchPreset(title);
  const finalUnit = unit || preset.unit;

  // Default berbasis skala seri: sigma = 2% dari nilai acuan (minimal langkah wajar).
  if (preset.test.source === '$^') {
    const ref = Math.max(Math.abs(forecast ?? 0), Math.abs(previous ?? 0));
    const minStep = finalUnit === '%' ? 0.1 : finalUnit === 'k' ? 10 : finalUnit === 'pts' ? 0.5 : 1;
    const sigma = ref > 0 ? Math.max(ref * 0.02, minStep) : minStep;
    return {
      indicatorType: title,
      standardDeviationUnit: Number(sigma.toFixed(2)),
      highImpactThreshold: Number((sigma * 2).toFixed(2)),
      moderateThreshold: Number(sigma.toFixed(2)),
      unit: finalUnit,
      expectedVolatilityPips: { ...DEFAULT_PRESET.vol },
      liquiditySpreadBufferPips: DEFAULT_PRESET.buffer,
      optimalExecutionWindow: DEFAULT_PRESET.window,
      invalidationTimeMinutes: DEFAULT_PRESET.invalidation
    };
  }

  return {
    indicatorType: title,
    standardDeviationUnit: preset.sigma,
    highImpactThreshold: preset.high,
    moderateThreshold: preset.moderate,
    unit: finalUnit || preset.unit,
    expectedVolatilityPips: { ...preset.vol },
    liquiditySpreadBufferPips: preset.buffer,
    optimalExecutionWindow: preset.window,
    invalidationTimeMinutes: preset.invalidation
  };
}

/** Hanya pair yang benar-benar punya harga di data pasar. */
export function affectedPairsFor(currency: string, available?: string[]): string[] {
  const wanted = PAIRS_BY_CURRENCY[currency] || [];
  if (!available || !available.length) return wanted.map(normalizeSymbol);
  const set = new Set(available.map(normalizeSymbol));
  return wanted.filter((p) => set.has(p));
}

/** 3 skenario pre-news agar kalender selalu punya kartu trigger terkalibrasi dan akurat. */
export function buildPreNewsScenarios(
  event: Pick<EconomicEvent, 'currency' | 'forecast' | 'previous' | 'calibration' | 'affectedPairs'> & Partial<EconomicEvent>
): ScenarioTrigger[] {
  const std = Number(event.calibration?.standardDeviationUnit) || 1;
  const thresh = Number(event.calibration?.moderateThreshold) || std;
  const f = event.forecast;
  const p = event.previous;
  const unit = event.calibration?.unit || '';
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));
  const isInverse = isInverseIndicator(event as EconomicEvent);

  const vol = event.calibration?.expectedVolatilityPips || { low: 20, moderate: 45, extreme: 85 };

  let bullCondition: string;
  let bearCondition: string;

  if (f !== null && f !== undefined) {
    if (!isInverse) {
      const beat = Number((f + thresh).toFixed(2));
      const miss = Number((f - thresh).toFixed(2));
      bullCondition = `Actual >= ${beat}${unit} (deviasi >= +${thresh}${unit})`;
      bearCondition = `Actual <= ${miss}${unit} (deviasi <= -${thresh}${unit})`;
    } else {
      const beat = Number((f - thresh).toFixed(2));
      const miss = Number((f + thresh).toFixed(2));
      bullCondition = `Actual <= ${beat}${unit} (deviasi membaik <= -${thresh}${unit})`;
      bearCondition = `Actual >= ${miss}${unit} (deviasi memburuk >= +${thresh}${unit})`;
    }
  } else {
    if (!isInverse) {
      bullCondition = `Actual > Previous${unit} (deviasi positif)`;
      bearCondition = `Actual < Previous${unit} (deviasi negatif)`;
    } else {
      bullCondition = `Actual < Previous${unit} (angka pengangguran/klaim menurun)`;
      bearCondition = `Actual > Previous${unit} (angka pengangguran/klaim meningkat)`;
    }
  }

  // Pilih pair utama yang terdampak
  const candidatePairs = event.affectedPairs && event.affectedPairs.length
    ? event.affectedPairs
    : affectedPairsFor(event.currency);
  const keyPairs = candidatePairs.slice(0, 4);

  // Skenario BULLISH (mata uang event menguat)
  const bullPairs = keyPairs.map((p) => {
    const res = resolvePairAction(event as EconomicEvent, p, 2.0, 0.5);
    const action: 'BUY' | 'SELL' = res.action === 'NONE' ? 'BUY' : res.action;
    return {
      pair: p,
      action,
      targetPips: vol.moderate,
      stopLossPips: Math.max(12, Math.round(vol.moderate * 0.4)),
      reason: res.reason
    };
  });

  // Skenario BEARISH (mata uang event melemah)
  const bearPairs = keyPairs.map((p) => {
    const res = resolvePairAction(event as EconomicEvent, p, -2.0, 0.5);
    const action: 'BUY' | 'SELL' = res.action === 'NONE' ? 'SELL' : res.action;
    return {
      pair: p,
      action,
      targetPips: vol.moderate,
      stopLossPips: Math.max(12, Math.round(vol.moderate * 0.4)),
      reason: res.reason
    };
  });

  // Skenario NEUTRAL (inline konsensus)
  const neutralPairs = keyPairs.slice(0, 2).map((p) => ({
    pair: p,
    action: 'BUY' as const,
    targetPips: Math.round(vol.low * 0.7),
    stopLossPips: 12,
    reason: 'Range boundary fade / Straddle pending order'
  }));

  const primaryPairDisplay = keyPairs[0] || 'EURUSD';

  return [
    {
      scenario: 'BULLISH',
      condition: bullCondition,
      minDeviation: thresh,
      expectedDirection: `${event.currency} bullish impulse (penguatan mata uang)`,
      expectedPips: `+${vol.moderate} s/d +${vol.extreme} pips pada ${primaryPairDisplay}`,
      primaryPairs: bullPairs,
      orderFlowPlaybook: 'Fase 1 (T < 60s): Biarkan spike awal likuiditas mereda. Fase 2 (T+60s s/d T+180s): Masuk pada retest FVG atau continuation M1 searah rilis.'
    },
    {
      scenario: 'NEUTRAL',
      condition: `Actual ≈ Forecast (${fmt(f)}${unit}) — inline konsensus (noise ±${(thresh * 0.4).toFixed(2)}${unit})`,
      minDeviation: 0,
      expectedDirection: 'Inline chop / mean reversion (tanpa arah dominan)',
      expectedPips: `${Math.round(vol.low * 0.7)}-${vol.low} pips noise`,
      primaryPairs: neutralPairs,
      orderFlowPlaybook: 'Tanpa edge fundamental: Dilarang memasang breakout order. Pertimbangkan pending order Straddle OCO atau fade spike ke baseline.'
    },
    {
      scenario: 'BEARISH',
      condition: bearCondition,
      minDeviation: -thresh,
      expectedDirection: `${event.currency} bearish pressure (pelemahan mata uang)`,
      expectedPips: `-${vol.moderate} s/d -${vol.extreme} pips pada ${primaryPairDisplay}`,
      primaryPairs: bearPairs,
      orderFlowPlaybook: 'Fase 1 (T < 60s): Hindari mengejar candle jarum. Fase 2 (T+60s s/d T+180s): Masuk posisi Sell pada breakdown konfirmasi M1; TP1 di 1R lalu pasang BEP.'
    }
  ];
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

/**
 * Pilih sumber jadwal: data kalender riil menang mutlak.
 *
 * Event contoh (INITIAL_ECONOMIC_EVENTS) dijadwalkan relatif terhadap jam load
 * ("42 menit lagi", "3 jam lagi"), sehingga gabungannya membuat NFP/FOMC palsu
 * selalu tampil "akan datang" walau rilisnya sudah lewat. Karena itu event contoh
 * hanya dipakai bila tidak ada satu pun event riil.
 */
export function pickEventSource<T>(real: T[], fallback: T[]): T[] {
  return real.length ? real : fallback;
}

/**
 * Konversi baris kalender mentah menjadi EconomicEvent siap pakai.
 * Event lama (lebih dari `maxAgeHours` jam sebelum `now`) dibuang kecuali punya Actual.
 */
export function parseCalendarEvents(
  raw: unknown,
  opts: { now?: number; available?: string[]; maxAgeHours?: number } = {}
): EconomicEvent[] {
  const now = opts.now ?? Date.now();
  const maxAgeMs = (opts.maxAgeHours ?? 6) * 3600 * 1000;
  if (!Array.isArray(raw)) return [];

  const events: EconomicEvent[] = [];
  for (const row of raw as CalendarRow[]) {
    const title = String(row && row.Event || '').trim();
    const country = String(row && row.Country || '').trim().toUpperCase();
    const timeMs = Date.parse(String(row && row.Date || ''));
    if (!title || !Number.isFinite(timeMs)) continue;
    if (!SUPPORTED_CURRENCY.has(country)) continue;
    if (timeMs < now - maxAgeMs) continue; // sudah terlalu lama untuk jendela pasca-news

    const forecast = parseCalendarNumber(row.Forecast);
    const previous = parseCalendarNumber(row.Previous);
    const actual = parseCalendarNumber(row.Actual);
    const unit = parseCalendarUnit(row.Forecast) || parseCalendarUnit(row.Previous) || parseCalendarUnit(row.Actual) || '';
    const impact = impactFromImportance(row.Importance);
    const category = inferCategory(title);
    const status: EventStatus = actual !== null ? 'RELEASED' : 'UPCOMING';
    const currency = country as CurrencyCode;
    const calibration = buildCalibrationFor(title, unit, forecast, previous);
    const affectedPairs = affectedPairsFor(country, opts.available);

    const event: EconomicEvent = {
      id: `cal-${new Date(timeMs).toISOString().slice(0, 16).replace(/[:T]/g, '')}-${slug(title)}`,
      title,
      currency,
      scheduledTime: new Date(timeMs).toISOString(),
      status,
      impact,
      forecast,
      previous,
      actual,
      unit: calibration.unit || unit,
      category,
      affectedPairs,
      calibration,
      preNewsScenarios: []
    };
    event.preNewsScenarios = buildPreNewsScenarios(event);
    events.push(event);
  }

  events.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
  return events;
}
