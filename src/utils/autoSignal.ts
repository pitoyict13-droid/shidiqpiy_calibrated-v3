// =============================================================================
// Papan Sinyal Otomatis (auto-signal board)
//
// Menjalankan engine kalibrasi ke SELURUH jadwal tanpa input manual, lalu
// menyimpulkan status AKHIR per event:
//   SIGNAL   -> rilis sudah masuk, gate lolos, tiket Entry/SL/TP siap dipakai
//   COOLDOWN -> rilis masuk tapi spread pasca-rilis belum pulih
//   NO_TRADE -> rilis masuk tapi deviasi/fase/harga tidak memenuhi gate
//   EXPIRED  -> jendela momentum habis (melewati invalidationTimeMinutes)
//   WAITING  -> belum rilis: hitung mundur + bias pra-news (Forecast vs Previous)
//   NO_DATA  -> sudah lewat tanpa angka rilis (mis. pidato pejabat bank sentral)
//
// Semua keputusan berasal dari calibrator.ts — tidak ada logika arah/SL/TP baru
// di sini, hanya penyusunan & penilaian agar UI bisa menampilkan hasil akhir.
// =============================================================================

import type {
  EconomicEvent,
  MarketBias,
  MinuteBar,
  PairTicket,
  PriceQuote,
  SignalPhase
} from '../types/trading';
import { calculateCalibration, evaluateSignal, preNewsEdge, signalPhase, buildPreNewsTicket } from './calibrator.ts';

export type AutoSignalState = 'SIGNAL' | 'COOLDOWN' | 'NO_TRADE' | 'EXPIRED' | 'WAITING' | 'NO_DATA';

export interface AutoSignalItem {
  event: EconomicEvent;
  state: AutoSignalState;
  phase: SignalPhase;
  /** true bila angka Actual berasal dari mode simulasi (bukan rilis sungguhan). */
  simulated: boolean;
  /** >= 0 ms untuk event belum rilis; null bila sudah lewat/terungkap. */
  countdownMs: number | null;
  z: number;
  bias: MarketBias;
  confidence: number;
  /** Ringkasan angka: Actual vs Forecast (+z) atau Forecast vs Previous. */
  deviationLabel: string;
  /** Alasan NO TRADE / menunggu (kosong bila sinyal lolos gate). */
  gateReason: string;
  /** Kalimat hasil akhir siap tampil, berbahasa Indonesia. */
  headline: string;
  /** Tiket per instrumen setelah rilis. */
  tickets: PairTicket[];
  /** Tiket per instrumen sebelum rilis (antisipasi pra-news & straddle). */
  preNewsTickets?: PairTicket[];
  /** Edge pra-news (Forecast vs Previous) dalam satuan sigma; null bila data kurang. */
  preNews: number | null;
  minutesSinceRelease: number | null;
}

export interface AutoBoard {
  /** Urut: sinyal aktif dulu, lalu rilis terbaru, baru yang menunggu (terdekat). */
  items: AutoSignalItem[];
  /** Fokus utama papan: sinyal aktif > rilis terbaru > event terdekat. */
  headline: AutoSignalItem | null;
  counts: Record<AutoSignalState, number>;
  /** true bila salah satu event sedang disimulasikan rilisnya. */
  simulated: boolean;
  generatedAt: number;
}

export interface AutoBoardInput {
  events: EconomicEvent[];
  prices?: Record<string, PriceQuote>;
  bars?: Record<string, MinuteBar[]>;
  now?: number;
  accountBalance?: number;
  riskPercent?: number;
  /** Mode demo: event MEDIUM+ terdekat dianggap baru saja rilis (beat +1.5σ). */
  simulate?: boolean;
}

const STATE_RANK: Record<AutoSignalState, number> = {
  SIGNAL: 0,
  COOLDOWN: 1,
  NO_TRADE: 2,
  EXPIRED: 3,
  NO_DATA: 4,
  WAITING: 5
};

const EMPTY_COUNTS: Record<AutoSignalState, number> = {
  SIGNAL: 0,
  COOLDOWN: 0,
  NO_TRADE: 0,
  EXPIRED: 0,
  WAITING: 0,
  NO_DATA: 0
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Hitung mundur manusiawi: "2 jam 15 menit", "45 menit 10 detik". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${m} menit`;
  if (m > 0) return `${m} menit ${s} detik`;
  return `${s} detik`;
}

/** Event MEDIUM+ terdekat yang masih akan rilis — kandidat simulasi. */
function pickSimulationTarget(events: EconomicEvent[], now: number): EconomicEvent | null {
  const candidates = events
    .filter(
      (e) =>
        e.status === 'UPCOMING' &&
        Number.isFinite(Date.parse(e.scheduledTime)) &&
        Date.parse(e.scheduledTime) > now &&
        e.impact !== 'LOW' &&
        (isNum(e.forecast) || isNum(e.previous))
    )
    .sort((a, b) => Date.parse(a.scheduledTime) - Date.parse(b.scheduledTime));
  return candidates[0] ?? null;
}

/**
 * Simulasi rilis: Actual = Forecast + 1.5σ (beat konsensus), rilis dianggap
 * 30 menit lalu agar jendela ACTIVE (setelah cooldown 12-15 menit) terbuka.
 * Selalu ditandai `simulated` di UI — bukan data sungguhan.
 */
function simulateRelease(event: EconomicEvent, now: number): EconomicEvent {
  const sigma = Number(event.calibration?.standardDeviationUnit) || 1;
  const base = isNum(event.forecast) ? event.forecast : isNum(event.previous) ? event.previous : 0;
  const actual = Number((base + sigma * 1.5).toFixed(3));
  return {
    ...event,
    actual,
    status: 'RELEASED',
    releasedAt: new Date(now - 30 * 60000).toISOString()
  };
}

function stateOf(params: {
  released: boolean;
  isPast: boolean;
  phase: SignalPhase;
  tradableTickets: number;
}): AutoSignalState {
  if (!params.released) return params.isPast ? 'NO_DATA' : 'WAITING';
  if (params.phase === 'COOLDOWN') return 'COOLDOWN';
  if (params.phase === 'EXPIRED') return 'EXPIRED';
  return params.tradableTickets > 0 ? 'SIGNAL' : 'NO_TRADE';
}

function headlineFor(item: AutoSignalItem): string {
  switch (item.state) {
    case 'SIGNAL': {
      const live = item.tickets.filter((t) => t.tradable);
      const labels = live.slice(0, 3).map((t) => `${t.action} ${t.display}`);
      const extra = live.length > 3 ? ` +${live.length - 3} pair` : '';
      return `SINYAL AKTIF — ${labels.join(', ')}${extra}`;
    }
    case 'COOLDOWN':
      return `Menunggu spread pulih — ${item.gateReason || 'cooldown pasca-rilis belum selesai.'}`;
    case 'NO_TRADE':
      return `NO TRADE — ${item.gateReason || 'gate eksekusi menolak.'}`;
    case 'EXPIRED':
      return 'Jendela rilis habis — momentum sudah lewat, tidak ada sinyal baru.';
    case 'WAITING': {
      const cd = formatCountdown(item.countdownMs ?? 0);
      const tradablePre = (item.preNewsTickets || []).filter((t) => t.tradable && t.action !== 'NONE');
      const preLabels = tradablePre.length > 0
        ? ` · Sinyal ${tradablePre[0].via === 'market-sentiment' ? 'Sentimen' : 'Pra-News'}: ${tradablePre.slice(0, 2).map((t) => `${t.action} ${t.display}`).join(', ')}`
        : '';
      const bias =
        item.preNews !== null && Number.isFinite(item.preNews)
          ? ` · bias pra-news ${item.preNews > 0 ? '+' : ''}${item.preNews.toFixed(2)}σ`
          : '';
      return `Menunggu rilis dalam ${cd}${preLabels || bias}`;
    }
    case 'NO_DATA':
    default:
      return 'Sudah lewat tanpa angka rilis — tidak ada sinyal.';
  }
}

function deviationLabelFor(event: EconomicEvent, z: number, released: boolean): string {
  const unit = event.unit || '';
  if (released && isNum(event.actual)) {
    const f = isNum(event.forecast) ? `${event.forecast}${unit}` : '—';
    const zText = Number.isFinite(z) ? `${z >= 0 ? '+' : ''}${z.toFixed(2)}σ` : '—';
    return `Actual ${event.actual}${unit} vs Forecast ${f} (${zText})`;
  }
  const f = isNum(event.forecast) ? `${event.forecast}${unit}` : '—';
  const p = isNum(event.previous) ? `${event.previous}${unit}` : '—';
  return `Forecast ${f} vs Previous ${p} · Actual belum dirilis`;
}

/** Bangun seluruh papan sinyal otomatis dari daftar event + harga pasar. */
export function buildAutoBoard({
  events,
  prices = {},
  bars = {},
  now = Date.now(),
  accountBalance = 10000,
  riskPercent = 1.0,
  simulate = false
}: AutoBoardInput): AutoBoard {
  const target = simulate ? pickSimulationTarget(events, now) : null;

  const items: AutoSignalItem[] = events.map((source) => {
    const simulated = !!target && source.id === target.id;
    const event = simulated ? simulateRelease(source, now) : source;

    const phaseInfo = signalPhase(event, now);
    const released = phaseInfo.phase !== 'PRE_RELEASE';
    const scheduledMs = Date.parse(event.scheduledTime);
    const isPast = !Number.isFinite(scheduledMs) || scheduledMs <= now;
    const preNews = preNewsEdge(event);

    const actual = isNum(event.actual) ? event.actual : NaN;
    const cal = calculateCalibration({
      event,
      actual,
      forecast: event.forecast,
      previous: event.previous,
      accountBalance,
      riskPercent,
      now,
      prices
    });

    // Tiket pasca-rilis dihitung setelah rilis; tiket pra-news dihitung sebelum rilis.
    const pairs = Array.from(new Set(event.affectedPairs || []));
    const tickets: PairTicket[] = released
      ? pairs.map((pair) =>
          evaluateSignal({
            event,
            actual,
            forecast: event.forecast,
            previous: event.previous,
            pair,
            quote: prices[pair] ?? null,
            prices,
            bars: bars[pair],
            accountBalance,
            riskPercent,
            now
          }).ticket
        )
      : [];

    const preNewsTickets: PairTicket[] = !released
      ? pairs.map((pair) =>
          buildPreNewsTicket({
            event,
            pair,
            quote: prices[pair] ?? null,
            prices,
            bars: bars[pair],
            accountBalance,
            riskPercent,
            now
          })
        )
      : [];

    const tradableTickets = tickets.filter((t) => t.tradable);
    const state = stateOf({ released, isPast, phase: phaseInfo.phase, tradableTickets: tradableTickets.length });

    const gateReason =
      state === 'SIGNAL'
        ? ''
        : state === 'WAITING'
        ? 'Data belum dirilis — hanya skenario pre-news yang berlaku.'
        : state === 'NO_DATA'
        ? 'Tidak ada angka rilis untuk indikator ini (pidato/rapat) — tidak ada deviasi yang bisa dikalibrasi.'
        : cal.gateReason || tickets.find((t) => !t.tradable)?.gateReason || '';

    const item: AutoSignalItem = {
      event,
      state,
      phase: phaseInfo.phase,
      simulated,
      // Hitung mundur hanya untuk yang benar-benar akan datang; yang sudah
      // lewat tanpa angka (NO_DATA) tidak punya hitung mundur.
      countdownMs: released || isPast ? null : Math.max(0, scheduledMs - now),
      z: cal.normalizedZScore,
      bias: cal.bias,
      confidence: cal.confidenceScore,
      deviationLabel: deviationLabelFor(event, cal.normalizedZScore, released),
      gateReason,
      headline: '',
      tickets,
      preNewsTickets,
      preNews,
      minutesSinceRelease: phaseInfo.minutesSinceRelease
    };
    item.headline = headlineFor(item);
    return item;
  });

  const counts: Record<AutoSignalState, number> = { ...EMPTY_COUNTS };
  for (const item of items) counts[item.state] += 1;

  const sorted = [...items].sort((a, b) => {
    const rank = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rank !== 0) return rank;
    // Dalam satu status, rilis sungguhan selalu di atas simulasi.
    const real = Number(a.simulated) - Number(b.simulated);
    if (real !== 0) return real;
    const ta = Date.parse(a.event.scheduledTime) || 0;
    const tb = Date.parse(b.event.scheduledTime) || 0;
    // Rilis/keputusan terbaru dulu; yang belum rilis diurutkan dari yang terdekat.
    return STATE_RANK[a.state] <= 3 ? tb - ta : ta - tb;
  });

  // Fokus papan: sinyal riil dulu, lalu simulasi, lalu rilis terbaru,
  // baru event MEDIUM+ terdekat yang masih menunggu (bukan pidato tanpa angka).
  const headline =
    sorted.find((i) => i.state === 'SIGNAL' && !i.simulated) ||
    sorted.find((i) => i.state === 'SIGNAL') ||
    sorted.find((i) => !i.simulated && (i.state === 'COOLDOWN' || i.state === 'NO_TRADE')) ||
    sorted.find((i) => i.state === 'COOLDOWN' || i.state === 'NO_TRADE') ||
    sorted.find((i) => i.state === 'WAITING' && i.event.impact === 'HIGH') ||
    sorted.find((i) => i.state === 'WAITING' && i.event.impact !== 'LOW') ||
    sorted[0] ||
    null;

  return {
    items: sorted,
    headline,
    counts,
    simulated: !!target,
    generatedAt: now
  };
}
