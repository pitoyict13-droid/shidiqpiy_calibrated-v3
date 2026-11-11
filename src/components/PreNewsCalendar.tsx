import React, { useState, useEffect } from 'react';
import { EconomicEvent, CurrencyCode, ImpactLevel } from '../types/trading';
import { buildPreNewsScenarios } from '../utils/calendar';
import { preNewsEdge } from '../utils/calibrator';
import { 
  Clock, 
  Sparkles, 
  Sliders, 
  ChevronRight, 
  Zap, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown, 
  Compass,
  ArrowRight
} from 'lucide-react';

interface Props {
  events: EconomicEvent[];
  onSelectForCalibration: (event: EconomicEvent) => void;
  onOpenAIAnalysis: (event: EconomicEvent) => void;
  onUpdateActualModal: (event: EconomicEvent) => void;
}

const IMPACT_BADGE: Record<ImpactLevel, string> = {
  HIGH: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW: 'bg-slate-700/60 text-slate-400 border-slate-600'
};

// Singkatan zona waktu browser (mis. "WIB" / "GMT+7") untuk label waktu rilis.
const TZ_LABEL = (() => {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part?.value || 'lokal';
  } catch {
    return 'lokal';
  }
})();

/** Skenario pre-news selalu dihitung menggunakan logika arah & polaritas terbaru. */
const scenariosOf = (event: EconomicEvent) => buildPreNewsScenarios(event);

export const PreNewsCalendar: React.FC<Props> = ({
  events,
  onSelectForCalibration,
  onOpenAIAnalysis,
  onUpdateActualModal
}) => {
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');
  const [impactFilter, setImpactFilter] = useState<string>('ALL');
  const [now, setNow] = useState<Date>(new Date());
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Keep live second clock running
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Event yang jam rilisnya sudah lewat tetap tampil (ditandai "LEWAT"), tapi tidak
  // pernah jadi sorotan "NEXT" — supaya jadwal selaras dengan situs kalender.
  const isPast = (e: EconomicEvent) => new Date(e.scheduledTime).getTime() <= now.getTime();
  const upcomingAll = events.filter((e) => e.status === 'UPCOMING' && !isPast(e));
  const pastAll = events.filter((e) => e.status === 'UPCOMING' && isPast(e));

  const applyFilters = (list: EconomicEvent[]) =>
    list.filter((e) => {
      if (currencyFilter !== 'ALL' && e.currency !== currencyFilter) return false;
      if (impactFilter === 'HIGH' && e.impact !== 'HIGH') return false;
      if (impactFilter === 'MEDIUM_PLUS' && e.impact === 'LOW') return false;
      return true;
    });

  const filteredEvents = [...applyFilters(upcomingAll), ...applyFilters(pastAll)];

  // Nearest event (utamakan HIGH/MEDIUM untuk spotlight, impact LOW tetap tampil di tabel)
  const nextEvent = upcomingAll.find((e) => e.impact !== 'LOW') || upcomingAll[0];

  // Pre-news edge: Forecast vs Previous (polaritas sudah dikoreksi di engine)
  const edge = nextEvent ? preNewsEdge(nextEvent) : null;

  const formatCountdown = (targetTime: string) => {
    const diff = new Date(targetTime).getTime() - now.getTime();
    if (diff <= 0) return '00:00:00 (Due)';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  };

  const formatEventTime = (isoString: string) => {
    const date = new Date(isoString);
    const hari = date.toLocaleDateString([], { weekday: 'short' });
    const tanggal = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
    const jam = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${hari}, ${tanggal} · ${jam}`;
  };

  return (
    <div className="space-y-6">
      {/* Nearest High-Impact Event Spotlight Hero Banner */}
      {nextEvent && (
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-slate-800 rounded-xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-mono font-semibold border ${
                  nextEvent.impact === 'HIGH'
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full animate-ping ${nextEvent.impact === 'HIGH' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                  NEXT {nextEvent.impact} IMPACT RELEASE
                </span>
                <span className={`px-2 py-1 rounded border font-mono font-semibold text-[11px] ${IMPACT_BADGE[nextEvent.impact]}`}>
                  Impact {nextEvent.impact}
                </span>
                <span className="text-slate-400 font-mono">
                  {nextEvent.currency} · {formatEventTime(nextEvent.scheduledTime)} ({TZ_LABEL})
                </span>
                {edge !== null && Math.abs(edge) >= 0.5 && (
                  <span className={`px-2 py-1 rounded border font-mono text-[11px] font-semibold ${
                    edge > 0 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  }`}>
                    Pre-News Bias: {edge > 0 ? '+' : ''}{edge}σ ({edge > 0 ? `${nextEvent.currency} bullish` : `${nextEvent.currency} bearish`})
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                <span>{nextEvent.title}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-mono border border-slate-700">
                  {nextEvent.category}
                </span>
              </h2>

              <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                Algorithmic Pre-News Analyzer active. Volatilitas standar diperkirakan{' '}
                <span className="text-cyan-400 font-mono font-semibold">
                  {nextEvent.calibration.expectedVolatilityPips.moderate} - {nextEvent.calibration.expectedVolatilityPips.extreme} pips
                </span>
                . Pasangan utama yang terdampak:{' '}
                <span className="text-slate-200 font-mono font-medium">
                  {nextEvent.affectedPairs.join(', ')}
                </span>
                .
              </p>
            </div>

            {/* Countdown & Quick Action Block */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0 bg-slate-950/70 border border-slate-800/80 rounded-lg p-4">
              <div className="space-y-1 text-center sm:text-right pr-0 sm:pr-4 sm:border-r border-slate-800">
                <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-center sm:justify-end gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Countdown Timer</span>
                </div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-cyan-300 tabular-nums">
                  {formatCountdown(nextEvent.scheduledTime)}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => onOpenAIAnalysis(nextEvent)}
                  className="flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Pre-News Playbook</span>
                </button>

                <div className="flex gap-2">
                  <button
                    onClick={() => onSelectForCalibration(nextEvent)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    <Sliders className="w-3 h-3 text-cyan-400" />
                    <span>Calibrate</span>
                  </button>
                  <button
                    onClick={() => onUpdateActualModal(nextEvent)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/80 transition-colors"
                  >
                    <Zap className="w-3 h-3 text-emerald-400" />
                    <span>Simulate Release</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Pre-News Scenario Triggers Preview for the Next Event */}
          {(() => {
            const heroScenarios = scenariosOf(nextEvent);
            return heroScenarios.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-3">
              {heroScenarios.map((scen) => {
                const isBull = scen.scenario === 'BULLISH';
                const isBear = scen.scenario === 'BEARISH';
                return (
                  <div
                    key={scen.scenario}
                    className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                      isBull
                        ? 'bg-emerald-950/20 border-emerald-900/40 text-slate-300'
                        : isBear
                        ? 'bg-rose-950/20 border-rose-900/40 text-slate-300'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono font-semibold">
                      <span className={isBull ? 'text-emerald-400' : isBear ? 'text-rose-400' : 'text-slate-300'}>
                        {scen.scenario} TRIGGER
                      </span>
                      <span className="text-[11px] text-slate-400">{scen.condition}</span>
                    </div>
                    <div className="text-[11px] font-mono text-cyan-300">
                      Target: {scen.expectedPips}
                    </div>
                    {scen.scenario !== 'NEUTRAL' && scen.primaryPairs.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {scen.primaryPairs.slice(0, 3).map((p) => (
                          <span
                            key={p.pair}
                            className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold ${
                              p.action === 'BUY'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            }`}
                          >
                            {p.action} {p.pair}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-slate-400 line-clamp-2">
                      {scen.orderFlowPlaybook}
                    </p>
                  </div>
                );
              })}
            </div>
            );
          })()}
        </div>
      )}

      {/* Control Bar: Filters & Currency Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="text-xs text-slate-400 mr-2 shrink-0 font-medium">Currency:</span>
          {['ALL', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'].map((curr) => (
            <button
              key={curr}
              onClick={() => setCurrencyFilter(curr)}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                currencyFilter === curr
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {curr}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-400">Impact:</span>
          <div className="flex items-center p-0.5 bg-slate-800 rounded border border-slate-700 text-xs font-medium">
            <button
              onClick={() => setImpactFilter('ALL')}
              className={`px-2.5 py-0.5 rounded transition-colors ${
                impactFilter === 'ALL' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setImpactFilter('HIGH')}
              className={`px-2.5 py-0.5 rounded transition-colors ${
                impactFilter === 'HIGH' ? 'bg-rose-500/20 text-rose-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              High Only
            </button>
            <button
              onClick={() => setImpactFilter('MEDIUM_PLUS')}
              className={`px-2.5 py-0.5 rounded transition-colors ${
                impactFilter === 'MEDIUM_PLUS' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Medium+
            </button>
          </div>
        </div>
      </div>

      {/* Main Economic Calendar Table with Pre-News Automated Analysis Matrix */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-cyan-400" />
              <span>Kalender Rilis & Analisa Otomatis Pre-News</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Sistem secara otomatis menghitung matriks deviasi dan trigger order flow sebelum data dirilis.
            </p>
          </div>
          <span className="text-xs font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-800/60 px-2.5 py-1 rounded">
            {applyFilters(upcomingAll).length} Jadwal Aktif · {applyFilters(pastAll).length} Lewat
          </span>
        </div>

        <div className="divide-y divide-slate-800/80">
          {events.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm animate-pulse">
              Memuat jadwal kalender riil dari data pasar…
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              Tidak ada rilis berita ekonomi yang sesuai dengan filter yang dipilih.
            </div>
          ) : (
            filteredEvents.map((event) => {
              const isExpanded = expandedEventId === event.id;
              const isHighImpact = event.impact === 'HIGH';

              return (
                <div key={event.id} className={`transition-colors hover:bg-slate-850/50 ${isPast(event) ? 'opacity-60' : ''}`}>
                  <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Event Core Info */}
                    <div className="flex items-start sm:items-center gap-3 min-w-[280px]">
                      <span className={`w-2.5 h-2.5 rounded-full mt-1 sm:mt-0 shrink-0 ${
                        isHighImpact
                          ? 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]'
                          : event.impact === 'MEDIUM'
                          ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]'
                          : 'bg-slate-600'
                      }`} />

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs px-1.5 py-0.5 bg-slate-800 text-cyan-300 rounded border border-slate-700">
                            {event.currency}
                          </span>
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${IMPACT_BADGE[event.impact]}`}>
                            {event.impact}
                          </span>
                          {isPast(event) && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border bg-slate-800 text-slate-400 border-slate-600">
                              LEWAT
                            </span>
                          )}
                          <span className="text-sm font-semibold text-slate-100 hover:text-cyan-300 transition-colors">
                            {event.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                          <span>{event.category}</span>
                          <span>·</span>
                          <span className="text-slate-300">{formatEventTime(event.scheduledTime)} ({TZ_LABEL})</span>
                          <span>·</span>
                          {isPast(event) ? (
                            <span className="text-slate-500">sudah lewat</span>
                          ) : (
                            <span className="text-cyan-400">{formatCountdown(event.scheduledTime)}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Numeric Figures (Forecast & Previous) */}
                    <div className="flex items-center gap-6 font-mono text-xs">
                      <div className="space-y-0.5 text-right">
                        <span className="text-[10px] text-slate-400 block uppercase">Forecast</span>
                        <span className="text-cyan-300 font-semibold text-sm tabular-nums">
                          {event.forecast !== null ? `${event.forecast}${event.unit}` : '-'}
                        </span>
                      </div>

                      <div className="space-y-0.5 text-right">
                        <span className="text-[10px] text-slate-400 block uppercase">Previous</span>
                        <span className="text-slate-300 text-sm tabular-nums">
                          {event.previous !== null ? `${event.previous}${event.unit}` : '-'}
                        </span>
                      </div>

                      <div className="space-y-0.5 text-right hidden sm:block">
                        <span className="text-[10px] text-slate-400 block uppercase">Exp. Pips</span>
                        <span className="text-amber-400 font-medium text-sm tabular-nums">
                          ±{event.calibration.expectedVolatilityPips.moderate}p
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5 ${
                          isExpanded
                            ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                        }`}
                      >
                        <span>Pre-News Matrix</span>
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>

                      <button
                        onClick={() => onOpenAIAnalysis(event)}
                        title="AI Institutional Macro Deep Dive"
                        className="p-1.5 rounded-md bg-slate-800 hover:bg-cyan-950 text-cyan-400 border border-slate-700 hover:border-cyan-700 transition-colors"
                      >
                        <Sparkles className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onSelectForCalibration(event)}
                        title="Calibrate Precision Logic Parameters"
                        className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      >
                        <Sliders className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onUpdateActualModal(event)}
                        title="Simulate / Input Actual Print"
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-colors flex items-center gap-1"
                      >
                        <Zap className="w-3 h-3 text-emerald-400" />
                        <span>Test Print</span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Pre-News Scenario Matrix */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 bg-slate-950/60 border-t border-slate-800/80">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-cyan-400 uppercase tracking-wider font-mono">
                            Otomatisasi Analisa Skenario Pre-News & Rencana Eksekusi:
                          </span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            Std Dev Unit: {event.calibration.standardDeviationUnit} {event.unit} · Spread Buffer: {event.calibration.liquiditySpreadBufferPips}p
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {scenariosOf(event).map((scen) => {
                            const isBull = scen.scenario === 'BULLISH';
                            const isBear = scen.scenario === 'BEARISH';
                            return (
                              <div
                                key={scen.scenario}
                                className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                                  isBull
                                    ? 'bg-emerald-950/30 border-emerald-800/60'
                                    : isBear
                                    ? 'bg-rose-950/30 border-rose-800/60'
                                    : 'bg-slate-900 border-slate-800'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`font-mono font-bold text-xs flex items-center gap-1 ${
                                    isBull ? 'text-emerald-400' : isBear ? 'text-rose-400' : 'text-slate-300'
                                  }`}>
                                    {isBull ? <TrendingUp className="w-3.5 h-3.5" /> : isBear ? <TrendingDown className="w-3.5 h-3.5" /> : <Compass className="w-3.5 h-3.5" />}
                                    {scen.scenario} SCENARIO
                                  </span>
                                  <span className="font-mono text-[11px] text-slate-300 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                                    {scen.condition}
                                  </span>
                                </div>

                                <div className="space-y-1 font-mono text-[11px]">
                                  <div className="text-slate-200">
                                    <span className="text-slate-400">Direction:</span> {scen.expectedDirection}
                                  </div>
                                  <div className="text-cyan-300">
                                    <span className="text-slate-400">Target Volatility:</span> {scen.expectedPips}
                                  </div>
                                </div>

                                <div className="space-y-1 pt-1 border-t border-slate-800/80">
                                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                                    {scen.scenario === 'NEUTRAL' ? 'Taktik Range / Straddle:' : 'Key Setup Pairs:'}
                                  </span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {scen.scenario === 'NEUTRAL' ? (
                                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-amber-800/50 font-mono text-[10px] text-amber-300">
                                        NO BREAKOUT — Gunakan Straddle OCO atau Mean-Reversion Fade
                                      </span>
                                    ) : (
                                      scen.primaryPairs.map((p) => (
                                        <span
                                          key={p.pair}
                                          className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold ${
                                            p.action === 'BUY'
                                              ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                                              : 'bg-rose-950/60 border-rose-700/60 text-rose-300'
                                          }`}
                                          title={p.reason || ''}
                                        >
                                          {p.action} {p.pair} (TP: +{p.targetPips}p / SL: {p.stopLossPips}p)
                                        </span>
                                      ))
                                    )}
                                  </div>
                                </div>

                                <p className="text-[11px] text-slate-400 leading-relaxed italic">
                                  "{scen.orderFlowPlaybook}"
                                </p>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between text-xs pt-2 text-slate-400 flex-wrap gap-2">
                          <span>
                            Execution Window Rekomendasi:{' '}
                            <strong className="text-slate-200 font-mono">{event.calibration.optimalExecutionWindow}</strong>
                          </span>
                          {event.impact === 'LOW' && (
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono text-[11px]">
                              Impact LOW → engine menolak sinyal (NO TRADE)
                            </span>
                          )}
                          <button
                            onClick={() => onSelectForCalibration(event)}
                            className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 font-mono text-xs"
                          >
                            <span>Buka Live Calibrator dengan rilis ini</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
