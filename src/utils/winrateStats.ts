// =============================================================================
// Evaluasi hasil sinyal & statistik winrate per pair (Profit vs Fake Signal).
//
// Sumber evaluasi berjenjang:
//   1. Candle 1-menit (OHLC bars di data/markets.json) — memeriksa apakah harga
//      lebih dulu menyentuh TP2/TP1 (Profit) atau SL/pembalikan cepat (Fake/Loss).
//   2. Arsip reaksi pasca-rilis (data/reaction.json) — bila bar 1-menit sudah
//      bergeser lewat jendela 4,5 jam, cocokkan dir reaksi dengan arah sinyal.
//   3. Harga live/quote terkini — memeriksa apakah quote sudah menembus TP/SL.
// =============================================================================

import type {
  EconomicEvent,
  MinuteBar,
  PairTicket,
  PairWinrateStats,
  PriceQuote,
  SignalHistoryRecord,
  SignalOutcome,
  WinrateSummary
} from '../types/trading';
import { getInstrument } from './instruments.ts';
import { buildAutoBoard } from './autoSignal.ts';

export const SIGNAL_HISTORY_STORAGE_KEY = 'shidiqpiy_signal_history_v1';

export interface ReactionPairSnapshot {
  baseClose?: number;
  lastClose?: number;
  movePct?: number;
  dir?: 'long' | 'short' | null;
  minutes?: number;
}

export interface ReactionFeedPayload {
  generatedAt?: string | null;
  events?: Record<string, { releasedAt?: string; pairs?: Record<string, ReactionPairSnapshot> }>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isWinOutcome = (o: SignalOutcome): boolean =>
  o === 'WIN_TP2' || o === 'WIN_TP1' || o === 'PROFIT_MOVE';

export const isFakeOrLossOutcome = (o: SignalOutcome): boolean =>
  o === 'FAKE_REVERSAL' || o === 'LOSS_SL';

const isFinalOutcome = (o: SignalOutcome): boolean => o !== 'PENDING';

function toPips(pair: string, priceDelta: number): number {
  const inst = getInstrument(pair);
  const pip = inst?.pipSize || 0.0001;
  return Number((priceDelta / pip).toFixed(1));
}

function barRangeCovers(bar: MinuteBar, target: number): boolean {
  const lo = Math.min(bar.l, bar.o, bar.c);
  const hi = Math.max(bar.h, bar.o, bar.c);
  return target >= lo && target <= hi;
}

/**
 * Evaluasi kronologis 1 tiket terhadap candle 1-menit setelah `createdAt`.
 * Aturan konservatif: bila SL & TP sama-sama tersentuh dalam satu bar 1-menit, SL dianggap kena lebih dulu.
 */
export function evaluateSignalAgainstBars(
  record: SignalHistoryRecord,
  bars: MinuteBar[] | undefined,
  now: number = Date.now()
): Partial<SignalHistoryRecord> | null {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const createdMs = Date.parse(record.createdAt);
  if (!Number.isFinite(createdMs)) return null;

  const after = bars
    .filter((b) => b && isNum(b.k) && b.k * 60000 >= createdMs && isNum(b.h) && isNum(b.l) && isNum(b.c) && b.c > 0)
    .sort((a, b) => a.k - b.k);

  if (!after.length) return null;

  const isBuy = record.action === 'BUY';
  const dir = isBuy ? 1 : -1;
  const slDist = Math.abs(record.entryPrice - record.slPrice);
  const tp1Dist = Math.abs(record.tp1Price - record.entryPrice);
  const tp2Dist = Math.abs(record.tp2Price - record.entryPrice);
  if (!(slDist > 0)) return null;

  const inst = getInstrument(record.pair);
  const spreadSize = (inst?.spreadPips ?? 1.5) * (inst?.pipSize ?? 0.0001);

  let hitTp1 = false;
  for (const bar of after) {
    const barMs = bar.k * 60000;
    const hitSl = isBuy ? bar.l <= record.slPrice : bar.h >= record.slPrice;
    const reachedTp1 = isBuy ? bar.h >= record.tp1Price : bar.l <= record.tp1Price;
    const reachedTp2 = isBuy ? bar.h >= record.tp2Price : bar.l <= record.tp2Price;

    if (hitSl && !hitTp1) {
      const quickReversal = barMs - createdMs <= 15 * 60000;
      return {
        outcome: quickReversal ? 'FAKE_REVERSAL' : 'LOSS_SL',
        pipsResult: -Math.abs(toPips(record.pair, slDist)),
        rMultiple: -1.0,
        evaluatedAt: new Date(barMs).toISOString(),
        evaluationNote: quickReversal
          ? 'Fake break / reversal cepat: SL tersentuh dalam <= 15 menit (bar 1m).'
          : 'Menyentuh SL sebelum mencapai TP1 (bar 1m).',
        source: '1m-bars'
      };
    }

    if (reachedTp2 && !(hitSl && barRangeCovers(bar, record.slPrice) && !hitTp1)) {
      return {
        outcome: 'WIN_TP2',
        pipsResult: Math.abs(toPips(record.pair, tp2Dist)),
        rMultiple: 2.8,
        evaluatedAt: new Date(barMs).toISOString(),
        evaluationNote: 'Profit penuh: harga mencapai target TP2 (2.8R) via bar 1m.',
        source: '1m-bars'
      };
    }

    if (reachedTp1) {
      hitTp1 = true;
    }

    if (hitTp1 && hitSl) {
      return {
        outcome: 'WIN_TP1',
        pipsResult: Math.abs(toPips(record.pair, tp1Dist)),
        rMultiple: 1.5,
        evaluatedAt: new Date(barMs).toISOString(),
        evaluationNote: 'Profit TP1 tercapai (1.5R) sebelum harga berbalik (bar 1m).',
        source: '1m-bars'
      };
    }
  }

  if (hitTp1) {
    return {
      outcome: 'WIN_TP1',
      pipsResult: Math.abs(toPips(record.pair, tp1Dist)),
      rMultiple: 1.5,
      evaluatedAt: new Date(after[after.length - 1].k * 60000).toISOString(),
      evaluationNote: 'Target TP1 (1.5R) tercapai (bar 1m).',
      source: '1m-bars'
    };
  }

  // Belum kena TP1 maupun SL: jika sudah lewat horizon evaluasi 60 menit sejak dibuat, ukur arah bersih.
  const last = after[after.length - 1];
  const lastMs = last.k * 60000;
  if (now - createdMs >= 60 * 60000 && lastMs - createdMs >= 30 * 60000) {
    const signedMove = (last.c - record.entryPrice) * dir;
    const pipsResult = toPips(record.pair, signedMove);
    const rMultiple = Number((signedMove / slDist).toFixed(2));
    if (signedMove > spreadSize) {
      return {
        outcome: 'PROFIT_MOVE',
        pipsResult,
        rMultiple,
        evaluatedAt: new Date(lastMs).toISOString(),
        evaluationNote: `Bergerak profit searah sinyal (+${pipsResult} ${record.pipUnit}) pada penutupan jendela 1m.`,
        source: '1m-bars'
      };
    }
    if (signedMove < -spreadSize) {
      return {
        outcome: 'FAKE_REVERSAL',
        pipsResult,
        rMultiple,
        evaluatedAt: new Date(lastMs).toISOString(),
        evaluationNote: `Sinyal gagal / berbalik arah (${pipsResult} ${record.pipUnit}) pada penutupan jendela 1m.`,
        source: '1m-bars'
      };
    }
    return {
      outcome: 'BREAKEVEN',
      pipsResult: 0,
      rMultiple: 0,
      evaluatedAt: new Date(lastMs).toISOString(),
      evaluationNote: 'Datar / impas sepanjang jendela evaluasi 1m.',
      source: '1m-bars'
    };
  }

  return null;
}

/** Evaluasi memakai arsip `data/reaction.json` (saat bar 1m sudah lewat window). */
export function evaluateSignalAgainstReaction(
  record: SignalHistoryRecord,
  reactionEvents?: ReactionFeedPayload['events']
): Partial<SignalHistoryRecord> | null {
  if (!reactionEvents) return null;
  const scheduledNorm = Date.parse(record.scheduledTime);
  let matchedPairs: Record<string, ReactionPairSnapshot> | undefined;

  for (const [key, payload] of Object.entries(reactionEvents)) {
    const [rawTime, rawTitle] = key.split('|');
    const titleOk = rawTitle && rawTitle.trim().toLowerCase() === record.eventTitle.trim().toLowerCase();
    if (!titleOk) continue;
    const keyMs = Date.parse(payload?.releasedAt || rawTime || '');
    if (Number.isFinite(scheduledNorm) && Number.isFinite(keyMs) && Math.abs(keyMs - scheduledNorm) <= 2 * 3600000) {
      matchedPairs = payload?.pairs;
      break;
    }
  }

  if (!matchedPairs) return null;
  const snap = matchedPairs[record.display] || matchedPairs[record.pair];
  if (!snap || !isNum(snap.baseClose) || !isNum(snap.lastClose)) return null;

  const dir = record.action === 'BUY' ? 1 : -1;
  const slDist = Math.abs(record.entryPrice - record.slPrice);
  const priceDelta = (snap.lastClose - snap.baseClose) * dir;
  const pipsResult = toPips(record.pair, priceDelta);
  const rMultiple = slDist > 0 ? Number((priceDelta / slDist).toFixed(2)) : 0;

  if ((snap.dir === 'long' && record.action === 'BUY') || (snap.dir === 'short' && record.action === 'SELL')) {
    return {
      outcome: 'PROFIT_MOVE',
      pipsResult,
      rMultiple,
      evaluatedAt: record.scheduledTime,
      evaluationNote: `Reaksi riil searah (${snap.movePct! >= 0 ? '+' : ''}${snap.movePct}% / ${snap.minutes ?? 45}m).`,
      source: 'reaction-feed'
    };
  }
  if ((snap.dir === 'long' && record.action === 'SELL') || (snap.dir === 'short' && record.action === 'BUY')) {
    return {
      outcome: 'FAKE_REVERSAL',
      pipsResult,
      rMultiple: Math.min(-0.1, rMultiple),
      evaluatedAt: record.scheduledTime,
      evaluationNote: `Fake signal: reaksi riil berlawanan (${snap.movePct! >= 0 ? '+' : ''}${snap.movePct}% / ${snap.minutes ?? 45}m).`,
      source: 'reaction-feed'
    };
  }

  return null;
}

/** Fallback evaluasi memakai quote live terhadap Entry/SL/TP1/TP2. */
export function evaluateSignalAgainstQuote(
  record: SignalHistoryRecord,
  quote: PriceQuote | undefined,
  now: number = Date.now()
): Partial<SignalHistoryRecord> | null {
  if (!quote || !isNum(quote.mid) || quote.mid <= 0) return null;
  const isBuy = record.action === 'BUY';
  const dir = isBuy ? 1 : -1;
  const slDist = Math.abs(record.entryPrice - record.slPrice);
  const tp1Dist = Math.abs(record.tp1Price - record.entryPrice);
  const tp2Dist = Math.abs(record.tp2Price - record.entryPrice);
  if (!(slDist > 0)) return null;

  const price = isBuy ? quote.bid : quote.ask;
  const hitTp2 = isBuy ? price >= record.tp2Price : price <= record.tp2Price;
  const hitTp1 = isBuy ? price >= record.tp1Price : price <= record.tp1Price;
  const hitSl = isBuy ? price <= record.slPrice : price >= record.slPrice;

  if (hitTp2) {
    return {
      outcome: 'WIN_TP2',
      pipsResult: Math.abs(toPips(record.pair, tp2Dist)),
      rMultiple: 2.8,
      evaluatedAt: new Date(now).toISOString(),
      evaluationNote: `Harga live (${price}) menyentuh TP2 (2.8R).`,
      source: 'live-quote'
    };
  }
  if (hitTp1) {
    return {
      outcome: 'WIN_TP1',
      pipsResult: Math.abs(toPips(record.pair, tp1Dist)),
      rMultiple: 1.5,
      evaluatedAt: new Date(now).toISOString(),
      evaluationNote: `Harga live (${price}) menyentuh TP1 (1.5R).`,
      source: 'live-quote'
    };
  }
  if (hitSl) {
    return {
      outcome: 'LOSS_SL',
      pipsResult: -Math.abs(toPips(record.pair, slDist)),
      rMultiple: -1.0,
      evaluatedAt: new Date(now).toISOString(),
      evaluationNote: `Harga live (${price}) menyentuh SL (-1.0R).`,
      source: 'live-quote'
    };
  }

  // Jika sinyal sudah berumur > 4 jam tanpa menyentuh SL/TP1, klasifikasikan pergerakan terakhirnya.
  const createdMs = Date.parse(record.createdAt);
  if (Number.isFinite(createdMs) && now - createdMs >= 4 * 3600000) {
    const signedMove = (price - record.entryPrice) * dir;
    const pipsResult = toPips(record.pair, signedMove);
    const rMultiple = Number((signedMove / slDist).toFixed(2));
    return {
      outcome: signedMove >= 0 ? 'PROFIT_MOVE' : 'FAKE_REVERSAL',
      pipsResult,
      rMultiple,
      evaluatedAt: new Date(now).toISOString(),
      evaluationNote:
        signedMove >= 0
          ? `Posisi >4 jam berakhir positif (+${pipsResult} ${record.pipUnit}).`
          : `Posisi >4 jam berbalik negatif (${pipsResult} ${record.pipUnit}).`,
      source: 'live-quote'
    };
  }

  return null;
}

function recordFromTicket(
  event: EconomicEvent,
  ticket: PairTicket,
  signalType: 'PRE_NEWS' | 'POST_NEWS',
  createdAt: string
): SignalHistoryRecord {
  return {
    id: `${event.id}:${ticket.pair}:${signalType}`,
    eventId: event.id,
    eventTitle: event.title,
    currency: event.currency,
    impact: event.impact,
    scheduledTime: event.scheduledTime,
    pair: ticket.pair,
    display: ticket.display,
    action: ticket.action as 'BUY' | 'SELL',
    signalType,
    via: ticket.via,
    entryPrice: ticket.entryPrice,
    slPrice: ticket.slPrice,
    tp1Price: ticket.tp1Price,
    tp2Price: ticket.tp2Price,
    digits: ticket.digits,
    pipUnit: ticket.pipUnit,
    createdAt,
    outcome: 'PENDING',
    pipsResult: 0,
    rMultiple: 0,
    evaluationNote: 'Menunggu pergerakan harga pasca-sinyal.',
    source: 'pending'
  };
}

/**
 * Sinkronkan catatan riwayat sinyal (existing + sinyal aktif nyata sekarang)
 * dan evaluasi seluruh catatan PENDING terhadap 1m bars, reaction.json, & quote live.
 */
export function syncAndEvaluateHistory({
  existingRecords = [],
  events = [],
  prices = {},
  bars = {},
  reactionEvents,
  now = Date.now(),
  maxRecords = 250
}: {
  existingRecords?: SignalHistoryRecord[];
  events?: EconomicEvent[];
  prices?: Record<string, PriceQuote>;
  bars?: Record<string, MinuteBar[]>;
  reactionEvents?: ReactionFeedPayload['events'];
  now?: number;
  maxRecords?: number;
}): SignalHistoryRecord[] {
  const byId = new Map<string, SignalHistoryRecord>();
  for (const r of existingRecords) {
    if (r && r.id && Number.isFinite(r.entryPrice)) {
      byId.set(r.id, { ...r });
    }
  }

  // Tangkap sinyal nyata dari papan otomatis (mode simulasi MATI agar tidak mencatat data fiktif).
  const board = buildAutoBoard({ events, prices, bars, now, simulate: false });
  for (const item of board.items) {
    if (item.simulated) continue;
    const postCreated = item.event.releasedAt || item.event.scheduledTime || new Date(now).toISOString();
    for (const t of item.tickets) {
      if (!t.tradable || t.action === 'NONE' || !Number.isFinite(t.entryPrice)) continue;
      const id = `${item.event.id}:${t.pair}:POST_NEWS`;
      if (!byId.has(id)) {
        byId.set(id, recordFromTicket(item.event, t, 'POST_NEWS', postCreated));
      }
    }
    const preCreated = new Date(now).toISOString();
    for (const t of item.preNewsTickets || []) {
      if (!t.tradable || t.action === 'NONE' || !Number.isFinite(t.entryPrice)) continue;
      const id = `${item.event.id}:${t.pair}:PRE_NEWS`;
      if (!byId.has(id)) {
        byId.set(id, recordFromTicket(item.event, t, 'PRE_NEWS', preCreated));
      }
    }
  }

  // Evaluasi semua catatan yang masih PENDING (atau perlu dicek terhadap bars/reaction/quote).
  const out: SignalHistoryRecord[] = [];
  for (const rec of byId.values()) {
    if (!isFinalOutcome(rec.outcome)) {
      const fromBars = evaluateSignalAgainstBars(rec, bars[rec.pair], now);
      if (fromBars) {
        out.push({ ...rec, ...fromBars });
        continue;
      }
      const fromReaction = evaluateSignalAgainstReaction(rec, reactionEvents);
      if (fromReaction) {
        out.push({ ...rec, ...fromReaction });
        continue;
      }
      const fromQuote = evaluateSignalAgainstQuote(rec, prices[rec.pair], now);
      if (fromQuote) {
        out.push({ ...rec, ...fromQuote });
        continue;
      }
    }
    out.push(rec);
  }

  out.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return out.slice(0, maxRecords);
}

/** Hitung ringkasan winrate global dan per pair market (Profitable vs Rawan Fake). */
export function summarizeWinrate(records: SignalHistoryRecord[]): WinrateSummary {
  const byPairMap = new Map<string, PairWinrateStats>();

  let total = 0;
  let evaluated = 0;
  let wins = 0;
  let losses = 0;
  let fakeSignals = 0;
  let pending = 0;
  let netPips = 0;
  let netR = 0;

  for (const rec of records) {
    total++;
    const win = isWinOutcome(rec.outcome);
    const fake = rec.outcome === 'FAKE_REVERSAL';
    const loss = isFakeOrLossOutcome(rec.outcome);
    const isEval = rec.outcome !== 'PENDING';

    if (isEval) evaluated++;
    else pending++;

    if (win) wins++;
    if (loss) losses++;
    if (fake) fakeSignals++;
    if (isEval) {
      netPips += rec.pipsResult || 0;
      netR += rec.rMultiple || 0;
    }

    const existing = byPairMap.get(rec.pair) || {
      pair: rec.pair,
      display: rec.display || rec.pair,
      total: 0,
      evaluated: 0,
      wins: 0,
      losses: 0,
      fakeSignals: 0,
      pending: 0,
      winratePct: null,
      fakeRatePct: null,
      netPips: 0,
      netR: 0,
      verdict: 'NO_DATA' as const
    };

    existing.total++;
    if (isEval) {
      existing.evaluated++;
      existing.netPips = Number((existing.netPips + (rec.pipsResult || 0)).toFixed(1));
      existing.netR = Number((existing.netR + (rec.rMultiple || 0)).toFixed(2));
    } else {
      existing.pending++;
    }
    if (win) existing.wins++;
    if (loss) existing.losses++;
    if (fake) existing.fakeSignals++;

    byPairMap.set(rec.pair, existing);
  }

  const byPair: PairWinrateStats[] = [];
  for (const p of byPairMap.values()) {
    const winratePct = p.evaluated > 0 ? Number(((p.wins / p.evaluated) * 100).toFixed(1)) : null;
    const fakeRatePct = p.evaluated > 0 ? Number(((p.fakeSignals / p.evaluated) * 100).toFixed(1)) : null;
    let verdict: PairWinrateStats['verdict'] = 'NO_DATA';
    if (p.evaluated > 0 && winratePct !== null) {
      if (winratePct >= 55 && p.netR > 0) verdict = 'PROFITABLE';
      else if (winratePct < 45 || p.netR < 0) verdict = 'RAWAN_FAKE';
      else verdict = 'MIXED';
    }
    byPair.push({ ...p, winratePct, fakeRatePct, verdict });
  }

  // Urutkan: pair yang sudah terevaluasi paling menguntungkan dulu, lalu total sinyal.
  byPair.sort((a, b) => {
    const aEval = a.evaluated > 0 ? 0 : 1;
    const bEval = b.evaluated > 0 ? 0 : 1;
    if (aEval !== bEval) return aEval - bEval;
    if (b.netR !== a.netR) return b.netR - a.netR;
    return b.total - a.total;
  });

  return {
    overall: {
      total,
      evaluated,
      wins,
      losses,
      fakeSignals,
      pending,
      winratePct: evaluated > 0 ? Number(((wins / evaluated) * 100).toFixed(1)) : null,
      fakeRatePct: evaluated > 0 ? Number(((fakeSignals / evaluated) * 100).toFixed(1)) : null,
      netPips: Number(netPips.toFixed(1)),
      netR: Number(netR.toFixed(2))
    },
    byPair
  };
}

export function loadLocalSignalHistory(): SignalHistoryRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(SIGNAL_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalSignalHistory(records: SignalHistoryRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SIGNAL_HISTORY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Abaikan quota error pada mode private browser.
  }
}

export function clearLocalSignalHistory(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(SIGNAL_HISTORY_STORAGE_KEY);
  } catch {
    // Abaikan error.
  }
}
