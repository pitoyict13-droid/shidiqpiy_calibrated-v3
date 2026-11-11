import React, { useEffect, useMemo, useState } from 'react';
import type { EconomicEvent, MinuteBar, PairTicket, PriceQuote } from '../types/trading';
import { buildAutoBoard, formatCountdown, type AutoSignalItem, type AutoSignalState } from '../utils/autoSignal';
import {
  Bot,
  Zap,
  Clock,
  Ban,
  TrendingUp,
  TrendingDown,
  Gauge,
  Target,
  RefreshCw,
  Info,
  ChevronRight,
  Sparkles
} from 'lucide-react';

interface Props {
  events: EconomicEvent[];
  prices: Record<string, PriceQuote>;
  bars: Record<string, MinuteBar[]>;
  priceSource: string;
  onRefreshPrices: () => void;
  onOpenEvent: (event: EconomicEvent) => void;
  /** Nilai awal mode contoh (default true agar hasil akhir langsung terlihat). */
  defaultSimulate?: boolean;
}

const STATE_META: Record<AutoSignalState, { label: string; className: string; icon: React.ReactNode }> = {
  SIGNAL: {
    label: 'SINYAL AKTIF',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    icon: <Zap className="w-3.5 h-3.5" />
  },
  COOLDOWN: {
    label: 'COOLDOWN',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    icon: <Clock className="w-3.5 h-3.5" />
  },
  NO_TRADE: {
    label: 'NO TRADE',
    className: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    icon: <Ban className="w-3.5 h-3.5" />
  },
  EXPIRED: {
    label: 'KADALUARSA',
    className: 'bg-slate-800 text-slate-400 border-slate-600',
    icon: <Clock className="w-3.5 h-3.5" />
  },
  WAITING: {
    label: 'MENUNGGU RILIS',
    className: 'bg-slate-800 text-cyan-300 border-cyan-700/60',
    icon: <Clock className="w-3.5 h-3.5" />
  },
  NO_DATA: {
    label: 'TANPA ANGKA',
    className: 'bg-slate-900 text-slate-500 border-slate-700',
    icon: <Info className="w-3.5 h-3.5" />
  }
};

const IMPACT_CHIP: Record<string, string> = {
  HIGH: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW: 'bg-slate-800 text-slate-400 border-slate-700'
};

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

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const hari = d.toLocaleDateString([], { weekday: 'short' });
  const tanggal = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  const jam = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${hari}, ${tanggal} · ${jam} (${TZ_LABEL})`;
};

const fmtPrice = (v: number, digits: number) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

const actionClass = (action: PairTicket['action']) =>
  action === 'BUY'
    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-600/40'
    : action === 'SELL'
    ? 'text-rose-300 bg-rose-500/10 border-rose-600/40'
    : 'text-slate-400 bg-slate-800 border-slate-700';

/** Tiket ringkas: Entry/SL/TP1/TP2/lot untuk satu event. */
const TicketTable: React.FC<{ tickets: PairTicket[]; isPreNews?: boolean }> = ({ tickets, isPreNews = false }) => {
  const live = tickets.filter((t) => t.tradable);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-[11px] font-mono min-w-[560px]">
        <thead>
          <tr className="text-slate-500 uppercase tracking-wider">
            <th className="text-left py-1 pr-3 font-semibold">Pair</th>
            <th className="text-left py-1 pr-3 font-semibold">Arah</th>
            <th className="text-right py-1 pr-3 font-semibold">{isPreNews ? 'Entry Pra-News' : 'Entry Pasar'}</th>
            <th className="text-right py-1 pr-3 font-semibold">Pullback (FVG)</th>
            <th className="text-right py-1 pr-3 font-semibold">SL</th>
            <th className="text-right py-1 pr-3 font-semibold">TP1</th>
            <th className="text-right py-1 pr-3 font-semibold">TP2</th>
            <th className="text-right py-1 pr-3 font-semibold">Lot</th>
            <th className="text-right py-1 font-semibold">Status / Eksekusi</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <React.Fragment key={t.pair}>
              <tr className={`border-t border-slate-800/80 ${t.tradable ? '' : 'opacity-70'}`}>
                <td className="py-1.5 pr-3 text-slate-200 font-bold">{t.display}</td>
                <td className="py-1.5 pr-3">
                  <span className={`px-1.5 py-0.5 rounded border font-bold ${actionClass(t.action)}`}>{t.action}</span>
                </td>
                <td className="py-1.5 pr-3 text-right text-cyan-200 tabular-nums">{fmtPrice(t.entryPrice, t.digits)}</td>
                <td className="py-1.5 pr-3 text-right text-slate-400 tabular-nums">
                  {t.pullbackEntryPrice ? fmtPrice(t.pullbackEntryPrice, t.digits) : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right text-rose-300 tabular-nums">{fmtPrice(t.slPrice, t.digits)}</td>
                <td className="py-1.5 pr-3 text-right text-emerald-300 tabular-nums">{fmtPrice(t.tp1Price, t.digits)}</td>
                <td className="py-1.5 pr-3 text-right text-emerald-300 tabular-nums">{fmtPrice(t.tp2Price, t.digits)}</td>
                <td className="py-1.5 pr-3 text-right text-amber-200 tabular-nums">{t.lots > 0 ? t.lots.toFixed(2) : '—'}</td>
                <td className="py-1.5 text-right">
                  {t.tradable ? (
                    <span className="text-emerald-300 font-bold">
                      {t.via === 'market-sentiment'
                        ? 'SIAP (SENTIMEN)'
                        : isPreNews || t.signalType === 'PRE_NEWS'
                        ? 'SIAP (PRA-NEWS)'
                        : 'SIAP (PASCA-NEWS)'}
                    </span>
                  ) : t.straddle && t.action === 'NONE' ? (
                    <span className="text-amber-300 font-medium" title={`Buy Stop @ ${t.straddle.buyStopPrice} / Sell Stop @ ${t.straddle.sellStopPrice}`}>
                      STRADDLE OCO
                    </span>
                  ) : (
                    <span className="text-rose-400/90" title={t.gateReason}>
                      {t.gateReason.length > 28 ? `${t.gateReason.slice(0, 28)}…` : t.gateReason}
                    </span>
                  )}
                </td>
              </tr>
              {t.straddle && !t.tradable && t.action === 'NONE' && (
                <tr className="bg-slate-950/40 text-[10px] text-slate-400">
                  <td colSpan={9} className="py-1 px-2 border-b border-slate-900 font-mono">
                    <span className="text-amber-400/90 font-semibold">Fallback Straddle OCO (Netral):</span> Buy Stop{' '}
                    <span className="text-cyan-300 font-bold">{fmtPrice(t.straddle.buyStopPrice, t.digits)}</span> · Sell Stop{' '}
                    <span className="text-cyan-300 font-bold">{fmtPrice(t.straddle.sellStopPrice, t.digits)}</span> · Buffer ±
                    {t.straddle.bufferPips}p · SL {t.straddle.stopLossPips}p / TP {t.straddle.takeProfitPips}p
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {live.length === 0 && !isPreNews && (
        <p className="text-[11px] text-slate-500 mt-2">
          Belum ada tiket yang lolos gate — lihat alasan di kolom Status.
        </p>
      )}
    </div>
  );
};

/** Satu baris ringkas untuk event yang belum rilis. */
const WaitingRow: React.FC<{ item: AutoSignalItem; onOpen: (e: EconomicEvent) => void }> = ({ item, onOpen }) => {
  const biasUp = item.preNews !== null && item.preNews > 0;
  const tradablePre = (item.preNewsTickets || []).filter((t) => t.tradable);
  return (
    <button
      onClick={() => onOpen(item.event)}
      className="w-full text-left p-3 rounded-lg border border-slate-800 bg-slate-950/40 hover:border-cyan-700/60 hover:bg-slate-900/60 transition-colors group"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-slate-800 text-cyan-300 rounded border border-slate-700 shrink-0">
            {item.event.currency}
          </span>
          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${IMPACT_CHIP[item.event.impact]}`}>
            {item.event.impact}
          </span>
          <span className="text-sm text-slate-200 truncate">{item.event.title}</span>
          {item.simulated && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-purple-500/15 text-purple-300 border-purple-500/40">
              SIMULASI
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {item.preNews !== null && Number.isFinite(item.preNews) && (
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                biasUp ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/40' : 'bg-rose-500/10 text-rose-300 border-rose-600/40'
              }`}
              title="Bias pra-news: Forecast vs Previous (dalam sigma)"
            >
              pra-news {item.preNews > 0 ? '+' : ''}
              {item.preNews.toFixed(2)}σ
            </span>
          )}
          <span className="text-xs font-mono text-cyan-300 tabular-nums">
            {formatCountdown(item.countdownMs ?? 0)}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400" />
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono mt-1 flex-wrap gap-2">
        <span>{fmtTime(item.event.scheduledTime)}</span>
        {tradablePre.length > 0 ? (
          <span className="text-cyan-400/90">
            Setup 1 Harga ({tradablePre[0].via === 'market-sentiment' ? 'Sentimen' : 'Pra-News'}):{' '}
            {tradablePre.slice(0, 3).map((t) => (
              <span key={t.pair} className="ml-1 text-slate-300">
                {t.action} {t.display} @ {fmtPrice(t.entryPrice, t.digits)}
              </span>
            ))}
          </span>
        ) : item.preNewsTickets && item.preNewsTickets.some((t) => t.straddle) ? (
          <span className="text-amber-400/80">Fallback Straddle OCO (news & sentimen netral)</span>
        ) : (
          <span className="text-slate-500">Menunggu rilis & konfirmasi arah</span>
        )}
      </div>
    </button>
  );
};

export const AutoSignalBoard: React.FC<Props> = ({
  events,
  prices,
  bars,
  priceSource,
  onRefreshPrices,
  onOpenEvent,
  defaultSimulate = true
}) => {
  const [now, setNow] = useState<number>(Date.now());
  // Rilis sungguhan = punya Actual; kalau sudah ada, mode contoh tidak diaktifkan.
  const hasRealRelease = events.some(
    (e) => e.status !== 'UPCOMING' && typeof e.actual === 'number' && Number.isFinite(e.actual)
  );
  // Mode contoh aktif sejak awal (bila belum ada rilis) agar keputusan akhir
  // langsung terlihat; efek di bawah mematikannya begitu data riil masuk.
  const [simulate, setSimulate] = useState<boolean>(defaultSimulate && !hasRealRelease);

  // Jam berjalan agar hitung mundur & fase sinyal selalu akurat.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Begitu data rilis sungguhan tersedia (Actual masuk dari feed kalender),
  // mode simulasi dimatikan otomatis supaya yang tampil adalah sinyal riil.
  useEffect(() => {
    if (hasRealRelease) setSimulate(false);
  }, [hasRealRelease]);

  const board = useMemo(
    () => buildAutoBoard({ events, prices, bars, now, accountBalance: 10000, riskPercent: 1.0, simulate }),
    [events, prices, bars, now, simulate]
  );

  const headline = board.headline;
  const released = board.items.filter((i) => i.state !== 'WAITING' && i.state !== 'NO_DATA');
  const waiting = board.items.filter((i) => i.state === 'WAITING');
  const noData = board.items.filter((i) => i.state === 'NO_DATA');
  const liveTickets = headline ? headline.tickets.filter((t) => t.tradable) : [];
  const preLiveTickets = headline ? (headline.preNewsTickets || []).filter((t) => t.tradable && t.action !== 'NONE') : [];

  const meta = headline ? STATE_META[headline.state] : null;
  const isBullish =
    headline?.state === 'SIGNAL' && liveTickets.length > 0
      ? liveTickets[0].action === 'BUY'
      : headline?.bias === 'STRONG_BUY' || headline?.bias === 'BUY';
  const isBearish =
    headline?.state === 'SIGNAL' && liveTickets.length > 0
      ? liveTickets[0].action === 'SELL'
      : headline?.bias === 'STRONG_SELL' || headline?.bias === 'SELL';

  return (
    <div className="space-y-6">
      {/* Header panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-bold text-white tracking-tight">Sinyal Kalibrasi Otomatis</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/40">
                AUTO
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Seluruh jadwal dievaluasi terus-menerus oleh engine kalibrasi — tanpa klik apa pun. Hasil akhirnya hanya lima:
              <span className="text-emerald-300 font-semibold"> SINYAL</span>,
              <span className="text-amber-300 font-semibold"> COOLDOWN</span>,
              <span className="text-rose-300 font-semibold"> NO TRADE</span>,
              <span className="text-cyan-300 font-semibold"> MENUNGGU RILIS</span>, atau
              <span className="text-slate-400 font-semibold"> TANPA ANGKA</span>.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSimulate(!simulate)}
              title="Mode demo: event MEDIUM+ terdekat dianggap baru rilis (Actual = Forecast + 1.5σ) agar terlihat bentuk sinyalnya"
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border transition-colors ${
                simulate
                  ? 'bg-purple-500/15 border-purple-500/50 text-purple-200'
                  : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-purple-600 hover:text-purple-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {simulate ? 'Simulasi ON — matikan' : 'Lihat contoh sinyal (simulasi)'}
            </button>
            <button
              onClick={onRefreshPrices}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-md border border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-600 hover:text-cyan-300 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh harga
            </button>
          </div>
        </div>

        {/* Ringkasan hitungan otomatis */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-4">
          {(Object.keys(STATE_META) as AutoSignalState[]).map((key) => (
            <div key={key} className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{STATE_META[key].label}</div>
              <div
                className={`text-xl font-mono font-bold ${
                  key === 'SIGNAL'
                    ? 'text-emerald-300'
                    : key === 'NO_TRADE'
                    ? 'text-rose-300'
                    : key === 'WAITING'
                    ? 'text-cyan-300'
                    : 'text-slate-300'
                }`}
              >
                {board.counts[key]}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* HERO: keputusan utama */}
      {headline && meta && (
        <div
          className={`p-5 rounded-xl border relative overflow-hidden ${
            headline.state === 'SIGNAL'
              ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border-emerald-800/60'
              : isBearish
              ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-rose-950/40 border-rose-900/50'
              : isBullish
              ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 border-emerald-900/50'
              : 'bg-slate-900 border-slate-800'
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono font-bold ${meta.className}`}>
                  {meta.icon}
                  {meta.label}
                </span>
                {headline.simulated && (
                  <span className="px-2 py-1 rounded border font-mono font-bold text-[11px] bg-purple-500/15 text-purple-200 border-purple-500/50">
                    SIMULASI (bukan rilis sungguhan)
                  </span>
                )}
                {!hasRealRelease && (
                  <span className="px-2 py-1 rounded border font-mono text-[11px] bg-slate-800 text-slate-300 border-slate-600">
                    Belum ada rilis hari ini — menampilkan contoh otomatis
                  </span>
                )}
                <span className="font-mono text-slate-400">
                  {headline.event.currency} · {headline.event.impact}
                </span>
                <span className="font-mono text-slate-500">{fmtTime(headline.event.scheduledTime)}</span>
              </div>

              <h3 className="text-xl sm:text-2xl font-bold text-white leading-tight">{headline.event.title}</h3>

              <div
                className={`text-lg sm:text-xl font-bold ${
                  headline.state === 'SIGNAL' ? (isBullish ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-100'
                }`}
              >
                {headline.headline}
              </div>

              <div className="text-xs font-mono text-slate-400 space-x-3">
                <span>{headline.deviationLabel}</span>
                {headline.state === 'WAITING' && (
                  <span className="text-cyan-300">
                    T-{formatCountdown(headline.countdownMs ?? 0)}
                  </span>
                )}
                {headline.state !== 'WAITING' && (
                  <span className="text-slate-500">
                    confidence {headline.confidence}% · fase {headline.phase}
                  </span>
                )}
              </div>

              {headline.gateReason && headline.state !== 'SIGNAL' && (
                <div className="flex items-start gap-2 text-xs text-slate-400 mt-1">
                  <Ban className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  <span>{headline.gateReason}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  onClick={() => onOpenEvent(headline.event)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors"
                >
                  <Target className="w-3.5 h-3.5" /> Buka detail kalibrasi
                </button>
                <span className="text-[11px] font-mono text-slate-500">
                  Harga: {priceSource}
                </span>
              </div>
            </div>

            {/* Arah & proyeksi */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 min-w-[190px] shrink-0 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                {headline.state === 'SIGNAL' ? <Zap className="w-3 h-3 text-emerald-400" /> : <Gauge className="w-3 h-3" />}
                Keputusan Engine
              </div>
              {headline.state === 'SIGNAL' && liveTickets.length > 0 ? (
                <>
                  <div className="text-2xl font-mono font-bold text-emerald-300 flex items-center gap-2">
                    {isBullish ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                    {liveTickets[0].action}
                  </div>
                  <div className="text-xs text-slate-300 font-mono">
                    {liveTickets.map((t) => t.display).join(' · ')}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Entry {fmtPrice(liveTickets[0].entryPrice, liveTickets[0].digits)} · SL{' '}
                    {fmtPrice(liveTickets[0].slPrice, liveTickets[0].digits)} · TP2{' '}
                    {fmtPrice(liveTickets[0].tp2Price, liveTickets[0].digits)}
                  </div>
                </>
              ) : headline.state === 'WAITING' ? (
                preLiveTickets.length > 0 ? (
                  <>
                    <div
                      className={`text-2xl font-mono font-bold flex items-center gap-2 ${
                        preLiveTickets[0].action === 'BUY' ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {preLiveTickets[0].action === 'BUY' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      {preLiveTickets[0].action}
                    </div>
                    <div className="text-xs text-slate-300 font-mono">
                      {preLiveTickets[0].via === 'market-sentiment' ? 'Sentimen Pasar' : 'Bias Pra-News'} ·{' '}
                      {preLiveTickets.map((t) => `${t.action} ${t.display}`).slice(0, 3).join(' · ')}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Entry {fmtPrice(preLiveTickets[0].entryPrice, preLiveTickets[0].digits)} · SL{' '}
                      {fmtPrice(preLiveTickets[0].slPrice, preLiveTickets[0].digits)} · TP2{' '}
                      {fmtPrice(preLiveTickets[0].tp2Price, preLiveTickets[0].digits)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-base font-mono font-bold text-amber-300 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-amber-400" />
                      <span>STRADDLE OCO</span>
                    </div>
                    <div className="text-xs text-slate-300 font-mono">
                      {headline.preNews !== null && Math.abs(headline.preNews) >= 0.5
                        ? `${headline.event.currency} ${headline.preNews > 0 ? 'Bullish' : 'Bearish'} (${headline.preNews > 0 ? '+' : ''}${headline.preNews.toFixed(2)}σ)`
                        : 'News & Sentimen Netral (Breakout OCO)'}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Pending Order Buy/Sell Stop siap
                    </div>
                  </>
                )
              ) : (
                <div className="text-sm text-slate-300 font-semibold">
                  {headline.state === 'NO_DATA'
                    ? 'Tidak ada angka rilis untuk dikalibrasi.'
                    : 'Tidak dieksekusi.'}
                </div>
              )}
            </div>
          </div>

          {headline.state === 'SIGNAL' && headline.tickets.length > 0 ? (
            <TicketTable tickets={headline.tickets} />
          ) : headline.state === 'WAITING' && headline.preNewsTickets && headline.preNewsTickets.length > 0 ? (
            <div className="mt-3 pt-3 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-cyan-300 font-mono flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {preLiveTickets.length > 0
                    ? 'Sinyal Single-Entry Pra-Rilis & Sentimen Pasar (BUY/SELL + SL/TP):'
                    : 'Sinyal Antisipasi Pra-Rilis (Fallback Straddle OCO saat netral):'}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {preLiveTickets.length > 0 ? 'Arah tunggal siap dieksekusi' : 'Menunggu arah konfirmasi'}
                </span>
              </div>
              <TicketTable tickets={headline.preNewsTickets} isPreNews={true} />
            </div>
          ) : null}
        </div>
      )}

      {/* Rilis terbaru / status pasca-rilis */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Status Pasca-Rilis & Keputusan
          </h3>
          <span className="text-[11px] font-mono text-slate-400">{released.length} event</span>
        </div>
        <div className="divide-y divide-slate-800/80">
          {released.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              Belum ada rilis hari ini — semua jadwal masih <span className="text-cyan-300">MENUNGGU RILIS</span>.
              <div className="text-xs text-slate-500 mt-1">
                Saat angka Actual masuk (otomatis dari feed kalender), keputusan SINYAL/NO TRADE akan muncul di sini.
              </div>
            </div>
          ) : (
            released.map((item) => (
              <div key={item.event.id + (item.simulated ? '-sim' : '')} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border font-mono font-bold text-[10px] ${STATE_META[item.state].className}`}>
                        {STATE_META[item.state].icon}
                        {STATE_META[item.state].label}
                      </span>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-slate-800 text-cyan-300 rounded border border-slate-700">
                        {item.event.currency}
                      </span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${IMPACT_CHIP[item.event.impact]}`}>
                        {item.event.impact}
                      </span>
                      <span className="text-sm font-semibold text-slate-100">{item.event.title}</span>
                      {item.simulated && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-purple-500/15 text-purple-300 border-purple-500/40">
                          SIMULASI
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {fmtTime(item.event.scheduledTime)}
                      {item.minutesSinceRelease !== null && ` · T+${item.minutesSinceRelease} menit`}
                      {item.z !== null && Number.isFinite(item.z) && ` · z ${item.z >= 0 ? '+' : ''}${item.z.toFixed(2)}σ`}
                    </div>
                    <div className="text-xs text-slate-300">{item.headline}</div>
                  </div>
                  <button
                    onClick={() => onOpenEvent(item.event)}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-600 hover:text-cyan-300 transition-colors shrink-0"
                  >
                    Detail
                  </button>
                </div>
                {item.tickets.length > 0 && <TicketTable tickets={item.tickets} />}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Jadwal berikutnya (pra-news) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            Berikutnya (Pra-News, urut hitung mundur)
          </h3>
          <span className="text-[11px] font-mono text-slate-400">{waiting.length} menunggu</span>
        </div>
        <div className="space-y-2">
          {waiting.slice(0, 8).map((item) => (
            <WaitingRow key={item.event.id} item={item} onOpen={onOpenEvent} />
          ))}
          {waiting.length === 0 && (
            <div className="text-sm text-slate-400 p-2">Tidak ada jadwal menunggu pada muat ini.</div>
          )}
        </div>
        {waiting.length > 8 && (
          <div className="text-[11px] font-mono text-slate-500">
            +{waiting.length - 8} jadwal lainnya — lihat tab “Kalender & Pre-News” untuk daftar lengkap.
          </div>
        )}
        {noData.length > 0 && (
          <div className="text-[11px] font-mono text-slate-500 pt-2 border-t border-slate-800">
            {noData.length} event sudah lewat tanpa angka rilis (pidato/rapat) — otomatis tanpa sinyal.
          </div>
        )}
      </div>

      {/* Penjelasan singkat cara kerja */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-2">
        <div className="flex items-center gap-2 text-slate-300 font-semibold text-xs uppercase tracking-wider">
          <Info className="w-3.5 h-3.5 text-cyan-400" /> Cara kerja otomatis
        </div>
        <ol className="list-decimal list-inside space-y-1 leading-relaxed">
          <li>
            <span className="text-slate-200">Fase rilis</span> — sebelum Actual ada: MENUNGGU RILIS + hitung mundur & bias
            pra-news. Sesudah: COOLDOWN (spread melebar) → JENDELA AKTIF → KADALUARSA.
          </li>
          <li>
            <span className="text-slate-200">Z-score kejutan</span> — (Actual − Forecast) dinormalisasi ke sigma indikator.
            Di bawah ambang moderat → NO TRADE dengan alasan.
          </li>
          <li>
            <span className="text-slate-200">Gate eksekusi</span> — impact LOW, fase salah, atau harga pasar tidak tersedia
            juga menghasilkan NO TRADE (bukan sinyal nebak).
          </li>
          <li>
            <span className="text-slate-200">Tiket</span> — Entry/SL/TP1/TP2/lot dihitung dari harga riil per instrumen,
            bukan asumsi.
          </li>
        </ol>
        <p className="text-[11px] text-slate-500">
          Selama belum ada rilis hari ini, papan menampilkan <span className="text-purple-300">contoh otomatis</span>:
          event MEDIUM+ terdekat dianggap baru rilis dengan Actual = Forecast + 1.5σ agar terlihat bentuk sinyal penuh.
          Begitu angka Actual sungguhan masuk dari feed kalender, mode contoh dimatikan sendiri dan yang tampil adalah
          sinyal riil.
        </p>
      </div>
    </div>
  );
};
