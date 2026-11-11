import React, { useState } from 'react';
import { EconomicEvent, CurrencyCode, ImpactLevel } from '../types/trading';
import { X, Plus, Calendar, Clock } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAddEvent: (event: EconomicEvent) => void;
}

export const AddEventModal: React.FC<Props> = ({ isOpen, onClose, onAddEvent }) => {
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [minutesFromNow, setMinutesFromNow] = useState<number>(30);
  const [impact, setImpact] = useState<ImpactLevel>('HIGH');
  const [forecast, setForecast] = useState<string>('0.3');
  const [previous, setPrevious] = useState<string>('0.2');
  const [unit, setUnit] = useState<string>('%');
  const [category, setCategory] = useState<EconomicEvent['category']>('INFLATION');
  const [affectedPairs, setAffectedPairs] = useState<string>('EURUSD, USDJPY, XAUUSD');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const scheduledDate = new Date(Date.now() + minutesFromNow * 60 * 1000);
    const parsedPairs = affectedPairs.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

    const newEvent: EconomicEvent = {
      id: `custom-${Date.now()}`,
      title: title.trim(),
      currency,
      scheduledTime: scheduledDate.toISOString(),
      status: 'UPCOMING',
      impact,
      forecast: forecast ? parseFloat(forecast) : null,
      previous: previous ? parseFloat(previous) : null,
      actual: null,
      unit,
      category,
      affectedPairs: parsedPairs.length > 0 ? parsedPairs : ['EURUSD', 'USDJPY'],
      calibration: {
        indicatorType: title.trim(),
        standardDeviationUnit: unit === '%' ? 0.1 : unit === 'k' ? 25 : 1.0,
        highImpactThreshold: unit === '%' ? 0.2 : unit === 'k' ? 50 : 2.0,
        moderateThreshold: unit === '%' ? 0.1 : unit === 'k' ? 25 : 1.0,
        unit,
        expectedVolatilityPips: {
          low: impact === 'HIGH' ? 30 : 15,
          moderate: impact === 'HIGH' ? 60 : 30,
          extreme: impact === 'HIGH' ? 110 : 55
        },
        liquiditySpreadBufferPips: impact === 'HIGH' ? 3.5 : 1.5,
        optimalExecutionWindow: 'T+45s to T+180s',
        invalidationTimeMinutes: 45
      },
      preNewsScenarios: [
        {
          scenario: 'BULLISH',
          condition: `Actual > ${forecast}${unit}`,
          minDeviation: unit === '%' ? 0.1 : 1.0,
          expectedDirection: `${currency} Bullish Surprise`,
          expectedPips: impact === 'HIGH' ? '+40 to +75 pips' : '+20 to +35 pips',
          primaryPairs: [{ pair: parsedPairs[0] || 'EURUSD', action: 'BUY', targetPips: 45, stopLossPips: 18 }],
          orderFlowPlaybook: 'Enter on 1-min wick pullback into Fair Value Gap.'
        },
        {
          scenario: 'NEUTRAL',
          condition: `Actual == ${forecast}${unit}`,
          minDeviation: 0,
          expectedDirection: 'Inline / Chop / Fakeout',
          expectedPips: '10-20 pips noise',
          primaryPairs: [{ pair: parsedPairs[0] || 'EURUSD', action: 'SELL', targetPips: 15, stopLossPips: 12 }],
          orderFlowPlaybook: 'Avoid instant breakout orders; watch range limits.'
        },
        {
          scenario: 'BEARISH',
          condition: `Actual < ${forecast}${unit}`,
          minDeviation: unit === '%' ? -0.1 : -1.0,
          expectedDirection: `${currency} Bearish Pressure`,
          expectedPips: impact === 'HIGH' ? '-40 to -75 pips' : '-20 to -35 pips',
          primaryPairs: [{ pair: parsedPairs[0] || 'EURUSD', action: 'SELL', targetPips: 45, stopLossPips: 18 }],
          orderFlowPlaybook: 'Momentum sell on breakdown below pre-news support.'
        }
      ]
    };

    onAddEvent(newEvent);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-cyan-400" />
            <h3 className="text-base font-bold text-white">
              Tambah Jadwal Berita Ekonomi (Upcoming)
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Nama Indikator / Berita:</label>
            <input
              type="text"
              required
              placeholder="e.g. Core PPI MoM, ISM Services PMI, Retail Sales"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Mata Uang:</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-cyan-300 font-mono"
              >
                {['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Impact Level:</label>
              <select
                value={impact}
                onChange={(e) => setImpact(e.target.value as ImpactLevel)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
              >
                <option value="HIGH">HIGH (Merah)</option>
                <option value="MEDIUM">MEDIUM (Oranye)</option>
                <option value="LOW">LOW (Kuning)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Forecast:</label>
              <input
                type="number"
                step="any"
                value={forecast}
                onChange={(e) => setForecast(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Previous:</label>
              <input
                type="number"
                step="any"
                value={previous}
                onChange={(e) => setPrevious(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Satuan Unit:</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="%, k, pts, B"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Kategori:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value="INFLATION">INFLATION</option>
                <option value="LABOR">LABOR</option>
                <option value="CENTRAL_BANK">CENTRAL_BANK</option>
                <option value="GROWTH">GROWTH / GDP</option>
                <option value="CONSUMER">CONSUMER</option>
                <option value="MANUFACTURING">MANUFACTURING</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Jadwal Rilis (Menit dari sekarang):</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={minutesFromNow}
                  onChange={(e) => setMinutesFromNow(parseInt(e.target.value) || 10)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-cyan-300"
                />
                <span className="text-slate-400 font-mono text-xs">menit</span>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Pasangan Mata Uang Terdampak (koma):</label>
            <input
              type="text"
              value={affectedPairs}
              onChange={(e) => setAffectedPairs(e.target.value)}
              placeholder="EURUSD, USDJPY, XAUUSD"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors"
            >
              Simpan ke Kalender
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
