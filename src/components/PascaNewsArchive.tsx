import React from 'react';
import { EconomicEvent, SignalHistoryRecord, SignalOutcome, PairWinrateStats } from '../types/trading';
import { calculateCalibration } from '../utils/calibrator';
import { summarizeWinrate, isWinOutcome, isFakeOrLossOutcome } from '../utils/winrateStats';
import {
  History,
  CheckCircle2,
  Sliders,
  Sparkles,
  ShieldCheck,
  Ban,
  BarChart3,
  AlertTriangle,
  Trophy,
  RotateCcw,
  Clock
} from 'lucide-react';

interface Props {
  events: EconomicEvent[];
  signalHistory?: SignalHistoryRecord[];
  onResetSignalHistory?: () => void;
  onSelectForCalibration: (event: EconomicEvent) => void;
  onOpenAIAnalysis: (event: EconomicEvent) => void;
}

const IMPACT_BADGE: Record<string, string> = {
  HIGH: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW: 'bg-slate-700/60 text-slate-400 border-slate-600'
};

const OUTCOME_BADGE: Record<SignalOutcome, { label: string; cls: string }> = {
  WIN_TP2: { label: 'PROFIT · TP2', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  WIN_TP1: { label: 'PROFIT · TP1', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  PROFIT_MOVE: { label: 'PROFIT · MOVE', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  FAKE_REVERSAL: { label: 'FAKE SIGNAL', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
  LOSS_SL: { label: 'LOSS · SL', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  BREAKEVEN: { label: 'BREAKEVEN', cls: 'bg-slate-700/70 text-slate-300 border-slate-600' },
  PENDING: { label: 'PENDING', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' }
};

const VERDICT_BADGE: Record<PairWinrateStats['verdict'], { label: string; cls: string }> = {
  PROFITABLE: { label: 'PROFITABLE', cls: 'bg-emerald-950 text-emerald-400 border-emerald-800' },
  MIXED: { label: 'MIXED', cls: 'bg-amber-950 text-amber-300 border-amber-800' },
  RAWAN_FAKE: { label: 'RAWAN FAKE', cls: 'bg-rose-950 text-rose-400 border-rose-800' },
  NO_DATA: { label: 'MENUNGGU DATA', cls: 'bg-slate-800 text-slate-400 border-slate-700' }
};

export const PascaNewsArchive: React.FC<Props> = ({
  events,
  signalHistory = [],
  onResetSignalHistory,
  onSelectForCalibration,
  onOpenAIAnalysis
}) => {
  const [outcomeFilter, setOutcomeFilter] = React.useState<'ALL' | 'WIN' | 'FAKE' | 'PENDING'>('ALL');
  const [pairFilter, setPairFilter] = React.useState<string>('ALL');

  const releasedEvents = events.filter((e) => e.status !== 'UPCOMING' && e.actual !== null && e.actual !== undefined);
  const summary = React.useMemo(() => summarizeWinrate(signalHistory), [signalHistory]);

  const topProfitPair = React.useMemo(() => {
    const candidates = summary.byPair.filter((p) => p.evaluated > 0 && (p.wins > 0 || p.netR > 0));
    return candidates[0] || null;
  }, [summary.byPair]);

  const topFakePair = React.useMemo(() => {
    const candidates = summary.byPair
      .filter((p) => p.evaluated > 0 && p.losses > 0)
      .sort((a, b) => (b.fakeRatePct ?? 0) - (a.fakeRatePct ?? 0) || a.netR - b.netR);
    return candidates[0] || null;
  }, [summary.byPair]);

  const filteredRecords = React.useMemo(() => {
    return signalHistory.filter((rec) => {
      if (pairFilter !== 'ALL' && rec.pair !== pairFilter) return false;
      if (outcomeFilter === 'WIN') return isWinOutcome(rec.outcome);
      if (outcomeFilter === 'FAKE') return isFakeOrLossOutcome(rec.outcome);
      if (outcomeFilter === 'PENDING') return rec.outcome === 'PENDING';
      return true;
    });
  }, [signalHistory, pairFilter, outcomeFilter]);

  const formatEventTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  return (
    <div className="space-y-6">
      {/* Statistik Winrate & Deteksi Pair Profit vs Fake */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                Statistik Winrate &amp; Deteksi Pair Profit vs Fake
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Evaluasi otomatis setiap tiket sinyal arah (1-harga) terhadap candle 1-menit, arsip reaksi pasca-rilis, dan quote pasar.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-cyan-300 bg-cyan-950/50 border border-cyan-800/80 px-2.5 py-1 rounded">
              {summary.overall.evaluated} dievaluasi · {summary.overall.pending} pending
            </span>
            {onResetSignalHistory && signalHistory.length > 0 && (
              <button
                onClick={onResetSignalHistory}
                className="text-xs font-medium px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
                title="Hapus riwayat evaluasi lokal browser"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Lokal</span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase">
              <span>Winrate Sinyal</span>
              <Trophy className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
              {summary.overall.winratePct !== null ? `${summary.overall.winratePct}%` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {summary.overall.wins} Profit dari {summary.overall.evaluated} sinyal selesai
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase">
              <span>Fake / Hit SL</span>
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-rose-400 tabular-nums">
              {summary.overall.losses}
              <span className="text-xs font-normal text-slate-400 ml-1.5">
                ({summary.overall.fakeRatePct !== null ? `${summary.overall.fakeRatePct}%` : '—'})
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {summary.overall.fakeSignals} Fake Reversal · {Math.max(0, summary.overall.losses - summary.overall.fakeSignals)} Stop Loss
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase">
              <span>Net Return</span>
              <BarChart3 className="w-4 h-4 text-cyan-400" />
            </div>
            <div className={`text-2xl font-bold font-mono tabular-nums ${
              summary.overall.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {summary.overall.netR >= 0 ? '+' : ''}{summary.overall.netR}R
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {summary.overall.netPips >= 0 ? '+' : ''}{summary.overall.netPips} pips akumulasi
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono uppercase">
              <span>Peta Pair</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xs font-mono text-slate-200 flex items-center justify-between">
              <span className="text-slate-400">Profitable:</span>
              <span className="text-emerald-400 font-bold">
                {topProfitPair ? `${topProfitPair.display} (${topProfitPair.winratePct ?? 0}%)` : 'Belum ada'}
              </span>
            </div>
            <div className="text-xs font-mono text-slate-200 flex items-center justify-between">
              <span className="text-slate-400">Rawan Fake:</span>
              <span className="text-rose-400 font-bold">
                {topFakePair ? `${topFakePair.display} (${topFakePair.fakeRatePct ?? 0}%)` : 'Tidak ada'}
              </span>
            </div>
          </div>
        </div>

        {/* Per-Pair Performance Table */}
        {summary.byPair.length === 0 ? (
          <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-6 text-center text-xs text-slate-400">
            Belum ada histori sinyal arah (BUY/SELL) yang tercatat. Sinyal yang muncul di tab Sinyal Otomatis akan otomatis direkam dan dievaluasi di sini.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <h3 className="font-semibold text-slate-200">Performa Per Pair Market (Klik pair untuk filter riwayat)</h3>
              {pairFilter !== 'ALL' && (
                <button
                  onClick={() => setPairFilter('ALL')}
                  className="text-cyan-400 hover:underline font-mono text-[11px]"
                >
                  Tampilkan Semua Pair
                </button>
              )}
            </div>
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Pair</th>
                    <th className="py-2.5 px-3 text-right">Total</th>
                    <th className="py-2.5 px-3 text-right">Profit</th>
                    <th className="py-2.5 px-3 text-right">Fake / SL</th>
                    <th className="py-2.5 px-3 text-right">Pending</th>
                    <th className="py-2.5 px-3 text-right">Winrate</th>
                    <th className="py-2.5 px-3 text-right">Fake Rate</th>
                    <th className="py-2.5 px-3 text-right">Net R</th>
                    <th className="py-2.5 px-3 text-right">Net Pips</th>
                    <th className="py-2.5 px-3 text-right">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
                  {summary.byPair.map((row) => {
                    const badge = VERDICT_BADGE[row.verdict];
                    const selected = pairFilter === row.pair;
                    return (
                      <tr
                        key={row.pair}
                        onClick={() => setPairFilter((cur) => (cur === row.pair ? 'ALL' : row.pair))}
                        className={`cursor-pointer transition-colors ${
                          selected ? 'bg-cyan-950/40' : 'hover:bg-slate-900/80'
                        }`}
                      >
                        <td className="py-2 px-3 font-bold text-white">{row.display}</td>
                        <td className="py-2 px-3 text-right text-slate-300 tabular-nums">{row.total}</td>
                        <td className="py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums">{row.wins}</td>
                        <td className="py-2 px-3 text-right text-rose-400 font-semibold tabular-nums">
                          {row.losses}
                          {row.fakeSignals > 0 && (
                            <span className="text-[10px] text-rose-300 ml-1">({row.fakeSignals}f)</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-amber-300 tabular-nums">{row.pending}</td>
                        <td className="py-2 px-3 text-right text-slate-200 font-bold tabular-nums">
                          {row.winratePct !== null ? `${row.winratePct}%` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-300 tabular-nums">
                          {row.fakeRatePct !== null ? `${row.fakeRatePct}%` : '—'}
                        </td>
                        <td className={`py-2 px-3 text-right font-bold tabular-nums ${
                          row.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {row.netR >= 0 ? '+' : ''}{row.netR}R
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums ${
                          row.netPips >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {row.netPips >= 0 ? '+' : ''}{row.netPips}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Ledger Riwayat Sinyal */}
        {signalHistory.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-200">
                Riwayat Sinyal &amp; Evaluasi Hasil ({filteredRecords.length} tiket)
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
                {(['ALL', 'WIN', 'FAKE', 'PENDING'] as const).map((key) => {
                  const labels: Record<typeof key, string> = {
                    ALL: 'Semua',
                    WIN: 'Profit',
                    FAKE: 'Fake / SL',
                    PENDING: 'Pending'
                  };
                  return (
                    <button
                      key={key}
                      onClick={() => setOutcomeFilter(key)}
                      className={`px-2.5 py-1 rounded border transition-colors ${
                        outcomeFilter === key
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {labels[key]}
                    </button>
                  );
                })}
                <select
                  value={pairFilter}
                  onChange={(e) => setPairFilter(e.target.value)}
                  className="bg-slate-950 text-slate-300 border border-slate-800 rounded px-2 py-1 text-[11px]"
                >
                  <option value="ALL">Semua Pair</option>
                  {summary.byPair.map((p) => (
                    <option key={p.pair} value={p.pair}>{p.display}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-96 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-950 text-slate-400 font-mono uppercase text-[10px] sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Waktu &amp; Event</th>
                    <th className="py-2 px-3">Pair &amp; Arah</th>
                    <th className="py-2 px-3">Level (Entry / SL / TP1)</th>
                    <th className="py-2 px-3">Hasil</th>
                    <th className="py-2 px-3 text-right">Pips / R</th>
                    <th className="py-2 px-3">Keterangan Evaluasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
                  {filteredRecords.slice(0, 50).map((rec) => {
                    const out = OUTCOME_BADGE[rec.outcome];
                    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(rec.digits) : '—');
                    return (
                      <tr key={rec.id} className="hover:bg-slate-900/70">
                        <td className="py-2 px-3 align-top">
                          <div className="font-mono text-[11px] text-slate-400">{formatEventTime(rec.createdAt)}</div>
                          <div className="text-slate-200 font-medium leading-snug max-w-xs truncate" title={rec.eventTitle}>
                            [{rec.currency}] {rec.eventTitle}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {rec.signalType} · {rec.via}
                          </div>
                        </td>
                        <td className="py-2 px-3 align-top font-mono whitespace-nowrap">
                          <span className="font-bold text-white">{rec.display}</span>
                          <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            rec.action === 'BUY'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : 'bg-rose-950 text-rose-400 border border-rose-800'
                          }`}>
                            {rec.action}
                          </span>
                        </td>
                        <td className="py-2 px-3 align-top font-mono text-[11px] text-slate-300 whitespace-nowrap tabular-nums">
                          <div>E: {fmt(rec.entryPrice)}</div>
                          <div className="text-rose-400/90">SL: {fmt(rec.slPrice)}</div>
                          <div className="text-emerald-400/90">TP1: {fmt(rec.tp1Price)}</div>
                        </td>
                        <td className="py-2 px-3 align-top whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded border font-mono text-[10px] font-bold ${out.cls}`}>
                            {out.label}
                          </span>
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">{rec.source}</div>
                        </td>
                        <td className={`py-2 px-3 align-top text-right font-mono whitespace-nowrap tabular-nums ${
                          rec.pipsResult > 0 ? 'text-emerald-400 font-bold' : rec.pipsResult < 0 ? 'text-rose-400 font-bold' : 'text-slate-400'
                        }`}>
                          <div>{rec.pipsResult > 0 ? '+' : ''}{rec.pipsResult} {rec.pipUnit}</div>
                          <div className="text-[10px]">{rec.rMultiple > 0 ? '+' : ''}{rec.rMultiple}R</div>
                        </td>
                        <td className="py-2 px-3 align-top text-[11px] text-slate-400 max-w-xs">
                          {rec.evaluationNote}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Overview Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Arsip Rilis Pasca-News & Validasi Akurasi Parameter
            </h2>
          </div>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/80 px-2.5 py-1 rounded flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Parameter Logic Validated</span>
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
          Berikut adalah hasil riil data ekonomi pasca-rilis (post-news). Anda dapat membandingkan deviasi aktual, respon pergerakan pip pasar sesungguhnya, serta mengevaluasi akurasi model kuantitatif.
        </p>
      </div>

      {/* Cards List */}
      <div className="grid grid-cols-1 gap-4">
        {releasedEvents.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-sm">
            Belum ada data rilis pasca-news. Anda dapat mensimulasikan rilis berita dari tab "Kalender & Pre-News".
          </div>
        ) : (
          releasedEvents.map((event) => {
            const post = event.postNewsAnalysis;
            // Event kalender tanpa postNewsAnalysis tetap dikalibrasi langsung oleh engine
            const cal = calculateCalibration({ event, actual: event.actual as number });
            const bias = post?.bias || cal.bias;
            const zScore = post?.normalizedZScore ?? cal.normalizedZScore;
            const isBull = bias === 'STRONG_BUY' || bias === 'BUY';
            const isBear = bias === 'STRONG_SELL' || bias === 'SELL';
            const deviation = Number.isFinite(cal.rawDeviation) ? cal.rawDeviation : 0;

            return (
              <div
                key={event.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition-all shadow-sm space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Title & Metadata */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                        {event.currency}
                      </span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${IMPACT_BADGE[event.impact]}`}>
                        {event.impact}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {formatEventTime(event.releasedAt || event.scheduledTime)} waktu lokal
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-xs text-emerald-400 font-mono font-medium">
                        STATUS: RELEASED (PASCA NEWS)
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <span>{event.title}</span>
                      <span className="text-xs text-slate-400 font-normal">({event.category})</span>
                    </h3>
                  </div>

                  {/* Numbers Trio: Actual vs Forecast vs Previous */}
                  <div className="flex items-center gap-5 sm:gap-8 font-mono text-xs">
                    <div className="space-y-0.5 text-center sm:text-right">
                      <span className="text-[10px] text-slate-400 uppercase block">Actual Rilis</span>
                      <span className={`text-base font-bold tabular-nums block ${
                        isBull ? 'text-emerald-400' : isBear ? 'text-rose-400' : 'text-slate-200'
                      }`}>
                        {event.actual !== null ? `${event.actual}${event.unit}` : '-'}
                      </span>
                    </div>

                    <div className="space-y-0.5 text-center sm:text-right">
                      <span className="text-[10px] text-slate-400 uppercase block">Forecast</span>
                      <span className="text-sm text-slate-300 tabular-nums block">
                        {event.forecast !== null ? `${event.forecast}${event.unit}` : '-'}
                      </span>
                    </div>

                    <div className="space-y-0.5 text-center sm:text-right">
                      <span className="text-[10px] text-slate-400 uppercase block">Previous</span>
                      <span className="text-sm text-slate-400 tabular-nums block">
                        {event.previous !== null ? `${event.previous}${event.unit}` : '-'}
                      </span>
                    </div>

                    <div className="space-y-0.5 text-center sm:text-right">
                      <span className="text-[10px] text-slate-400 uppercase block">Deviasi</span>
                      <span className={`text-sm font-bold tabular-nums block ${
                        deviation >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {deviation >= 0 ? '+' : ''}{deviation.toFixed(2)}{event.unit}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onOpenAIAnalysis(event)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Analisa Pasca Rilis</span>
                    </button>

                    <button
                      onClick={() => onSelectForCalibration(event)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
                    >
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Uji Kalibrasi</span>
                    </button>
                  </div>
                </div>

                {/* Post-News Breakdown Bar */}
                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-lg text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono flex-wrap">
                      <span className="text-slate-400">Algorithmic Bias:</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        isBull
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : isBear
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        {bias}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400">Z-Score:</span>
                      <span className="text-cyan-300 font-bold">
                        {Number.isFinite(zScore) ? `${zScore >= 0 ? '+' : ''}${zScore}σ` : '—'}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                        cal.tradable
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {cal.tradable ? `SIAP EKSEKUSI (${cal.phase})` : `NO TRADE (${cal.phase})`}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 font-mono text-[11px] flex-wrap">
                      <span className="text-slate-400">
                        Proyeksi Volatilitas: <strong className="text-amber-400">±{cal.expectedPips} pips</strong>
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className={cal.tradable ? 'text-emerald-400 flex items-center gap-1' : 'text-slate-400 flex items-center gap-1'}>
                        {cal.tradable ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        <span>{cal.tradable ? 'Gate lolos' : cal.gateReason}</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-slate-300 leading-relaxed text-xs">
                    {post?.summary || `Actual ${event.actual}${event.unit} vs Forecast ${event.forecast ?? '—'}${event.unit}. Deviasi: ${Number.isFinite(cal.rawDeviation) ? (cal.rawDeviation >= 0 ? '+' : '') + cal.rawDeviation : '—'} (${Number.isFinite(zScore) ? zScore : '—'}σ). Bias: ${bias}. Strategi: ${cal.strategy}.`}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
