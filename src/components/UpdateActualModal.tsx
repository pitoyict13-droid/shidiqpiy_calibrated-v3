import React, { useState } from 'react';
import { EconomicEvent } from '../types/trading';
import { X, Zap, TrendingUp, TrendingDown, Gauge } from 'lucide-react';

interface Props {
  event: EconomicEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmitActual: (eventId: string, actualValue: number) => void;
}

export const UpdateActualModal: React.FC<Props> = ({
  event,
  isOpen,
  onClose,
  onSubmitActual
}) => {
  if (!isOpen || !event) return null;

  const [actualVal, setActualVal] = useState<number>(
    event.actual !== null 
      ? event.actual 
      : Number(((event.forecast ?? 0) + event.calibration.standardDeviationUnit * 1.5).toFixed(2))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitActual(event.id, actualVal);
    onClose();
  };

  const f = event.forecast ?? 0;
  const std = event.calibration.standardDeviationUnit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <h3 className="text-base font-bold text-white">
              Simulasi / Input Data Aktual Rilis
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-bold border border-slate-700">
              {event.currency}
            </span>
            <span className="font-bold text-slate-100 text-sm">{event.title}</span>
          </div>
          <p className="text-xs text-slate-400">
            Forecast: <strong className="text-slate-200">{event.forecast}{event.unit}</strong> · Previous: <strong className="text-slate-200">{event.previous}{event.unit}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold">
              Masukkan Angka Aktual (Actual Print):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="any"
                required
                value={actualVal}
                onChange={(e) => setActualVal(parseFloat(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 rounded-lg px-3 py-2 text-base font-mono font-bold text-cyan-300 focus:outline-none"
              />
              <span className="text-xs font-mono text-slate-400 px-3 py-2 bg-slate-800 rounded border border-slate-700">
                {event.unit}
              </span>
            </div>
          </div>

          {/* Quick preset buttons */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">Preset Skenario Deviasi Cepat:</span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setActualVal(Number((f + std * 2).toFixed(2)))}
                className="p-2 rounded bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-left hover:bg-emerald-900/60 transition-colors"
              >
                <div className="font-bold flex items-center gap-1 font-mono text-[11px]">
                  <TrendingUp className="w-3 h-3" />
                  <span>+2σ Beat</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  {(f + std * 2).toFixed(1)}{event.unit}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActualVal(Number(f.toFixed(2)))}
                className="p-2 rounded bg-slate-800 border border-slate-700 text-slate-300 text-left hover:bg-slate-750 transition-colors"
              >
                <div className="font-bold flex items-center gap-1 font-mono text-[11px]">
                  <Gauge className="w-3 h-3" />
                  <span>Inline</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  {f.toFixed(1)}{event.unit}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActualVal(Number((f - std * 2).toFixed(2)))}
                className="p-2 rounded bg-rose-950/50 border border-rose-800 text-rose-300 text-left hover:bg-rose-900/60 transition-colors"
              >
                <div className="font-bold flex items-center gap-1 font-mono text-[11px]">
                  <TrendingDown className="w-3 h-3" />
                  <span>-2σ Miss</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  {(f - std * 2).toFixed(1)}{event.unit}
                </div>
              </button>
            </div>
          </div>

          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-slate-400 text-[11px] leading-relaxed">
            Menyimpan nilai aktual akan otomatis memicu kalibrasi model, menghasilkan sinyal eksekusi riil, dan memindahkan berita ke arsip pasca-news.
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-semibold rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors"
            >
              Rilis & Kalibrasikan Sekarang
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
