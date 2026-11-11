import React from 'react';
import { EconomicEvent } from '../types/trading';
import { calculateCalibration } from '../utils/calibrator';
import { 
  History, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown, 
  Sliders, 
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  Ban
} from 'lucide-react';

interface Props {
  events: EconomicEvent[];
  onSelectForCalibration: (event: EconomicEvent) => void;
  onOpenAIAnalysis: (event: EconomicEvent) => void;
}

const IMPACT_BADGE: Record<string, string> = {
  HIGH: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW: 'bg-slate-700/60 text-slate-400 border-slate-600'
};

export const PascaNewsArchive: React.FC<Props> = ({
  events,
  onSelectForCalibration,
  onOpenAIAnalysis
}) => {
  const releasedEvents = events.filter((e) => e.status !== 'UPCOMING' && e.actual !== null && e.actual !== undefined);

  const formatEventTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  return (
    <div className="space-y-6">
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
