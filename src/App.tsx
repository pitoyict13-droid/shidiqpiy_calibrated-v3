import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { LiveTickerBar } from './components/LiveTickerBar';
import { PreNewsCalendar } from './components/PreNewsCalendar';
import { AutoSignalBoard } from './components/AutoSignalBoard';
import { PostNewsCalibrator } from './components/PostNewsCalibrator';
import { AlgorithmicMatrixView } from './components/AlgorithmicMatrixView';
import { PascaNewsArchive } from './components/PascaNewsArchive';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { AddEventModal } from './components/AddEventModal';
import { UpdateActualModal } from './components/UpdateActualModal';
import { EbookManualView } from './components/EbookManualView';
import { EconomicEvent, MarketPrice, AIEventAnalysis, PriceQuote, MinuteBar } from './types/trading';
import { INITIAL_ECONOMIC_EVENTS } from './data/economicEvents';
import { parseCalendarEvents, buildCalibrationFor, affectedPairsFor, buildPreNewsScenarios, pickEventSource } from './utils/calendar';
import { fetchMarketSnapshot, buildPriceMap, barsFromBundle, fetchLivePrices, describeSource, dataUrl } from './utils/marketData';
import { calculateCalibration } from './utils/calibrator';
import { playCountdownBeep, playReleaseChime } from './utils/audioAlert';

export default function App() {
  const [activeTab, setActiveTab] = useState<'auto' | 'calendar' | 'calibrator' | 'matrix' | 'archive' | 'ebook'>('auto');
  // Mulai kosong: jadwal diisi dari /api/events atau /data/calendar.json (riil).
  // Event contoh (INITIAL_ECONOMIC_EVENTS) TIDAK dipakai sebagai state awal karena
  // waktunya relatif terhadap jam load — NFP/FOMC jadi selalu "akan datang".
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [marketPrices, setMarketPrices] = useState<MarketPrice[]>([]);
  // Peta harga riil (snapshot data/*.json + live) & bar 1-menit untuk reaksi pasca-rilis
  const [priceMap, setPriceMap] = useState<Record<string, PriceQuote>>({});
  const [bars, setBars] = useState<Record<string, MinuteBar[]>>({});
  const [priceSource, setPriceSource] = useState<string>('memuat data pasar…');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [autoSync, setAutoSync] = useState<boolean>(true);
  const [audioAlertsEnabled, setAudioAlertsEnabled] = useState<boolean>(false);

  // Calibration state
  const [selectedCalibrationEvent, setSelectedCalibrationEvent] = useState<EconomicEvent | null>(null);

  // Modals state
  const [aiModalEvent, setAiModalEvent] = useState<EconomicEvent | null>(null);
  const [aiAnalysisData, setAiAnalysisData] = useState<AIEventAnalysis | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [actualModalEvent, setActualModalEvent] = useState<EconomicEvent | null>(null);

  // Notification badge toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const playedAlertsRef = useRef<Set<string>>(new Set());

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Fetch events from server (fallback: parse data/calendar.json langsung di browser)
  const fetchEvents = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch('/api/events');
      if (res.ok) {
        const data = await res.json();
        if (data.events && Array.isArray(data.events)) {
          setEvents(data.events);
          return;
        }
      }
      throw new Error('server events tidak tersedia');
    } catch (err) {
      // Fallback statis: kalender riil dari /data/calendar.json (situs yang sama,
      // tanpa CORS). Path absolut agar tetap benar saat dibuka dari /dist/index.html.
      try {
        const res = await fetch(dataUrl('calendar.json'), { cache: 'no-store' });
        if (res.ok) {
          const rows = await res.json();
          const parsed = parseCalendarEvents(rows, { maxAgeHours: 168 });
          if (parsed.length) {
            // Jadwal riil menang mutlak — event contoh tidak digabung, supaya
            // NFP/FOMC hardcode (waktunya selalu relatif) tidak mencemari daftar.
            setEvents(parsed);
            return;
          }
        }
      } catch (fallbackErr) {
        console.warn('Fallback kalender lokal gagal:', fallbackErr);
      }
      // Darurat: API & file kalender sama-sama tidak ada — pakai event contoh.
      console.warn('Kalender riil tidak tersedia, memakai event contoh:', err);
      setEvents((prev) => pickEventSource(prev, INITIAL_ECONOMIC_EVENTS));
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  };

  // Load snapshot data riil lalu timpa dengan harga live (browser)
  const loadMarketData = async () => {
    try {
      const bundle = await fetchMarketSnapshot();
      const snapshot = buildPriceMap(bundle);
      setBars(barsFromBundle(bundle));

      const live = await fetchLivePrices(snapshot);
      setPriceMap(live.prices);
      setPriceSource(live.live ? `${live.source} + snapshot` : `${describeSource(live.prices)}${live.live ? '' : ' (live tidak tersedia)'}`);

      const ticker = Object.values(live.prices).map((q) => ({
        symbol: q.symbol,
        bid: q.bid,
        ask: q.ask,
        change24h: Number.isFinite(q.changePct as number) ? (q.changePct as number) : 0,
        changePips: 0,
        high24h: q.ask,
        low24h: q.bid,
        spreadPips: q.spreadPips
      } as MarketPrice));
      setMarketPrices(ticker);
    } catch (err) {
      console.warn('Gagal memuat data pasar:', err);
      setPriceSource('data pasar tidak tersedia');
    }
  };

  // Initial load
  useEffect(() => {
    fetchEvents();
    loadMarketData();
  }, []);

  // Harga live polling (setiap 20 detik — TradingView/gold-api/Binance)
  useEffect(() => {
    const priceInterval = setInterval(() => {
      loadMarketData();
    }, 20000);
    return () => clearInterval(priceInterval);
  }, []);

  // Auto-sync events polling (every 15s if autoSync is ON)
  useEffect(() => {
    if (!autoSync) return;
    const syncInterval = setInterval(() => {
      fetchEvents(true);
    }, 15000);
    return () => clearInterval(syncInterval);
  }, [autoSync]);

  // Audio countdown alert checks
  useEffect(() => {
    if (!audioAlertsEnabled) return;

    const checkInterval = setInterval(() => {
      const now = Date.now();
      events.forEach((ev) => {
        if (ev.status !== 'UPCOMING') return;
        const diffSeconds = Math.floor((new Date(ev.scheduledTime).getTime() - now) / 1000);

        // 30 seconds alert
        const alert30Key = `${ev.id}-30s`;
        if (diffSeconds <= 30 && diffSeconds > 25 && !playedAlertsRef.current.has(alert30Key)) {
          playedAlertsRef.current.add(alert30Key);
          playCountdownBeep(false);
          showToast(`⚠️ [${ev.currency}] ${ev.title} rilis dalam 30 detik!`);
        }

        // 5 seconds urgent alert
        const alert5Key = `${ev.id}-5s`;
        if (diffSeconds <= 5 && diffSeconds > 0 && !playedAlertsRef.current.has(alert5Key)) {
          playedAlertsRef.current.add(alert5Key);
          playCountdownBeep(true);
        }

        // 0 seconds release chime
        const alert0Key = `${ev.id}-0s`;
        if (diffSeconds <= 0 && diffSeconds >= -3 && !playedAlertsRef.current.has(alert0Key)) {
          playedAlertsRef.current.add(alert0Key);
          playReleaseChime();
          showToast(`🔔 [${ev.currency}] ${ev.title} TELAH DIRILIS!`);
        }
      });
    }, 1000);

    return () => clearInterval(checkInterval);
  }, [audioAlertsEnabled, events]);

  // Handler for opening AI Analysis modal
  const handleOpenAIAnalysis = async (event: EconomicEvent) => {
    setAiModalEvent(event);
    setAiAnalysisData(null);
    setIsAiLoading(true);

    try {
      const res = await fetch('/api/analyze-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      });

      if (res.ok) {
        const data = await res.json();
        setAiAnalysisData(data);
      } else {
        throw new Error('Analysis fetch failed');
      }
    } catch (err: any) {
      console.warn('AI analysis error, loading fallback:', err);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Handler for adding new event
  const handleAddEvent = async (newEvent: EconomicEvent) => {
    try {
      const res = await fetch('/api/events/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent),
      });

      if (res.ok) {
        showToast(`Berita "${newEvent.title}" berhasil ditambahkan ke kalender!`);
        fetchEvents();
      } else {
        // Local fallback
        setEvents((prev) => [newEvent, ...prev]);
        showToast(`Berita "${newEvent.title}" ditambahkan ke sesi lokal.`);
      }
    } catch (err) {
      // Local fallback — parameter kalibrasi tetap dari preset indikator
      const patched: EconomicEvent = {
        ...newEvent,
        calibration: newEvent.calibration || buildCalibrationFor(newEvent.title, newEvent.unit || '', newEvent.forecast ?? null, newEvent.previous ?? null),
        affectedPairs: newEvent.affectedPairs?.length ? newEvent.affectedPairs : affectedPairsFor(newEvent.currency)
      };
      if (!patched.preNewsScenarios?.length) patched.preNewsScenarios = buildPreNewsScenarios(patched);
      setEvents((prev) => [patched, ...prev]);
      showToast(`Berita "${newEvent.title}" ditambahkan ke sesi lokal.`);
    }
  };

  // Handler for updating actual release
  const handleUpdateActual = async (eventId: string, actualValue: number) => {
    try {
      const res = await fetch('/api/events/update-actual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, actualValue }),
      });

      if (res.ok) {
        const data = await res.json();
        showToast(`Data aktual berhasil dicatat! Deviasi terkalibrasi: ${data.calibration?.rawDeviation >= 0 ? '+' : ''}${data.calibration?.rawDeviation}`);
        fetchEvents();
        if (data.event) {
          setSelectedCalibrationEvent(data.event);
        }
      } else {
        throw new Error('Update failed');
      }
    } catch (err) {
      // Local fallback update — memakai engine kalibrasi yang sama dengan server
      setEvents((prev) =>
        prev.map((e) => {
          if (e.id === eventId) {
            const releasedAt = e.releasedAt || new Date().toISOString();
            const updated: EconomicEvent = { ...e, actual: actualValue, status: 'RELEASED', releasedAt };
            const cal = calculateCalibration({ event: updated, actual: actualValue });
            return {
              ...updated,
              postNewsAnalysis: {
                actualDeviation: cal.rawDeviation,
                normalizedZScore: cal.normalizedZScore,
                bias: cal.bias,
                actualPipsMoved: cal.expectedPips,
                summary: `Actual ${actualValue}${e.unit} vs Forecast ${e.forecast}${e.unit}. Deviasi: ${Number.isFinite(cal.rawDeviation) ? (cal.rawDeviation >= 0 ? '+' : '') + cal.rawDeviation : '—'} (${Number.isFinite(cal.normalizedZScore) ? cal.normalizedZScore : '—'}σ). Bias: ${cal.bias}. Fase: ${cal.phase}${cal.tradable ? '' : ` — ${cal.gateReason}`}`,
                modelAccuracy: 'ACCURATE',
              },
            };
          }
          return e;
        })
      );
      showToast(`Data rilis aktual berhasil diperbarui.`);
    }
  };

  const handleSelectForCalibration = (event: EconomicEvent) => {
    setSelectedCalibrationEvent(event);
    setActiveTab('calibrator');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-cyan-500/60 shadow-xl px-4 py-2.5 rounded-lg text-xs font-mono text-cyan-300 flex items-center gap-2 animate-in slide-in-from-bottom-3 duration-200">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Bar Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onRefresh={() => fetchEvents(false)}
        isRefreshing={isRefreshing}
        audioAlertsEnabled={audioAlertsEnabled}
        setAudioAlertsEnabled={setAudioAlertsEnabled}
        autoSync={autoSync}
        setAutoSync={setAutoSync}
      />

      {/* Live Market Tickers */}
      <LiveTickerBar prices={marketPrices} isLoading={marketPrices.length === 0} />

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {activeTab === 'auto' && (
          <AutoSignalBoard
            events={events}
            prices={priceMap}
            bars={bars}
            priceSource={priceSource}
            onRefreshPrices={loadMarketData}
            onOpenEvent={handleSelectForCalibration}
          />
        )}

        {activeTab === 'calendar' && (
          <PreNewsCalendar
            events={events}
            onSelectForCalibration={handleSelectForCalibration}
            onOpenAIAnalysis={handleOpenAIAnalysis}
            onUpdateActualModal={(ev) => setActualModalEvent(ev)}
          />
        )}

        {activeTab === 'calibrator' && (
          <PostNewsCalibrator
            events={events}
            selectedEvent={selectedCalibrationEvent}
            onSelectEvent={setSelectedCalibrationEvent}
            onOpenAIAnalysis={handleOpenAIAnalysis}
            prices={priceMap}
            bars={bars}
            priceSource={priceSource}
            onRefreshPrices={loadMarketData}
          />
        )}

        {activeTab === 'matrix' && <AlgorithmicMatrixView />}

        {activeTab === 'archive' && (
          <PascaNewsArchive
            events={events}
            onSelectForCalibration={handleSelectForCalibration}
            onOpenAIAnalysis={handleOpenAIAnalysis}
          />
        )}

        {activeTab === 'ebook' && <EbookManualView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-4 text-center text-xs text-slate-400 font-mono">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>AI Trading Terminal · Institutional Economic News & Impact Deviation Engine</span>
          <span className="text-slate-400">
            Powered by Gemini 3.8 Flash & Standardized Surprise Calibration
          </span>
        </div>
      </footer>

      {/* AI Analysis Modal */}
      <AIAnalysisModal
        event={aiModalEvent}
        analysis={aiAnalysisData}
        isLoading={isAiLoading}
        onClose={() => setAiModalEvent(null)}
        onSelectForCalibration={handleSelectForCalibration}
      />

      {/* Add Event Modal */}
      <AddEventModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddEvent={handleAddEvent}
      />

      {/* Update Actual Release Modal */}
      <UpdateActualModal
        event={actualModalEvent}
        isOpen={!!actualModalEvent}
        onClose={() => setActualModalEvent(null)}
        onSubmitActual={handleUpdateActual}
      />
    </div>
  );
}
