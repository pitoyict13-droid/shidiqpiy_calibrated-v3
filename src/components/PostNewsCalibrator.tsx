import React, { useState, useEffect, useMemo } from 'react';
import { EconomicEvent, PriceQuote, MinuteBar, PairTicket, SignalPhase } from '../types/trading';
import { evaluateSignal, thresholdsFor, buildPreNewsTicket } from '../utils/calibrator';
import {
  Sliders,
  Target,
  TrendingUp,
  TrendingDown,
  Gauge,
  DollarSign,
  Clock,
  Sparkles,
  Layers,
  Ban,
  Radio,
  RefreshCw
} from 'lucide-react';

interface Props {
  events: EconomicEvent[];
  selectedEvent: EconomicEvent | null;
  onSelectEvent: (event: EconomicEvent) => void;
  onOpenAIAnalysis: (event: EconomicEvent) => void;
  prices: Record<string, PriceQuote>;
  bars: Record<string, MinuteBar[]>;
  priceSource: string;
  onRefreshPrices: () => void;
}

const PHASE_META: Record<SignalPhase, { label: string; className: string; hint: string }> = {
  PRE_RELEASE: {
    label: 'PRA-RILIS',
    className: 'bg-cyan-950 text-cyan-300 border-cyan-800',
    hint: 'Menggunakan bias pra-news (Forecast vs Previous) & pending order Straddle OCO jelang rilis.'
  },
  COOLDOWN: {
    label: 'SPREADING (<60s)',
    className: 'bg-amber-950 text-amber-300 border-amber-800',
    hint: 'Fase 1 Spreading (T < 60s) — Spread melebar pasca-rilis, tunggu konfirmasi M1 pertama.'
  },
  ACTIVE: {
    label: 'JENDELA AKTIF',
    className: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    hint: 'Jendela pasca-rilis valid (T+1m s/d T+45m) — sinyal boleh dieksekusi.'
  },
  EXPIRED: {
    label: 'KADALUARSA',
    className: 'bg-rose-950 text-rose-300 border-rose-800',
    hint: 'Momentum rilis sudah habis — NO TRADE.'
  }
};

const fmtPrice = (v: number, digits: number): string =>
  Number.isFinite(v) ? v.toFixed(digits) : '—';

export const PostNewsCalibrator: React.FC<Props> = ({
  events,
  selectedEvent,
  onSelectEvent,
  onOpenAIAnalysis,
  prices,
  bars,
  priceSource,
  onRefreshPrices
}) => {
  const currentEvent = selectedEvent || events[0];

  const [actualInput, setActualInput] = useState<number>(
    currentEvent?.actual ?? (currentEvent?.forecast !== null && currentEvent?.forecast !== undefined
      ? Number((currentEvent.forecast + currentEvent.calibration.standardDeviationUnit * 1.5).toFixed(2))
      : 0)
  );
  const [forecastInput, setForecastInput] = useState<number>(currentEvent?.forecast ?? 0);
  const [previousInput, setPreviousInput] = useState<number>(currentEvent?.previous ?? 0);
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [selectedPair, setSelectedPair] = useState<string>(currentEvent?.affectedPairs[0] || 'EURUSD');
  const [simulateRelease, setSimulateRelease] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());

  // Jam berjalan agar badge fase (cooldown/aktif/kadaluarsa) ikut berubah.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (currentEvent) {
      const defaultActual = currentEvent.actual !== null && currentEvent.actual !== undefined
        ? currentEvent.actual
        : Number(((currentEvent.forecast ?? 0) + currentEvent.calibration.standardDeviationUnit * 1.2).toFixed(2));
      setActualInput(defaultActual);
      setForecastInput(currentEvent.forecast ?? 0);
      setPreviousInput(currentEvent.previous ?? 0);
      const fallback = currentEvent.affectedPairs[0] || 'EURUSD';
      setSelectedPair(prices[fallback] ? fallback : currentEvent.affectedPairs.find((p) => prices[p]) || fallback);
      setSimulateRelease(false);
    }
  }, [currentEvent?.id]);

  // Event turunan: Actual dari input; bila simulasi aktif, rilis dianggap sudah
  // melewati fase spreading 60 detik agar jendela ACTIVE bisa diuji langsung.
  const effectiveEvent: EconomicEvent = useMemo(() => {
    const hasRealRelease = currentEvent.status !== 'UPCOMING' && currentEvent.actual !== null;
    if (!hasRealRelease && !simulateRelease) {
      return {
        ...currentEvent,
        forecast: forecastInput,
        previous: previousInput,
        actual: actualInput,
        status: 'UPCOMING' as const,
        releasedAt: undefined
      };
    }
    const releasedAt = hasRealRelease
      ? currentEvent.releasedAt || currentEvent.scheduledTime
      : new Date(now - 5 * 60000).toISOString(); // T+5 menit: jendela ACTIVE optimal
    return {
      ...currentEvent,
      forecast: forecastInput,
      previous: previousInput,
      actual: actualInput,
      status: 'RELEASED' as const,
      releasedAt,
      scheduledTime: currentEvent.scheduledTime
    };
  }, [currentEvent, actualInput, forecastInput, previousInput, simulateRelease, now]);

  const evalResult = evaluateSignal({
    event: effectiveEvent,
    actual: actualInput,
    forecast: forecastInput,
    previous: previousInput,
    pair: selectedPair,
    quote: prices[selectedPair] || null,
    prices,
    bars: bars[selectedPair],
    accountBalance,
    riskPercent,
    now
  });

  const calibration = evalResult.calibration;
  const isPreNewsMode = calibration.phase === 'PRE_RELEASE';

  const ticket: PairTicket = useMemo(() => {
    if (isPreNewsMode) {
      return buildPreNewsTicket({
        event: effectiveEvent,
        pair: selectedPair,
        quote: prices[selectedPair] || null,
        prices,
        accountBalance,
        riskPercent,
        now
      });
    }
    return evalResult.ticket;
  }, [isPreNewsMode, evalResult.ticket, effectiveEvent, selectedPair, prices, accountBalance, riskPercent, now]);

  // Tiket untuk SEMUA pair yang tersedia pada event ini (matriks eksekusi).
  const pairTickets: PairTicket[] = useMemo(() => {
    const list = (currentEvent.affectedPairs?.length ? currentEvent.affectedPairs : [selectedPair])
      .filter((p, i, arr) => arr.indexOf(p) === i);
    return list.map((pair) =>
      isPreNewsMode
        ? buildPreNewsTicket({
            event: effectiveEvent,
            pair,
            quote: prices[pair] || null,
            prices,
            accountBalance,
            riskPercent,
            now
          })
        : evaluateSignal({
            event: effectiveEvent,
            actual: actualInput,
            forecast: forecastInput,
            previous: previousInput,
            pair,
            quote: prices[pair] || null,
            prices,
            bars: bars[pair],
            accountBalance,
            riskPercent,
            now
          }).ticket
    );
  }, [isPreNewsMode, effectiveEvent, actualInput, forecastInput, previousInput, selectedPair, prices, bars, accountBalance, riskPercent, now]);

  const isBullish = calibration.bias === 'STRONG_BUY' || calibration.bias === 'BUY';
  const isBearish = calibration.bias === 'STRONG_SELL' || calibration.bias === 'SELL';
  const phaseMeta = PHASE_META[calibration.phase];
  const quote = prices[selectedPair];
  const { zStrong, zModerate } = thresholdsFor(currentEvent);
  const tradable = isPreNewsMode ? ticket.tradable : ticket.tradable && calibration.tradable;

  return (
    <div className="space-y-6">
      {/* Header & Event Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                Live Parameter Calibrator & Deviation Simulator
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Sinyal dihitung dari Actual vs Forecast, fase rilis, dan harga pasar riil. Di luar jendela valid → NO TRADE dengan alasan.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 shrink-0 font-medium">Pilih Indikator:</span>
            <select
              value={currentEvent?.id}
              onChange={(e) => {
                const found = events.find((ev) => ev.id === e.target.value);
                if (found) onSelectEvent(found);
              }}
              className="bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-cyan-500"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  [{ev.currency}] {ev.title} ({ev.status === 'UPCOMING' ? 'Upcoming' : 'Released'})
                </option>
              ))}
            </select>

            <button
              onClick={() => onOpenAIAnalysis(currentEvent)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Analisis</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Inputs & Risk */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center justify-between">
              <span>Input Data Rilis & Parameter Deviasi</span>
              <span className="text-cyan-400 text-[11px] font-normal lowercase">unit: {currentEvent.unit}</span>
            </h3>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-semibold text-slate-200">Actual Value (Data Aktual / Rilis):</label>
                <span className="text-cyan-400 font-mono text-[11px]">
                  Deviasi: {Number.isFinite(calibration.rawDeviation) ? (calibration.rawDeviation >= 0 ? '+' : '') + calibration.rawDeviation : '—'} {currentEvent.unit}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  value={actualInput}
                  onChange={(e) => setActualInput(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 rounded-lg px-3 py-2 text-base font-mono font-bold text-cyan-300 focus:outline-none"
                />
                <span className="text-xs font-mono text-slate-400 px-2 py-2 bg-slate-800 rounded border border-slate-700">
                  {currentEvent.unit}
                </span>
              </div>
              <div className="flex gap-2 pt-1 flex-wrap">
                <button
                  onClick={() => setActualInput(Number((forecastInput + currentEvent.calibration.standardDeviationUnit * 2).toFixed(2)))}
                  className="px-2 py-1 text-[10px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 rounded hover:bg-emerald-900 transition-colors"
                >
                  +2σ Bullish Surprise
                </button>
                <button
                  onClick={() => setActualInput(Number(forecastInput.toFixed(2)))}
                  className="px-2 py-1 text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700 rounded hover:bg-slate-750 transition-colors"
                >
                  Inline Consensus
                </button>
                <button
                  onClick={() => setActualInput(Number((forecastInput - currentEvent.calibration.standardDeviationUnit * 2).toFixed(2)))}
                  className="px-2 py-1 text-[10px] font-mono bg-rose-950/60 text-rose-400 border border-rose-800/80 rounded hover:bg-rose-900 transition-colors"
                >
                  -2σ Bearish Miss
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Consensus Forecast:</label>
                <input
                  type="number"
                  step="any"
                  value={forecastInput}
                  onChange={(e) => setForecastInput(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Previous Print:</label>
                <input
                  type="number"
                  step="any"
                  value={previousInput}
                  onChange={(e) => setPreviousInput(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-300"
                />
              </div>
            </div>

            {/* Ambang z-score dari parameter event */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg text-xs space-y-1.5 font-mono">
              <div className="text-slate-400 flex justify-between">
                <span>Std. Dev Unit:</span>
                <span className="text-slate-200 font-bold">{currentEvent.calibration.standardDeviationUnit} {currentEvent.unit}</span>
              </div>
              <div className="text-slate-400 flex justify-between">
                <span>Ambang z kuat / moderat:</span>
                <span className="text-amber-300">{zStrong.toFixed(2)}σ / {zModerate.toFixed(2)}σ</span>
              </div>
              <div className="text-slate-400 flex justify-between">
                <span>Batas momentum:</span>
                <span className="text-cyan-400">±{currentEvent.calibration.highImpactThreshold} {currentEvent.unit} · {currentEvent.calibration.invalidationTimeMinutes} menit</span>
              </div>
              <div className="text-slate-400 flex justify-between">
                <span>Spread Expansion Buffer:</span>
                <span className="text-cyan-400">{currentEvent.calibration.liquiditySpreadBufferPips} pips</span>
              </div>
            </div>

            {/* Simulasi rilis untuk event yang belum datang */}
            {currentEvent.status === 'UPCOMING' && (
              <label className="flex items-start gap-2 text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simulateRelease}
                  onChange={(e) => setSimulateRelease(e.target.checked)}
                  className="mt-0.5 accent-cyan-500"
                />
                <span>
                  <strong className="text-slate-200">Simulasi rilis pasca-news (T+5 menit).</strong>{' '}
                  Tanpa centang, kalibrator menampilkan sinyal <strong>Pra-Rilis</strong> (Forecast vs Previous) &amp; Pending Order <strong>Straddle OCO</strong>.
                </span>
              </label>
            )}
          </div>

          {/* Risk Management */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span>Risk Management & Lot Size Calculator</span>
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Account Balance ($):</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-slate-500 font-mono">$</span>
                  <input
                    type="number"
                    value={accountBalance}
                    onChange={(e) => setAccountBalance(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-6 pr-3 py-1.5 text-xs font-mono text-slate-200"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Risk Per Trade (%):</label>
                <div className="relative">
                  <span className="absolute right-2.5 top-2 text-xs text-slate-500 font-mono">%</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0.25"
                    max="5"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-3 pr-7 py-1.5 text-xs font-mono text-slate-200"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Pilih Pasangan Eksekusi:</label>
              <select
                value={selectedPair}
                onChange={(e) => setSelectedPair(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-cyan-300"
              >
                {currentEvent.affectedPairs.map((p) => (
                  <option key={p} value={p}>
                    {p}{prices[p] ? '' : ' (tanpa harga)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-3 bg-cyan-950/20 border border-cyan-800/40 rounded-lg text-xs space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Maksimum Kerugian (Risk $):</span>
                <span className="font-mono font-bold text-rose-400">${((accountBalance * riskPercent) / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Lot Size ({selectedPair}):</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">{ticket.lots.toFixed(2)} lot</span>
              </div>
              <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                Nilai pip riil {ticket.pipUnit === 'pips' ? '$' : ''}{Number.isFinite(ticket.pipValue) ? ticket.pipValue.toFixed(2) : '—'}
                {ticket.pipUnit === 'pts' ? ' $/pt' : '/lot'} × SL {ticket.slPips} {ticket.pipUnit} — bukan asumsi $10/pip.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Signal + Ticket */}
        <div className="lg:col-span-7 space-y-5">
          {/* Signal card */}
          <div className={`p-5 rounded-xl border relative overflow-hidden ${
            isBullish
              ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border-emerald-800/60'
              : isBearish
              ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-rose-950/40 border-rose-800/60'
              : 'bg-slate-900 border-slate-800'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${phaseMeta.className}`}>
                    {phaseMeta.label}
                  </span>
                  <span className="font-mono font-bold text-slate-200">
                    {Number.isFinite(calibration.rawDeviation) ? (calibration.rawDeviation >= 0 ? '+' : '') + calibration.rawDeviation : '—'} {currentEvent.unit}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono font-bold text-cyan-400">
                    {Number.isFinite(calibration.normalizedZScore) ? (calibration.normalizedZScore >= 0 ? '+' : '') + calibration.normalizedZScore : '—'}σ
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono text-slate-400">zModerate {zModerate.toFixed(2)}σ</span>
                </div>

                <div className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  {isBullish ? <TrendingUp className="w-6 h-6 text-emerald-400" /> : isBearish ? <TrendingDown className="w-6 h-6 text-rose-400" /> : <Gauge className="w-6 h-6 text-slate-400" />}
                  <span>{calibration.biasLabel}</span>
                </div>

                <div className="text-xs text-slate-300 font-medium flex items-center gap-2 flex-wrap">
                  <span>Strategy:</span>
                  <span className="font-mono font-bold text-cyan-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {calibration.strategy}
                  </span>
                  <span className="text-slate-400 font-mono">(Confidence: {calibration.confidenceScore}%)</span>
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl text-center shrink-0 min-w-[150px]">
                <span className="text-[10px] font-mono uppercase text-slate-400 block">Proyeksi Pergerakan</span>
                <span className="text-2xl font-mono font-bold text-cyan-300">±{ticket.expectedPips} {ticket.pipUnit}</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {ticket.expectedMovePct.toFixed(3)}% · RR {calibration.riskRewardRatio}
                </span>
              </div>
            </div>

            {/* Gate: alasan NO TRADE / status eksekusi */}
            {!tradable ? (
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-start gap-2 text-xs">
                <Ban className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-mono font-bold text-rose-300">NO TRADE — {ticket.gateReason || calibration.gateReason}</div>
                  <div className="text-slate-400">{phaseMeta.hint}</div>
                  {calibration.minutesSinceRelease !== null && (
                    <div className="text-slate-500 font-mono text-[11px]">
                      T+{calibration.minutesSinceRelease} menit sejak rilis
                      {calibration.validUntil && ` · berlaku s/d ${new Date(calibration.validUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-start gap-2 text-xs">
                <Radio className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-mono font-bold text-emerald-300">
                    {ticket.action} {ticket.display} — {ticket.directionReason}
                  </div>
                  <div className="text-slate-400 font-mono text-[11px]">
                    Sumber harga: {ticket.priceSource} · via {ticket.via}
                    {ticket.validUntil && ` · berlaku s/d ${new Date(ticket.validUntil).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                </div>
              </div>
            )}

            <p className="mt-3 text-xs text-slate-400 leading-relaxed">{calibration.strategyDescription}</p>
          </div>

          {/* Execution ticket */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400" />
                <span>Parameter Order Tiket Eksekusi ({ticket.display})</span>
              </h3>
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                {quote ? (
                  <span>Bid {fmtPrice(quote.bid, ticket.digits)} · Ask {fmtPrice(quote.ask, ticket.digits)} · {quote.source}</span>
                ) : (
                  <span className="text-rose-400">Harga tidak tersedia</span>
                )}
                <button
                  onClick={onRefreshPrices}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 hover:border-cyan-600 hover:text-cyan-300 transition-colors"
                  title="Muat ulang harga (snapshot + live)"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className={`p-3 bg-slate-950 rounded-lg border space-y-1 ${tradable && ticket.action === 'BUY' ? 'border-emerald-800/60' : tradable ? 'border-rose-900/40' : 'border-slate-800'}`}>
                <span className="text-[10px] text-slate-400 uppercase font-mono block">
                  {isPreNewsMode ? 'Setup Pra-News' : 'Action & Entry'}
                </span>
                <span className={`font-mono font-bold text-sm block ${!tradable ? 'text-slate-500' : ticket.action === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {tradable ? `${ticket.action} / ${ticket.action === 'BUY' ? 'LONG' : 'SHORT'}` : 'STRADDLE / WAIT'}
                </span>
                <span className="text-[11px] font-mono text-slate-300 block">
                  Market: {fmtPrice(ticket.entryPrice, ticket.digits)}
                </span>
                {ticket.pullbackEntryPrice && (
                  <span className="text-[10px] font-mono text-cyan-400 block">
                    Limit FVG: {fmtPrice(ticket.pullbackEntryPrice, ticket.digits)}
                  </span>
                )}
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-rose-900/40 space-y-1">
                <span className="text-[10px] text-rose-400 uppercase font-mono block">Stop Loss</span>
                <span className="font-mono font-bold text-sm text-rose-400 block">{ticket.slPips} {ticket.pipUnit}</span>
                <span className="text-[11px] font-mono text-slate-300">{fmtPrice(ticket.slPrice, ticket.digits)}</span>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-emerald-900/40 space-y-1">
                <span className="text-[10px] text-emerald-400 uppercase font-mono block">Take Profit 1 (1.5R)</span>
                <span className="font-mono font-bold text-sm text-emerald-400 block">+{ticket.tp1Pips} {ticket.pipUnit}</span>
                <span className="text-[11px] font-mono text-slate-300">{fmtPrice(ticket.tp1Price, ticket.digits)}</span>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-cyan-900/40 space-y-1">
                <span className="text-[10px] text-cyan-400 uppercase font-mono block">Take Profit 2 (2.8R)</span>
                <span className="font-mono font-bold text-sm text-cyan-400 block">+{ticket.tp2Pips} {ticket.pipUnit}</span>
                <span className="text-[11px] font-mono text-slate-300">{fmtPrice(ticket.tp2Price, ticket.digits)}</span>
              </div>
            </div>

            {ticket.straddle && (
              <div className="p-3 bg-amber-950/15 border border-amber-800/40 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
                <div className="text-amber-300 font-semibold">
                  Straddle Breakout OCO (Buffer ±{ticket.straddle.bufferPips} {ticket.pipUnit}):
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-slate-300">
                  <span>
                    Buy Stop: <strong className="text-emerald-300">{fmtPrice(ticket.straddle.buyStopPrice, ticket.digits)}</strong>
                  </span>
                  <span>
                    Sell Stop: <strong className="text-rose-300">{fmtPrice(ticket.straddle.sellStopPrice, ticket.digits)}</strong>
                  </span>
                  <span className="text-slate-400">
                    (SL {ticket.straddle.stopLossPips} / TP {ticket.straddle.takeProfitPips} {ticket.pipUnit})
                  </span>
                </div>
              </div>
            )}

            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-2 text-xs">
              <div className="flex items-center gap-2 font-mono text-[11px] text-cyan-400 font-semibold">
                <Clock className="w-3.5 h-3.5" />
                <span>Protokol Timing Eksekusi:</span>
              </div>
              <div className="text-slate-300 text-xs leading-relaxed">
                <strong className="text-slate-100">Window Ideal:</strong> {calibration.optimalTiming}
              </div>
              <div className="text-[11px] text-slate-400">
                Peringatan Slippage: jangan mengejar spike pada detik 0–15 pertama (spread melebar hingga {currentEvent.calibration.liquiditySpreadBufferPips} pips).
                {ticket.reaction && (
                  <span className="block mt-1 text-cyan-400/90 font-mono">
                    Reaksi harga terukur: {ticket.reaction.movePct > 0 ? '+' : ''}{ticket.reaction.movePct}% dalam {ticket.reaction.minutes} menit pasca-rilis.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Multi-pair execution matrix */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Matriks Sinyal Semua Pasangan Tersedia</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase border-b border-slate-800">
                    <th className="text-left py-2 pr-2">Pair</th>
                    <th className="text-left py-2 pr-2">Aksi</th>
                    <th className="text-right py-2 pr-2">Entry</th>
                    <th className="text-right py-2 pr-2">SL</th>
                    <th className="text-right py-2 pr-2">TP1</th>
                    <th className="text-right py-2 pr-2">TP2</th>
                    <th className="text-right py-2 pr-2">Lot</th>
                    <th className="text-right py-2">Via</th>
                  </tr>
                </thead>
                <tbody>
                  {pairTickets.map((t) => (
                    <tr
                      key={t.pair}
                      onClick={() => setSelectedPair(t.pair)}
                      className={`border-b border-slate-800/60 cursor-pointer ${t.pair === selectedPair ? 'bg-cyan-950/20' : 'hover:bg-slate-950/60'}`}
                    >
                      <td className="py-2 pr-2 text-slate-200 font-bold">{t.display}</td>
                      <td className="py-2 pr-2">
                        {!t.tradable ? (
                          <span className="text-slate-500" title={t.gateReason}>NO TRADE</span>
                        ) : (
                          <span className={t.action === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            {t.action}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right text-slate-300">{fmtPrice(t.entryPrice, t.digits)}</td>
                      <td className="py-2 pr-2 text-right text-rose-300">{fmtPrice(t.slPrice, t.digits)}</td>
                      <td className="py-2 pr-2 text-right text-emerald-300">{fmtPrice(t.tp1Price, t.digits)}</td>
                      <td className="py-2 pr-2 text-right text-cyan-300">{fmtPrice(t.tp2Price, t.digits)}</td>
                      <td className="py-2 pr-2 text-right text-slate-300">{t.tradable ? t.lots.toFixed(2) : '—'}</td>
                      <td className="py-2 text-right text-slate-500 text-[10px]" title={t.tradable ? t.directionReason : t.gateReason}>
                        {t.via}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-500">
              Klik baris untuk memindahkan fokus tiket. Harga sumber: {priceSource}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
