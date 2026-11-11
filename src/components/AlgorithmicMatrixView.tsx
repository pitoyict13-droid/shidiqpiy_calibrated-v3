import React from 'react';
import { 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  FileCode2, 
  TrendingUp, 
  ShieldCheck, 
  Clock, 
  BarChart3,
  Layers
} from 'lucide-react';

export const AlgorithmicMatrixView: React.FC = () => {
  const indicatorTable = [
    {
      name: 'Non-Farm Employment Change (NFP)',
      currency: 'USD',
      stdUnit: '30k jobs',
      highThreshold: '±60k jobs',
      volatility: '75 - 140 pips',
      spreadBuffer: '4.5 pips',
      executionWindow: 'T+90s to T+300s',
      notes: 'Wajib cross-check dengan Average Hourly Earnings (AHE). Deviasi berlawanan = whipsaw.'
    },
    {
      name: 'Core CPI (MoM & YoY)',
      currency: 'USD',
      stdUnit: '0.1%',
      highThreshold: '±0.2%',
      volatility: '50 - 95 pips',
      spreadBuffer: '2.8 pips',
      executionWindow: 'T+60s to T+180s',
      notes: 'Deviasi 0.2% secara historis memicu tren 1 arah pada DXY dan XAUUSD.'
    },
    {
      name: 'Fed Interest Rate Decision (FOMC)',
      currency: 'USD',
      stdUnit: '25 bps',
      highThreshold: '±25 bps',
      volatility: '90 - 180 pips',
      spreadBuffer: '5.0 pips',
      executionWindow: 'T+120s / Presser T+30m',
      notes: 'Fokus pasar terbagi dua: rilis angka suku bunga dan konferensi pers Ketua The Fed.'
    },
    {
      name: 'ECB Refinancing Rate',
      currency: 'EUR',
      stdUnit: '15 bps',
      highThreshold: '±25 bps',
      volatility: '65 - 120 pips',
      spreadBuffer: '3.0 pips',
      executionWindow: 'T+60s & Presser T+45m',
      notes: 'Perhatikan forward guidance Christine Lagarde untuk konfirmasi kelanjutan tren.'
    },
    {
      name: 'UK CPI (YoY)',
      currency: 'GBP',
      stdUnit: '0.2%',
      highThreshold: '±0.3%',
      volatility: '60 - 110 pips',
      spreadBuffer: '3.5 pips',
      executionWindow: 'T+30s to T+120s',
      notes: 'Sensitivitas tinggi pada pair GBP/USD dan GBP/JPY.'
    },
    {
      name: 'Retail Sales (MoM)',
      currency: 'USD',
      stdUnit: '0.2%',
      highThreshold: '±0.3%',
      volatility: '45 - 80 pips',
      spreadBuffer: '2.2 pips',
      executionWindow: 'T+30s to T+120s',
      notes: 'Barometer utama konsumsi domestik AS yang menyumbang 70% PDB.'
    },
    {
      name: 'ISM Manufacturing / Services PMI',
      currency: 'USD',
      stdUnit: '1.0 pts',
      highThreshold: '±1.5 pts',
      volatility: '50 - 85 pips',
      spreadBuffer: '2.5 pips',
      executionWindow: 'T+45s to T+180s',
      notes: 'Ambang batas 50.0 membedakan ekspansi vs kontraksi ekonomi.'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-white tracking-tight">
            Kalibrasi Parameter Logika Algoritmik & Formula Validasi
          </h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
          Sistem menggunakan model kuantitatif berbasis <strong>Standardized Surprise Score (Z-Score)</strong> yang dinormalisasikan dengan unit volatilitas historis per indikator. Hal ini memastikan sinyal trading tidak bias oleh skala absolut (misal: membedakan deviasi 0.1% pada CPI dengan 30k pada NFP).
        </p>
      </div>

      {/* Mathematical Logic Equations */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[11px] font-mono uppercase text-cyan-400 font-semibold block">
            01. Raw & Normalized Deviation
          </span>
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-200 space-y-1">
            <div>Δ_raw = Actual - Forecast</div>
            <div className="text-cyan-300">Z = (polarity × Δ_raw × scale) / σ_unit</div>
            <div className="text-slate-500">scale = 100 bila unit "%" & σ ≥ 1 (bps)</div>
          </div>
          <p className="text-[11px] text-slate-400">
            Indikator invers (Unemployment Rate, Jobless Claims) otomatis membalik polaritas. Skala σ disamakan ke satuan data, sehingga keputusan suku bunga (selisih 0.25% vs σ 25 bps) tetap menghasilkan z = 1.0, bukan ~0.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[11px] font-mono uppercase text-emerald-400 font-semibold block">
            02. Ambang Dari Parameter Event
          </span>
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs space-y-1">
            <div className="text-emerald-400">z_kuat = max(1.6, highThreshold / σ)</div>
            <div className="text-cyan-300">z_mod = max(0.5, moderateThreshold / σ)</div>
            <div className="text-slate-400">MEDIUM: +0.2σ · LOW: sinyal diblokir</div>
          </div>
          <p className="text-[11px] text-slate-400">
            Ambang diambil dari <span className="font-mono">highImpactThreshold</span> &amp; <span className="font-mono">moderateThreshold</span> milik event — bukan angka hardcode — dengan lantai konservatif agar event berparameter longgar tetap tersaring.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[11px] font-mono uppercase text-amber-400 font-semibold block">
            03. Fase Pra &amp; Pasca Rilis
          </span>
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs space-y-1">
            <div className="text-cyan-400">PRA-RILIS / SENTIMEN → 1 Harga BUY/SELL + SL/TP</div>
            <div className="text-slate-400">T+0s .. T+60s → SPREADING (Tunggu Candle M1)</div>
            <div className="text-emerald-400">T+1m .. invalidation → ACTIVE (Optimal FVG Entry)</div>
            <div className="text-rose-400">&gt; invalidationTimeMinutes → EXPIRED</div>
          </div>
          <p className="text-[11px] text-slate-400">
            Pra-rilis menghasilkan tiket 1 harga (BUY/SELL, Entry, SL, TP) saat bias Forecast vs Previous atau sentimen pasar jelas; Straddle OCO hanya dipakai bila keduanya netral. Pasca-rilis membuka jendela aktif T+60s hingga 45–60 menit setelah rilis untuk impact ≥ MEDIUM.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[11px] font-mono uppercase text-rose-400 font-semibold block">
            04. Dynamic Stop Loss & Sizing
          </span>
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-200 space-y-1">
            <div className="text-rose-400">SL = clamp(Exp×0.4 + max(buffer, 1.5×spread), min_kelas, Exp×0.9)</div>
            <div className="text-emerald-400">Lot = Risk_$ / (SL_pips × nilai_pip_instrumen)</div>
            <div className="text-slate-500">TP1 = 1.5R · TP2 = 2.8R</div>
          </div>
          <p className="text-[11px] text-slate-400">
            Nilai pip dihitung per instrumen (EURUSD $10, USDJPY ≈ $6.3, emas $10/0.1, index &amp; kripto $1/pt) dengan kurs USD dari harga tengah — bukan asumsi $10/pip untuk semua pair. Minimum SL per kelas aset mencegah SL terlalu sempit.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[11px] font-mono uppercase text-violet-400 font-semibold block">
            05. Arah Per Instrumen
          </span>
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs space-y-1">
            <div className="text-slate-200">FX: kaki base/quote menentukan arah</div>
            <div className="text-slate-400">Cross tanpa JPY → NONE (tidak ditebak)</div>
            <div className="text-cyan-300">Emas/Kripto: kekuatan USD (bobot DXY)</div>
            <div className="text-amber-300">Index: growth/risk-on vs tekanan rate</div>
          </div>
          <p className="text-[11px] text-slate-400">
            Hanya instrumen yang punya harga di <span className="font-mono">data/</span> yang boleh menghasilkan tiket; sisanya berstatus "tidak tersedia di data pasar".
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <span className="text-[11px] font-mono uppercase text-cyan-400 font-semibold block">
            06. Reaksi Harga Mengalahkan Tebakan
          </span>
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs space-y-1">
            <div>settle = T+15m · horizon = T+45m</div>
            <div className="text-cyan-300">move% = (close_horizon - close_base) / close_base</div>
            <div className="text-slate-400">|move| &lt; 0.05% → dianggap datar</div>
          </div>
          <p className="text-[11px] text-slate-400">
            Bila reaksi bar 1-menit terukur berlawanan dengan arah fundamental, sinyal mengikuti harga (<span className="font-mono">via: price-reaction</span>) dan alasannya ditampilkan.
          </p>
        </div>
      </div>

      {/* Indicator Calibration Matrix Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">
              Tabel Parameter Indikator Terkalibrasi
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Sumber: preset indikator (src/utils/calendar.ts) · market yang tersedia di data/
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
              <tr>
                <th className="p-3.5">Indikator</th>
                <th className="p-3.5">Mata Uang</th>
                <th className="p-3.5">Unit Std Dev (σ)</th>
                <th className="p-3.5">Ambang Sinyal Kuat</th>
                <th className="p-3.5">Perkiraan Volatilitas</th>
                <th className="p-3.5">Buffer Spread</th>
                <th className="p-3.5">Window Eksekusi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-mono">
              {indicatorTable.map((item) => (
                <tr key={item.name} className="hover:bg-slate-850/50 transition-colors">
                  <td className="p-3.5 font-sans font-medium text-slate-200">
                    <div>{item.name}</div>
                    <div className="text-[10px] text-slate-400 font-normal mt-0.5">{item.notes}</div>
                  </td>
                  <td className="p-3.5 font-bold text-cyan-300">{item.currency}</td>
                  <td className="p-3.5 text-slate-300">{item.stdUnit}</td>
                  <td className="p-3.5 text-amber-300 font-semibold">{item.highThreshold}</td>
                  <td className="p-3.5 text-slate-200">{item.volatility}</td>
                  <td className="p-3.5 text-rose-300">{item.spreadBuffer}</td>
                  <td className="p-3.5 text-slate-400 font-sans text-[11px]">{item.executionWindow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Execution Best Practices & Anti-Slippage Rules */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Aturan Eksekusi Berita & Pencegahan Slippage (Institutional Rules)</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>1. Jangan Pasang Buy Stop / Sell Stop Terlalu Dekat (Straddle Trap)</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Order pending stop yang diletakkan 5-10 pips dari harga sebelum rilis sering tersenggol oleh pelebaran spread (spread expansion) di kedua arah (dual whipsaw), menyebabkan trader terkena stop loss ganda.
            </p>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>2. Masuk Pada Retest M1 / M3 (Fair Value Gap Strategy)</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Ketika deviasi fundamental jelas (|Z| melewati ambang kuat event), harga biasanya melompat cepat meninggalkan Fair Value Gap (FVG). Tunggu koreksi 30-50% dari candle jarum pertama untuk mendapatkan harga entry optimal dengan risiko jauh lebih kecil.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
