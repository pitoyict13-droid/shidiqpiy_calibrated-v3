import React, { useState } from 'react';
import { EconomicEvent, AIEventAnalysis } from '../types/trading';
import { 
  X, 
  Sparkles, 
  Copy, 
  Check, 
  ShieldAlert, 
  TrendingUp, 
  TrendingDown, 
  Compass, 
  AlertTriangle,
  Layers,
  ArrowRight
} from 'lucide-react';

interface Props {
  event: EconomicEvent | null;
  analysis: AIEventAnalysis | null;
  isLoading: boolean;
  onClose: () => void;
  onSelectForCalibration: (event: EconomicEvent) => void;
}

export const AIAnalysisModal: React.FC<Props> = ({
  event,
  analysis,
  isLoading,
  onClose,
  onSelectForCalibration
}) => {
  const [copied, setCopied] = useState(false);

  if (!event) return null;

  const handleCopy = () => {
    if (!analysis) return;
    const text = `=== AI INSTITUTIONAL TRADING PLAYBOOK ===
Event: [${event.currency}] ${event.title}
Status: ${event.status} | Scheduled: ${event.scheduledTime}
Forecast: ${event.forecast}${event.unit} | Previous: ${event.previous}${event.unit}

[MARKET CONTEXT]
${analysis.marketContext}

[PRE-NEWS POSITIONING]
${analysis.preNewsInstitutionalPositioning}

[3-SCENARIO GAMEPLAN]
1. BULLISH SCENARIO:
- Trigger: ${analysis.scenarioGameplan?.bullish?.triggerThreshold}
- Bias: ${analysis.scenarioGameplan?.bullish?.bias}
- Action: ${analysis.scenarioGameplan?.bullish?.tradeAction}
- Target: ${analysis.scenarioGameplan?.bullish?.targetPips}
- Risk: ${analysis.scenarioGameplan?.bullish?.riskRule}

2. INLINE / CHOP SCENARIO:
- Trigger: ${analysis.scenarioGameplan?.inline?.triggerThreshold}
- Bias: ${analysis.scenarioGameplan?.inline?.bias}
- Action: ${analysis.scenarioGameplan?.inline?.tradeAction}
- Risk: ${analysis.scenarioGameplan?.inline?.riskRule}

3. BEARISH SCENARIO:
- Trigger: ${analysis.scenarioGameplan?.bearish?.triggerThreshold}
- Bias: ${analysis.scenarioGameplan?.bearish?.bias}
- Action: ${analysis.scenarioGameplan?.bearish?.tradeAction}
- Target: ${analysis.scenarioGameplan?.bearish?.targetPips}
- Risk: ${analysis.scenarioGameplan?.bearish?.riskRule}

[CALIBRATED SUMMARY]
${analysis.calibratedRulesSummary}
`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
              <Sparkles className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-bold border border-slate-700">
                  {event.currency}
                </span>
                <h3 className="text-base font-bold text-white">
                  {event.title}
                </h3>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                AI Institutional Macro Engine (Gemini 3.8 Flash) · {event.status === 'UPCOMING' ? 'Pre-News Analysis' : 'Pasca-News Review'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {analysis && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy Plan'}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs text-slate-300">
          {isLoading ? (
            <div className="py-16 text-center space-y-4">
              <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-200 font-mono">
                  Mengalkulasi Analisa Makro & Skenario Pre-News...
                </div>
                <div className="text-xs text-slate-400">
                  Menganalisis probabilitas kejutan deviasi, likuiditas order book, dan kalibrasi risiko.
                </div>
              </div>
            </div>
          ) : analysis ? (
            <>
              {/* Macro Context */}
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg space-y-2">
                <span className="text-[11px] font-mono uppercase text-cyan-400 font-semibold block">
                  Konteks Makro & Sensitivitas Kebijakan Bank Sentral:
                </span>
                <p className="text-slate-200 leading-relaxed text-xs">
                  {analysis.marketContext}
                </p>
                <p className="text-slate-400 text-[11px] leading-relaxed pt-1 border-t border-slate-800/80">
                  {analysis.macroSignificance}
                </p>
              </div>

              {/* Pre-News Smart Money Positioning */}
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg space-y-2">
                <span className="text-[11px] font-mono uppercase text-amber-400 font-semibold block">
                  Posisi Smart Money & Cluster Pool Likuiditas:
                </span>
                <p className="text-slate-300 leading-relaxed text-xs">
                  {analysis.preNewsInstitutionalPositioning}
                </p>
              </div>

              {/* 3-Scenario Matrix */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono uppercase text-slate-300 font-bold block">
                  Rencana Tindakan 3-Skenario Terkalibrasi (Pre-News Gameplan):
                </span>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Bullish */}
                  <div className="p-3.5 bg-emerald-950/25 border border-emerald-800/60 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-emerald-400 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5" />
                        BULLISH BEAT
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-200 bg-slate-950 p-1.5 rounded border border-slate-800">
                      Trigger: {analysis.scenarioGameplan?.bullish?.triggerThreshold}
                    </div>
                    <div className="text-[11px] space-y-1">
                      <div className="text-cyan-300 font-semibold">
                        Aksi: {analysis.scenarioGameplan?.bullish?.tradeAction}
                      </div>
                      <div className="text-slate-300">
                        Target: {analysis.scenarioGameplan?.bullish?.targetPips}
                      </div>
                      <div className="text-slate-400 text-[10px] pt-1 border-t border-emerald-900/40">
                        Risk Rule: {analysis.scenarioGameplan?.bullish?.riskRule}
                      </div>
                    </div>
                  </div>

                  {/* Inline */}
                  <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-300 flex items-center gap-1">
                        <Compass className="w-3.5 h-3.5" />
                        INLINE / CHOP
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-300 bg-slate-900 p-1.5 rounded border border-slate-800">
                      Trigger: {analysis.scenarioGameplan?.inline?.triggerThreshold}
                    </div>
                    <div className="text-[11px] space-y-1">
                      <div className="text-amber-300 font-semibold">
                        Aksi: {analysis.scenarioGameplan?.inline?.tradeAction}
                      </div>
                      <div className="text-slate-300">
                        Target: {analysis.scenarioGameplan?.inline?.targetPips}
                      </div>
                      <div className="text-slate-400 text-[10px] pt-1 border-t border-slate-800">
                        Risk Rule: {analysis.scenarioGameplan?.inline?.riskRule}
                      </div>
                    </div>
                  </div>

                  {/* Bearish */}
                  <div className="p-3.5 bg-rose-950/25 border border-rose-800/60 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-rose-400 flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5" />
                        BEARISH MISS
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-200 bg-slate-950 p-1.5 rounded border border-slate-800">
                      Trigger: {analysis.scenarioGameplan?.bearish?.triggerThreshold}
                    </div>
                    <div className="text-[11px] space-y-1">
                      <div className="text-cyan-300 font-semibold">
                        Aksi: {analysis.scenarioGameplan?.bearish?.tradeAction}
                      </div>
                      <div className="text-slate-300">
                        Target: {analysis.scenarioGameplan?.bearish?.targetPips}
                      </div>
                      <div className="text-slate-400 text-[10px] pt-1 border-t border-rose-900/40">
                        Risk Rule: {analysis.scenarioGameplan?.bearish?.riskRule}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pair Tactics Table */}
              {analysis.keyPairsTactics && analysis.keyPairsTactics.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-mono uppercase text-slate-300 font-bold block">
                    Taktik Eksekusi Spesifik Pasangan Mata Uang:
                  </span>
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden bg-slate-950/60">
                    {analysis.keyPairsTactics.map((item) => (
                      <div key={item.pair} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="font-mono font-bold text-cyan-300 min-w-[120px]">
                          {item.pair}
                        </div>
                        <div className="flex-1 text-slate-300 text-[11px]">
                          <strong className="text-slate-200">Taktik:</strong> {item.entryTactic}
                        </div>
                        <div className="text-rose-400 text-[10px] font-mono shrink-0">
                          Invalidasi: {item.invalidation}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Liquidity Warnings */}
              {analysis.liquidityWarnings && (
                <div className="p-3.5 bg-amber-950/20 border border-amber-900/40 rounded-lg space-y-1.5 text-xs">
                  <div className="font-semibold text-amber-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Peringatan Likuiditas & Protokol Eksekusi:</span>
                  </div>
                  <ul className="list-disc list-inside text-slate-300 text-[11px] space-y-0.5">
                    {analysis.liquidityWarnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Calibrated Rules Summary */}
              <div className="p-3 bg-cyan-950/25 border border-cyan-800/40 rounded-lg font-mono text-[11px] text-cyan-300 flex items-center justify-between">
                <div>
                  <span className="text-slate-400 uppercase mr-2">Formula Kalibrasi:</span>
                  <span>{analysis.calibratedRulesSummary}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs">
              Gagal memuat analisa. Silakan periksa koneksi atau coba kembali.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Tutup
          </button>

          <button
            onClick={() => {
              onClose();
              onSelectForCalibration(event);
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors"
          >
            <span>Buka di Parameter Calibrator</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
