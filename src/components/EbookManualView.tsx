import React, { useState } from 'react';
import { 
  BookOpen, 
  Search, 
  Download, 
  Printer, 
  ChevronRight, 
  ChevronLeft, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Cpu, 
  Target, 
  ShieldCheck, 
  Copy, 
  Check, 
  Sparkles,
  FileText
} from 'lucide-react';
import { FullPdfEbookModal } from './FullPdfEbookModal';
import { EBOOK_RAW_MARKDOWN } from '../data/ebookMarkdown';

const COVER_IMG = '/src/assets/images/ebook_cover_terminal_1794160033910.jpg';
const ORDERFLOW_IMG = '/src/assets/images/ebook_orderflow_execution_1794160034634.jpg';
const MACRO_IMG = '/src/assets/images/ebook_macro_central_bank_1794160034938.jpg';
const RISK_IMG = '/src/assets/images/ebook_risk_management_matrix_1794160035048.jpg';

interface Chapter {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
}

const CHAPTERS: Chapter[] = [
  { id: 'bab1', title: 'BAB 1: Pendahuluan & Filosofi', subtitle: 'Filosofi kuantitatif & masalah fundamental klasik', icon: '01' },
  { id: 'bab2', title: 'BAB 2: Kalender & Hirarki Dampak', subtitle: 'Klasifikasi Grade A/B/C dan sistem alarm audio', icon: '02' },
  { id: 'bab3', title: 'BAB 3: Otomatisasi Pre-News', subtitle: 'Matriks 3-skenario terstandarisasi sebelum rilis', icon: '03' },
  { id: 'bab4', title: 'BAB 4: Matematika Deviasi (Z-Score)', subtitle: 'Formula normalisasi kejutan & unit indikator', icon: '04' },
  { id: 'bab5', title: 'BAB 5: Protokol Order Flow & Timing', subtitle: 'Window FVG M1/M3 dan pencegahan spread trap', icon: '05' },
  { id: 'bab6', title: 'BAB 6: Manajemen Risiko & Lot Size', subtitle: 'Kalkulator ukuran posisi dan dynamic Stop Loss', icon: '06' },
  { id: 'bab7', title: 'BAB 7: Workflow Harian Trader', subtitle: 'Checklist langkah demi langkah sebelum & sesudah rilis', icon: '07' },
  { id: 'bab8', title: 'BAB 8: Tiga Studi Kasus Riil', subtitle: 'Bedah kasus nyata NFP, Core CPI, dan Fed Rate', icon: '08' },
  { id: 'bab9', title: 'BAB 9: FAQ & Tanya Jawab', subtitle: 'Solusi broker spread, slippage, dan akun kecil', icon: '09' }
];

export const EbookManualView: React.FC = () => {
  const [activeChapterId, setActiveChapterId] = useState<string>('bab1');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState<boolean>(false);

  const activeIndex = CHAPTERS.findIndex((c) => c.id === activeChapterId);
  const currentChapter = CHAPTERS[activeIndex] || CHAPTERS[0];

  const handleNext = () => {
    if (activeIndex < CHAPTERS.length - 1) {
      setActiveChapterId(CHAPTERS[activeIndex + 1].id);
      window.scrollTo({ top: 120, behavior: 'smooth' });
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setActiveChapterId(CHAPTERS[activeIndex - 1].id);
      window.scrollTo({ top: 120, behavior: 'smooth' });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadMd = () => {
    try {
      const blob = new Blob([EBOOK_RAW_MARKDOWN], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'EBOOK_PANDUAN_MANUAL_AI_TRADING.md';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      window.open('/EBOOK_PANDUAN_MANUAL.md', '_blank');
    }
  };

  const filteredChapters = CHAPTERS.filter(
    (c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.subtitle.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Banner & Action Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                Ebook Panduan Manual: AI Terminal Trading v2.4
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Buku panduan institusional lengkap: kalibrasi dampak deviasi berita, matriks pre-news, dan manajemen risiko presisi.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={() => setIsPdfModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-sm ring-2 ring-emerald-400/40"
              title="Buka seluruh 9 Bab dalam satu tampilan cetak PDF dengan gambar dan ilustrasi"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>📄 Buka Versi Dokumen PDF Lengkap</span>
            </button>

            <button
              onClick={handleDownloadMd}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/50 transition-colors shadow-sm"
              title="Unduh file format Markdown (.md) lengkap untuk dibaca di Obsidian, VS Code, atau editor Markdown"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>⬇️ Download Markdown (.md)</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors shadow-sm"
              title="Cetak langsung atau simpan halaman sebagai PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>🖨️ Cetak / Simpan PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Sidebar Table of Contents & Chapter Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Chapters Navigation */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 sticky top-20">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Cari topik / bab..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider font-semibold">
              Daftar Isi Ebook ({CHAPTERS.length} Bab):
            </span>

            <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
              {filteredChapters.map((ch) => {
                const isActive = ch.id === activeChapterId;
                return (
                  <button
                    key={ch.id}
                    onClick={() => setActiveChapterId(ch.id)}
                    className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex items-start gap-3 ${
                      isActive
                        ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 font-semibold shadow-sm'
                        : 'bg-slate-950/40 border border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 mt-0.5 ${
                      isActive ? 'bg-cyan-400 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {ch.icon}
                    </span>
                    <div className="space-y-0.5 min-w-0">
                      <div className="truncate font-medium">{ch.title}</div>
                      <div className="text-[10px] text-slate-400 truncate">{ch.subtitle}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Chapter Content Reader */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-6 text-slate-300 leading-relaxed text-sm">
            {/* Chapter Header */}
            <div className="border-b border-slate-800 pb-5 space-y-2">
              <div className="flex items-center gap-2 font-mono text-xs text-cyan-400 font-bold uppercase tracking-wider">
                <span>PANDUAN MANUAL INSTITUSIONAL</span>
                <span>·</span>
                <span>{currentChapter.title.split(':')[0]}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                {currentChapter.title}
              </h1>
              <p className="text-xs text-slate-400">
                {currentChapter.subtitle}
              </p>
            </div>

            {/* Chapter 1 */}
            {activeChapterId === 'bab1' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
                  <h4 className="font-bold text-white text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-cyan-400" />
                    <span>Filosofi & Latar Belakang Sistem</span>
                  </h4>
                  <p className="text-slate-300 leading-relaxed">
                    AI Terminal Trading dirancang khusus untuk mengatasi masalah fatal yang dialami oleh lebih dari 90% trader retail saat rilis berita ekonomi <em>high-impact</em>. Mayoritas trader retail mengalami kerugian bukan karena arah fundamental salah, melainkan karena <strong>kesalahan timing eksekusi</strong>, <strong>keterlambatan analisis</strong>, dan <strong>terperangkap pelebaran spread broker</strong>.
                  </p>
                </div>
                <div className="rounded-xl overflow-hidden border border-slate-800 shadow-md my-3">
                  <img
                    src={COVER_IMG}
                    alt="Cover Ebook AI Terminal Trading"
                    className="w-full h-56 sm:h-72 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="p-2 bg-slate-950 text-[11px] font-mono text-slate-400 text-center">
                    Gambar 1.1: Edisi Resmi Ebook AI Terminal Trading — Kalibrasi Dampak Berita & Parameter Presisi.
                  </div>
                </div>

                <h3 className="text-base font-bold text-white pt-2">Tiga Masalah Klasik Trading Berita:</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3.5 bg-rose-950/20 border border-rose-800/40 rounded-lg space-y-1 text-xs">
                    <div className="font-bold text-rose-400 font-mono">01. Mengejar Jarum (Chasing Spikes)</div>
                    <p className="text-slate-400 text-[11px]">
                      Membuka order di pucuk candle menit pertama saat spread sedang melebar hingga 5-10 pips, menghasilkan slippage tinggi.
                    </p>
                  </div>

                  <div className="p-3.5 bg-amber-950/20 border border-amber-800/40 rounded-lg space-y-1 text-xs">
                    <div className="font-bold text-amber-400 font-mono">02. Jebakan Straddle (Pending Order)</div>
                    <p className="text-slate-400 text-[11px]">
                      Memasang Buy Stop dan Sell Stop terlalu dekat. Pelebaran spread menyapu kedua posisi dan menghasilkan Stop Loss ganda.
                    </p>
                  </div>

                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1 text-xs">
                    <div className="font-bold text-slate-300 font-mono">03. Analisa Pasca Rilis Terlambat</div>
                    <p className="text-slate-400 text-[11px]">
                      Baru mulai menghitung deviasi setelah pasar bergerak 50 pips dan memasuki fase kelelahan tren (*exhaustion*).
                    </p>
                  </div>
                </div>

                <h3 className="text-base font-bold text-white pt-2">Solusi Kuantitatif Terminal Kami:</h3>
                <p>
                  Platform ini memisahkan analisis menjadi dua fase: <strong>Pre-News Automated Anticipation</strong> (persiapan matriks sebelum data keluar) dan <strong>Post-News Mathematical Calibration</strong> (penghitungan deviasi Z-Score seketika pasca rilis).
                </p>
              </div>
            )}

            {/* Chapter 2 */}
            {activeChapterId === 'bab2' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <p>
                  Setiap peristiwa ekonomi memiliki bobot volatilitas yang berbeda terhadap pasar uang dan komoditas. Kalender ekonomi terminal ini mengelompokkan berita ke dalam tiga tingkatan dampak:
                </p>

                <div className="rounded-xl overflow-hidden border border-slate-800 shadow-md my-2">
                  <img
                    src={MACRO_IMG}
                    alt="Trading Desk Makroekonomi Bank Sentral"
                    className="w-full h-56 sm:h-64 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="p-2 bg-slate-950 text-[11px] font-mono text-slate-400 text-center">
                    Gambar 2.1: Meja Perdagangan Makro Institusional — Memantau Keputusan Suku Bunga Global (The Fed, ECB, BoE, BoJ).
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border border-slate-800 rounded-lg overflow-hidden font-mono">
                    <thead className="bg-slate-950 text-slate-300 border-b border-slate-800">
                      <tr>
                        <th className="p-3">Tingkat Dampak</th>
                        <th className="p-3">Ekspektasi Volatilitas</th>
                        <th className="p-3">Contoh Rilis</th>
                        <th className="p-3">Karakteristik Likuiditas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-950/60">
                      <tr>
                        <td className="p-3 text-rose-400 font-bold">HIGH (Merah)</td>
                        <td className="p-3 text-cyan-300">50 - 150+ pips</td>
                        <td className="p-3 text-slate-200">NFP, Core CPI, Fed Rate, ECB Rate</td>
                        <td className="p-3 text-slate-400 font-sans text-[11px]">Slippage tinggi pada detik 0-15s, pergerakan tren berkelanjutan.</td>
                      </tr>
                      <tr>
                        <td className="p-3 text-amber-400 font-bold">MEDIUM (Oranye)</td>
                        <td className="p-3 text-amber-300">25 - 50 pips</td>
                        <td className="p-3 text-slate-200">Retail Sales, ISM PMI, Jobless Claims</td>
                        <td className="p-3 text-slate-400 font-sans text-[11px]">Volatilitas moderat, cocok untuk intraday scalping.</td>
                      </tr>
                      <tr>
                        <td className="p-3 text-slate-400 font-bold">LOW (Kuning)</td>
                        <td className="p-3 text-slate-400">&lt; 20 pips</td>
                        <td className="p-3 text-slate-200">Trade Balance, Wholesale Inventories</td>
                        <td className="p-3 text-slate-400 font-sans text-[11px]">Umumnya diabaikan oleh algoritma hedge fund.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="p-4 bg-slate-950 border border-cyan-800/40 rounded-xl space-y-2">
                  <h4 className="font-bold text-cyan-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    <span>Fitur Alarm Hitung Mundur Audio (Web Audio API)</span>
                  </h4>
                  <p className="text-xs text-slate-300">
                    Aktifkan tombol audio di pojok kanan atas terminal. Sistem akan membunyikan alarm otomatis:
                  </p>
                  <ul className="list-disc list-inside text-xs text-slate-400 space-y-1">
                    <li><strong>T-30 Detik</strong>: Gentle chime (587 Hz) untuk menutup posisi spekulatif dan membatalkan order liar.</li>
                    <li><strong>T-5 Detik</strong>: Urgent warning (880 Hz) untuk fokus penuh membaca angka rilis.</li>
                    <li><strong>T-0 Detik</strong>: Release chime yang menandai data telah keluar dan kalkulator deviasi mulai aktif.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Chapter 3 */}
            {activeChapterId === 'bab3' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <p>
                  Sebelum data ekonomi keluar, terminal secara otomatis menyusun <strong>Matriks 3-Skenario</strong> terukur:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-emerald-950/20 border border-emerald-800/60 rounded-xl space-y-2">
                    <span className="font-mono font-bold text-emerald-400 text-xs block">
                      01. BULLISH SURPRISE
                    </span>
                    <p className="text-xs text-slate-300">
                      Jika rilis aktual melampaui forecast sebesar ambang deviasi minimal. Sinyal kuat untuk membeli mata uang basis.
                    </p>
                    <div className="text-[11px] font-mono text-cyan-300 pt-1 border-t border-emerald-900/40">
                      Taktik: Buy pullback M1 atau momentum breakout di atas level sesi.
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                    <span className="font-mono font-bold text-slate-300 text-xs block">
                      02. INLINE / CHOP FILTER
                    </span>
                    <p className="text-xs text-slate-400">
                      Jika angka rilis persis atau dekat dengan konsensus (|Z| &lt; 0.5σ). Resiko sangat tinggi terjadinya whipsaw atau pembantaian stop order dua sisi.
                    </p>
                    <div className="text-[11px] font-mono text-amber-300 pt-1 border-t border-slate-800">
                      Taktik: Stand aside / jangan entry pada breakout.
                    </div>
                  </div>

                  <div className="p-4 bg-rose-950/20 border border-rose-800/60 rounded-xl space-y-2">
                    <span className="font-mono font-bold text-rose-400 text-xs block">
                      03. BEARISH MISS
                    </span>
                    <p className="text-xs text-slate-300">
                      Jika angka aktual meleset jauh di bawah forecast. Sinyal kuat untuk menjual mata uang basis atau membeli aset lawan (misal Gold XAU/USD).
                    </p>
                    <div className="text-[11px] font-mono text-cyan-300 pt-1 border-t border-rose-900/40">
                      Taktik: Short mata uang basis menuju level demand harian.
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5 text-xs">
                  <h4 className="font-semibold text-slate-200">Bagaimana Cara Menggunakan di Terminal:</h4>
                  <p className="text-slate-400">
                    Buka tab <strong>Kalender & Pre-News</strong>, cari berita yang ingin dipantau, lalu klik tombol <strong>Pre-News Matrix</strong>. Anda akan melihat parameter angka trigger, target pips, rekomendasi pasangan mata uang, dan aturan invalidasi secara instan.
                  </p>
                </div>
              </div>
            )}

            {/* Chapter 4 */}
            {activeChapterId === 'bab4' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <p>
                  Untuk memastikan sinyal trading objektif dan tidak bias, sistem menggunakan model deviasi statistik terstandarisasi:
                </p>

                <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl font-mono space-y-3">
                  <div className="text-slate-400 text-xs">// Formula Matematika Deviasi Terstandarisasi</div>
                  <div className="text-lg text-cyan-300 font-bold">
                    Z = (Actual - Forecast) / σ_unit
                  </div>
                  <p className="text-xs text-slate-300 font-sans">
                    Di mana <strong>σ_unit</strong> adalah bobot standar deviasi historis per indikator ekonomi.
                  </p>
                </div>

                <h4 className="font-bold text-white text-sm">Ambang Batas Sinyal Kuantitatif:</h4>
                <ul className="space-y-2 text-xs">
                  <li className="flex items-start gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="font-mono font-bold text-emerald-400 shrink-0">|Z| ≥ 1.6σ</span>
                    <span className="text-slate-300">
                      <strong>STRONG IMPULSE</strong>: Deviasi sangat signifikan, mengatasi struktur teknikal manapun. Mengaktifkan strategi Momentum Breakout.
                    </span>
                  </li>
                  <li className="flex items-start gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="font-mono font-bold text-cyan-300 shrink-0">0.5σ ≤ |Z| &lt; 1.6σ</span>
                    <span className="text-slate-300">
                      <strong>MODERATE BIAS</strong>: Arah fundamental jelas, namun membutuhkan konfirmasi pullback pada timeframe M1/M3 sebelum masuk.
                    </span>
                  </li>
                  <li className="flex items-start gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="font-mono font-bold text-slate-400 shrink-0">|Z| &lt; 0.5σ</span>
                    <span className="text-slate-400">
                      <strong>INLINE CHOP FILTER</strong>: Angka terlalu dekat dengan konsensus. Sistem merekomendasikan NO TRADE demi melindungi modal akun.
                    </span>
                  </li>
                </ul>
              </div>
            )}

            {/* Chapter 5 */}
            {activeChapterId === 'bab5' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <h4 className="font-bold text-white text-sm">Protokol Waktu Masuk (The Execution Window)</h4>
                <p>
                  Jangan pernah menembak posisi pada 15 detik pertama! Perhatikan diagram waktu berikut:
                </p>

                <div className="rounded-xl overflow-hidden border border-slate-800 shadow-md my-2">
                  <img
                    src={ORDERFLOW_IMG}
                    alt="Diagram Eksekusi Fair Value Gap Retest"
                    className="w-full h-64 sm:h-72 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="p-2 bg-slate-950 text-[11px] font-mono text-slate-400 text-center">
                    Gambar 5.1: Skema Anatomi Order Flow — Candle Jarum Awal, Pembentukan FVG, dan Titik Entry Retest Ideal.
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3 font-mono text-xs">
                  <div className="flex justify-between items-center text-slate-400 pb-2 border-b border-slate-800">
                    <span>Detik Rilis: T-0s</span>
                    <span>T+15s</span>
                    <span>T+60s s/d T+180s</span>
                    <span>T+15m+</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-[11px]">
                    <div className="p-2.5 bg-rose-950/30 border border-rose-800/40 rounded">
                      <span className="text-rose-400 font-bold block mb-1">Fase 1: T-0s s/d T+15s</span>
                      Pelebaran spread ekstrem, likuiditas ditarik bank. <strong>DILARANG ENTRY</strong>.
                    </div>
                    <div className="p-2.5 bg-emerald-950/30 border border-emerald-800/40 rounded">
                      <span className="text-emerald-400 font-bold block mb-1">Fase 2: T+45s s/d T+180s</span>
                      Spread kembali normal. Koreksi Fair Value Gap 38.2%-50%. <strong>WINDOW ENTRY TERBAIK</strong>.
                    </div>
                    <div className="p-2.5 bg-cyan-950/30 border border-cyan-800/40 rounded">
                      <span className="text-cyan-400 font-bold block mb-1">Fase 3: T+15m ke atas</span>
                      Kelanjutan tren institusional. Pindahkan Stop Loss ke Breakeven.
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
                  <h4 className="font-semibold text-slate-200">Contoh Praktik FVG Retracement:</h4>
                  <p className="text-slate-300">
                    Saat CPI Amerika Serikat keluar hot (+0.4% vs +0.2%), USD/JPY melompat cepat 40 pips. Jangan beli di pucuk. Tunggu candle kedua atau ketiga turun menguji area 50% dari candle pertama. Masuk posisi Buy di area tersebut dengan Stop Loss diletakkan di bawah titik terendah candle jarum pertama.
                  </p>
                </div>
              </div>
            )}

            {/* Chapter 6 */}
            {activeChapterId === 'bab6' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <h4 className="font-bold text-white text-sm">Rumus Kalkulator Lot Presisi</h4>
                <p>
                  Sistem menghitung ukuran lot yang aman secara matematis berdasarkan saldo akun dan jarak Stop Loss yang dikalibrasi:
                </p>

                <div className="rounded-xl overflow-hidden border border-slate-800 shadow-md my-2">
                  <img
                    src={RISK_IMG}
                    alt="Matriks Manajemen Risiko Kuantitatif"
                    className="w-full h-64 sm:h-72 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="p-2 bg-slate-950 text-[11px] font-mono text-slate-400 text-center">
                    Gambar 6.1: Matriks Rasio Risiko-Hasil & Skala Penentuan Ukuran Posisi Otomatis.
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs space-y-2">
                  <div className="text-emerald-400 font-bold">
                    Risk_$ = Saldo_Akun * (Risk_% / 100)
                  </div>
                  <div className="text-cyan-300 font-bold">
                    Lot_Size = Risk_$ / (SL_pips * $10)
                  </div>
                </div>

                <h4 className="font-bold text-white text-sm">Contoh Nyata Perhitungan:</h4>
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-xs space-y-2 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Saldo Akun:</span>
                    <strong className="text-white">$10,000</strong>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Risiko Maksimal (1.0%):</span>
                    <strong className="text-emerald-400">$100.00</strong>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Jarak Stop Loss Dikalibrasi:</span>
                    <strong className="text-rose-400">22 Pips</strong>
                  </div>
                  <div className="flex justify-between text-slate-200 pt-2 border-t border-slate-800">
                    <span>Rekomendasi Lot Size:</span>
                    <strong className="text-cyan-300 text-sm">$100 / (22 * $10) = 0.45 Lots</strong>
                  </div>
                </div>

                <p className="text-xs text-slate-400">
                  Dengan metode ini, jika trade menyentuh Stop Loss, akun Anda hanya terpotong tepat $99.00 (tetap di bawah batas toleransi 1.0%), sehingga modal Anda terlindungi dari kerugian emosional.
                </p>
              </div>
            )}

            {/* Chapter 7 */}
            {activeChapterId === 'bab7' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <h4 className="font-bold text-white text-sm">Checklist Rutinitas Trading Harian</h4>
                <div className="space-y-3">
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-mono text-xs shrink-0 mt-0.5">1</span>
                    <div>
                      <strong className="text-white block">T-2 Jam: Cek Jadwal High Impact</strong>
                      <span className="text-slate-400 text-xs">Buka tab Kalender & Pre-News, periksa jam rilis berita merah dan baca skenario trigger-nya.</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-mono text-xs shrink-0 mt-0.5">2</span>
                    <div>
                      <strong className="text-white block">T-15 Menit: Siapkan Tiket di Live Calibrator</strong>
                      <span className="text-slate-400 text-xs">Masukkan saldo akun dan persentase risiko. Dapatkan rekomendasi lot size dan siapkan tiket di platform MT4/MT5.</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-mono text-xs shrink-0 mt-0.5">3</span>
                    <div>
                      <strong className="text-white block">T-0s s/d T+60s: Observasi dan Input Angka Aktual</strong>
                      <span className="text-slate-400 text-xs">Dengarkan alarm audio, masukkan angka rilis ke simulator, lihat sinyal apakah Strong Impulse atau Inline Chop.</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-mono text-xs shrink-0 mt-0.5">4</span>
                    <div>
                      <strong className="text-white block">T+60s s/d T+180s: Eksekusi Retest Fair Value Gap</strong>
                      <span className="text-slate-400 text-xs">Masuk pada retest 50% body candle lonjakan pertama dengan SL dan TP terkalibrasi.</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Chapter 8 */}
            {activeChapterId === 'bab8' && (
              <div className="space-y-5 text-xs sm:text-sm">
                <h4 className="font-bold text-white text-sm">Studi Kasus 1: US Non-Farm Payrolls (NFP) — Bullish Beat</h4>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 font-mono text-xs">
                  <div>Forecast: 165k | Actual: 230k | Deviasi: +65k (+2.17σ)</div>
                  <div className="text-emerald-400 font-bold">Sinyal: STRONG BUY USD</div>
                  <p className="text-slate-300 font-sans text-xs">
                    USD/JPY melonjak +82 pips, Gold XAU/USD jatuh -$32.00. Trader yang menunggu koreksi 50% candle pertama berhasil membeli USD/JPY dengan SL 25 pips dan mencapai TP2 (+70 pips).
                  </p>
                </div>

                <h4 className="font-bold text-white text-sm pt-2">Studi Kasus 2: UK CPI YoY — Inline Chop Trap</h4>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 font-mono text-xs">
                  <div>Forecast: 2.2% | Actual: 2.2% | Deviasi: 0.0% (0.0σ)</div>
                  <div className="text-amber-400 font-bold">Sinyal: NEUTRAL / NO TRADE INLINE</div>
                  <p className="text-slate-300 font-sans text-xs">
                    GBP/USD melonjak naik 14 pips lalu berbalik turun 22 pips dalam 45 detik. Trader retail yang memasang Buy Stop terseret slippage dan terkena Stop Loss. Pengguna terminal selamat karena sistem merekomendasikan NO TRADE.
                  </p>
                </div>
              </div>
            )}

            {/* Chapter 9 */}
            {activeChapterId === 'bab9' && (
              <div className="space-y-4 text-xs sm:text-sm">
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-white">Q: Mengapa spread broker saya sangat lebar saat rilis berita?</h4>
                  <p className="text-slate-400 text-xs">
                    A: Liquidity Provider bank menarik limit order mereka beberapa detik sebelum rilis untuk menghindari resiko volatilitas. Menipisnya order book menyebabkan selisih Bid-Ask melebar. Sistem kami otomatis menambahkan Spread Buffer pada Stop Loss untuk mengatasinya.
                  </p>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-white">Q: Apakah platform ini bisa digunakan untuk modal kecil ($50 - $200)?</h4>
                  <p className="text-slate-400 text-xs">
                    A: Tentu saja bisa. Gunakan kalkulator Lot Size di tab Live Calibrator dengan micro lot (0.01 lot) dan risiko 1%-2% per transaksi agar modal terlindungi.
                  </p>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-white">Q: Apa bedanya Pre-News dan Pasca-News di terminal?</h4>
                  <p className="text-slate-400 text-xs">
                    A: Pre-News adalah analisis antisipasi skenario sebelum data dirilis. Pasca-News adalah evaluasi angka riil data yang sudah keluar beserta pergerakan pips sesungguhnya untuk menguji akurasi model.
                  </p>
                </div>
              </div>
            )}

            {/* Chapter Navigation Footer */}
            <div className="pt-6 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={handlePrev}
                disabled={activeIndex === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Bab Sebelumnya</span>
              </button>

              <span className="text-xs font-mono text-slate-400">
                Bab {activeIndex + 1} dari {CHAPTERS.length}
              </span>

              <button
                onClick={handleNext}
                disabled={activeIndex === CHAPTERS.length - 1}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:opacity-40 transition-colors"
              >
                <span>Bab Selanjutnya</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Full Document PDF Printable Modal */}
      <FullPdfEbookModal
        isOpen={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
      />
    </div>
  );
};
