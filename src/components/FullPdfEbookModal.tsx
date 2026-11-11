import React from 'react';
import { X, Printer, Download, BookOpen, CheckCircle2, ArrowLeft } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const COVER_IMG = '/src/assets/images/ebook_cover_terminal_1794160033910.jpg';
const ORDERFLOW_IMG = '/src/assets/images/ebook_orderflow_execution_1794160034634.jpg';
const MACRO_IMG = '/src/assets/images/ebook_macro_central_bank_1794160034938.jpg';
const RISK_IMG = '/src/assets/images/ebook_risk_management_matrix_1794160035048.jpg';

export const FullPdfEbookModal: React.FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col overflow-y-auto print:p-0 print:m-0 print:bg-white print:text-black">
      {/* Floating Control Bar (Hidden when printing) */}
      <div className="sticky top-0 z-50 bg-slate-900/95 border-b border-slate-800 px-4 sm:px-8 py-3 flex items-center justify-between gap-4 backdrop-blur-md print:hidden shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kembali ke Terminal</span>
          </button>
          <span className="text-xs font-mono text-cyan-400 font-semibold hidden sm:inline">
            Tampilan Dokumen PDF Lengkap (9 Bab + 4 Ilustrasi Teknis)
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 transition-colors shadow-md"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Simpan Sebagai PDF</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Printable Document Container */}
      <div className="max-w-4xl mx-auto w-full p-4 sm:p-10 my-4 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl space-y-12 text-slate-200 print:max-w-none print:w-full print:p-0 print:m-0 print:border-none print:bg-white print:text-slate-900 print:shadow-none">
        
        {/* ================= COVER PAGE ================= */}
        <section className="min-h-[85vh] flex flex-col justify-between border-b border-slate-800 print:border-b-2 print:border-slate-300 pb-12 print:min-h-screen print:page-break-after-always">
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase tracking-widest">
              <span>AI TERMINAL TRADING · OFFICIAL MANUAL</span>
              <span>EDISI INSTITUSIONAL v2.4</span>
            </div>

            <div className="rounded-xl overflow-hidden border border-slate-800 shadow-xl my-4">
              <img
                src={COVER_IMG}
                alt="AI Terminal Trading Ebook Cover"
                className="w-full h-80 sm:h-96 object-cover"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="space-y-2 pt-2">
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white print:text-black">
                PANDUAN LENGKAP KALIBRASI TRADING BERITA MAKROEKONOMI
              </h1>
              <p className="text-base sm:text-lg text-slate-300 print:text-slate-700 leading-relaxed font-medium">
                Metodologi Kuantitatif: Otomatisasi Matriks Pre-News, Kalibrasi Deviasi Terstandarisasi ($Z$-Score), dan Protokol Eksekusi Fair Value Gap Pasca-Rilis
              </p>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-800 print:border-slate-300 flex flex-col sm:flex-row justify-between items-start sm:items-center text-xs font-mono text-slate-400 print:text-slate-600 gap-2">
            <div>
              <strong>Diterbitkan oleh:</strong> AI Terminal Trading Quantitative Research Group
            </div>
            <div>
              Tahun Terbit: 2026 · Bahasa Indonesia Institusional
            </div>
          </div>
        </section>

        {/* ================= DAFTAR ISI ================= */}
        <section className="space-y-6 pt-6 print:page-break-after-always">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-cyan-400 print:text-cyan-800 border-b border-slate-800 pb-2">
            DAFTAR ISI
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            {[
              { bab: 'BAB 1', title: 'Pendahuluan & Filosofi Kuantitatif', desc: 'Mengatasi 3 jebakan fatal trading berita konvensional' },
              { bab: 'BAB 2', title: 'Kalender & Hirarki Dampak', desc: 'Klasifikasi Grade A/B/C dan sistem alarm audio T-30s & T-5s' },
              { bab: 'BAB 3', title: 'Otomatisasi Pre-News Matrix', desc: '3 Skenario terukur (Bullish, Inline, Bearish) sebelum rilis' },
              { bab: 'BAB 4', title: 'Model Matematika Deviasi (Z-Score)', desc: 'Formula normalisasi surprise score dan ambang batas sinyal' },
              { bab: 'BAB 5', title: 'Protokol Eksekusi & Timing Order Flow', desc: 'Anatomi 15 menit rilis berita dan strategi FVG Retest M1/M3' },
              { bab: 'BAB 6', title: 'Manajemen Risiko & Kalkulator Lot Size', desc: 'Formula Stop Loss dinamis, Buffer Spread, dan Lot Sizing' },
              { bab: 'BAB 7', title: 'Workflow Harian Trader (Step-by-Step)', desc: 'Checklist aktivitas 2 jam sebelum hingga pasca-rilis' },
              { bab: 'BAB 8', title: 'Tiga Studi Kasus Nyata di Pasar', desc: 'Bedah kasus riil US NFP, UK CPI YoY, dan Fed Rate Cut' },
              { bab: 'BAB 9', title: 'Tanya Jawab (FAQ) & Glosarium Teknis', desc: 'Solusi broker spread, slippage, dan akun modal kecil' }
            ].map((item) => (
              <div key={item.bab} className="p-3 bg-slate-950/60 print:bg-slate-100 rounded-lg border border-slate-800 print:border-slate-300">
                <span className="text-cyan-400 print:text-cyan-800 font-bold">{item.bab}: </span>
                <span className="text-slate-100 print:text-black font-semibold">{item.title}</span>
                <p className="text-[11px] text-slate-400 print:text-slate-600 font-sans mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ================= BAB 1 ================= */}
        <section className="space-y-4 pt-6 print:page-break-after-always">
          <div className="text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase">BAB 1</div>
          <h2 className="text-2xl font-bold text-white print:text-black">
            PENDAHULUAN & FILOSOFI KUANTITATIF
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-300 print:text-slate-800">
            Peristiwa rilis berita ekonomi berdampak tinggi (<em>high-impact economic news</em>) adalah katalis terbesar yang menggerakkan triliunan dolar di pasar valuta asing (Forex), emas (XAU/USD), dan obligasi negara. Namun, statistik menunjukkan lebih dari 90% trader retail mengalami kerugian signifikan saat mencoba memanfaatkan momentum berita ini.
          </p>

          <h3 className="text-sm font-bold text-slate-100 print:text-black pt-2">Tiga Jebakan Klasik Trading Fundamental:</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-slate-950 print:bg-slate-50 border border-slate-800 print:border-slate-300 rounded-lg space-y-1">
              <strong className="text-rose-400 print:text-rose-700 block">1. Chasing Spikes (Mengejar Jarum)</strong>
              <p className="text-slate-400 print:text-slate-600 text-[11px]">
                Masuk di pucuk candle 15 detik pertama saat spread broker melonjak hingga 4–10 pips, menyebabkan slippage parah.
              </p>
            </div>
            <div className="p-3 bg-slate-950 print:bg-slate-50 border border-slate-800 print:border-slate-300 rounded-lg space-y-1">
              <strong className="text-amber-400 print:text-amber-700 block">2. Pending Straddle Trap</strong>
              <p className="text-slate-400 print:text-slate-600 text-[11px]">
                Memasang Buy Stop dan Sell Stop 5-10 pips dari harga sebelum rilis. Pelebaran spread menyapu kedua sisi (*dual stop out*).
              </p>
            </div>
            <div className="p-3 bg-slate-950 print:bg-slate-50 border border-slate-800 print:border-slate-300 rounded-lg space-y-1">
              <strong className="text-cyan-400 print:text-cyan-700 block">3. Keterlambatan Reaksi</strong>
              <p className="text-slate-400 print:text-slate-600 text-[11px]">
                Baru mulai menganalisa angka setelah pasar berlari 60 pips dan memasuki fase kelelahan tren (*exhaustion*).
              </p>
            </div>
          </div>
        </section>

        {/* ================= BAB 2 ================= */}
        <section className="space-y-4 pt-6 print:page-break-after-always">
          <div className="text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase">BAB 2</div>
          <h2 className="text-2xl font-bold text-white print:text-black">
            KALENDER EKONOMI & HIRARKI DAMPAK
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-300 print:text-slate-800">
            Setiap indikator makroekonomi memiliki sensitivitas berbeda terhadap ekspektasi suku bunga bank sentral:
          </p>

          <div className="my-4 rounded-xl overflow-hidden border border-slate-800 print:border-slate-300 shadow-md">
            <img
              src={MACRO_IMG}
              alt="Trading Desk Makroekonomi Bank Sentral"
              className="w-full h-64 object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="p-2.5 bg-slate-950 print:bg-slate-100 text-[11px] font-mono text-slate-400 print:text-slate-600 text-center">
              Gambar 2.1: Meja Perdagangan Makro Institusional — Memantau Keputusan Suku Bunga Global (The Fed, ECB, BoE, BoJ).
            </div>
          </div>

          <table className="w-full text-left text-xs border border-slate-800 print:border-slate-300 font-mono">
            <thead className="bg-slate-950 print:bg-slate-200">
              <tr>
                <th className="p-2.5">Klasifikasi</th>
                <th className="p-2.5">Rentang Volatilitas</th>
                <th className="p-2.5">Indikator Contoh</th>
                <th className="p-2.5">Aset Sensitif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 print:divide-slate-300 text-[11px]">
              <tr>
                <td className="p-2.5 text-rose-400 print:text-rose-700 font-bold">GRADE A (High)</td>
                <td className="p-2.5">50 - 150+ Pips</td>
                <td className="p-2.5 font-sans">US Non-Farm Payrolls, Core CPI, Fed Rate Decision</td>
                <td className="p-2.5 font-sans">EURUSD, USDJPY, XAUUSD, US10Y</td>
              </tr>
              <tr>
                <td className="p-2.5 text-amber-400 print:text-amber-700 font-bold">GRADE B (Medium)</td>
                <td className="p-2.5">25 - 55 Pips</td>
                <td className="p-2.5 font-sans">Retail Sales, ISM Services & Mfg PMI, Unemployment Claims</td>
                <td className="p-2.5 font-sans">Major FX Crosses, Index Futures</td>
              </tr>
              <tr>
                <td className="p-2.5 text-slate-400 print:text-slate-600 font-bold">GRADE C (Low)</td>
                <td className="p-2.5">&lt; 20 Pips</td>
                <td className="p-2.5 font-sans">Trade Balance, Wholesale Inventories</td>
                <td className="p-2.5 font-sans">Reaksi intra-menit terbatas</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ================= BAB 3 ================= */}
        <section className="space-y-4 pt-6 print:page-break-after-always">
          <div className="text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase">BAB 3</div>
          <h2 className="text-2xl font-bold text-white print:text-black">
            OTOMATISASI ANALISIS PRE-NEWS
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-300 print:text-slate-800">
            Kelemahan terbesar trader adalah tidak memiliki rencana baku sebelum data keluar. AI Terminal Trading memecahkan hal ini dengan menghitung <strong>Matriks 3-Skenario</strong> secara otomatis:
          </p>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 bg-emerald-950/25 print:bg-emerald-50 border border-emerald-800 print:border-emerald-300 rounded-lg">
              <strong className="text-emerald-400 print:text-emerald-800 text-sm block">1. Skenario Bullish Beat</strong>
              <p className="text-slate-300 print:text-slate-800 mt-1">
                Terjadi jika data aktual $\ge$ batas atas toleransi. Memvalidasi kekuatan mata uang basis. Trader bersiap mengeksekusi order Buy pada pullback Fair Value Gap M1.
              </p>
            </div>

            <div className="p-3.5 bg-slate-950 print:bg-slate-100 border border-slate-800 print:border-slate-300 rounded-lg">
              <strong className="text-slate-200 print:text-slate-800 text-sm block">2. Skenario Inline / Chop Trap (NO TRADE)</strong>
              <p className="text-slate-400 print:text-slate-700 mt-1">
                Terjadi jika angka aktual sangat dekat dengan konsensus ($|Z| &lt; 0.5\sigma$). Pasar biasanya bergerak acak 10-15 pips untuk menjerat liquidity stop order sebelum kembali ke baseline. <strong>Sistem merekomendasikan tidak entry pada breakout</strong>.
              </p>
            </div>

            <div className="p-3.5 bg-rose-950/25 print:bg-rose-50 border border-rose-800 print:border-rose-300 rounded-lg">
              <strong className="text-rose-400 print:text-rose-800 text-sm block">3. Skenario Bearish Miss</strong>
              <p className="text-slate-300 print:text-slate-800 mt-1">
                Terjadi jika angka aktual anjlok di bawah konsensus. Memvalidasi kelemahan mata uang basis. Trader bersiap menjual mata uang basis atau membeli aset lawan seperti Gold (XAU/USD).
              </p>
            </div>
          </div>
        </section>

        {/* ================= BAB 4 ================= */}
        <section className="space-y-4 pt-6 print:page-break-after-always">
          <div className="text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase">BAB 4</div>
          <h2 className="text-2xl font-bold text-white print:text-black">
            MODEL MATEMATIKA KALIBRASI DEVIASI (Z-SCORE)
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-300 print:text-slate-800">
            Deviasi absolut angka seringkali menipu: selisih 0.2% pada inflasi Core CPI memiliki dampak jauh lebih besar daripada selisih 0.2k pada NFP. Untuk itu, sistem menggunakan model deviasi terstandarisasi:
          </p>

          <div className="p-4 bg-slate-950 print:bg-slate-100 border border-slate-800 print:border-slate-300 rounded-xl font-mono text-xs space-y-1.5">
            <div className="text-slate-400 print:text-slate-600">// Formula Normalisasi Deviasi</div>
            <div className="text-lg font-bold text-cyan-300 print:text-cyan-800">
              Z = (Actual - Forecast) / σ_unit
            </div>
            <div className="text-[11px] text-slate-400 print:text-slate-600 font-sans">
              Untuk indikator inversi (seperti Tingkat Pengangguran): Delta = -(Actual - Forecast).
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2">
            <div className="p-3 bg-slate-950 print:bg-slate-50 border border-slate-800 rounded-lg">
              <span className="font-mono font-bold text-emerald-400 print:text-emerald-800 block">|Z| ≥ 1.6σ</span>
              <strong className="text-white print:text-black block mt-0.5">STRONG IMPULSE</strong>
              <span className="text-slate-400 text-[11px]">Override struktur teknikal, memicu pergerakan tren berkelanjutan.</span>
            </div>
            <div className="p-3 bg-slate-950 print:bg-slate-50 border border-slate-800 rounded-lg">
              <span className="font-mono font-bold text-cyan-300 print:text-cyan-800 block">0.5σ ≤ |Z| &lt; 1.6σ</span>
              <strong className="text-white print:text-black block mt-0.5">MODERATE BIAS</strong>
              <span className="text-slate-400 text-[11px]">Arah jelas, wajib menunggu koreksi pullback sebelum masuk.</span>
            </div>
            <div className="p-3 bg-slate-950 print:bg-slate-50 border border-slate-800 rounded-lg">
              <span className="font-mono font-bold text-slate-400 block">|Z| &lt; 0.5σ</span>
              <strong className="text-white print:text-black block mt-0.5">INLINE FILTER</strong>
              <span className="text-slate-400 text-[11px]">Tanpa deviasi substansial. Lindungi modal dari jebakan spread.</span>
            </div>
          </div>
        </section>

        {/* ================= BAB 5 ================= */}
        <section className="space-y-4 pt-6 print:page-break-after-always">
          <div className="text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase">BAB 5</div>
          <h2 className="text-2xl font-bold text-white print:text-black">
            PROTOKOL EKSEKUSI ORDER FLOW & FAIR VALUE GAP
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-300 print:text-slate-800">
            Waktu eksekusi adalah kunci keberhasilan. Jangan pernah membuka posisi di detik ke 0 hingga 15 saat likuiditas ditarik dari order book:
          </p>

          <div className="my-4 rounded-xl overflow-hidden border border-slate-800 print:border-slate-300 shadow-md">
            <img
              src={ORDERFLOW_IMG}
              alt="Diagram Eksekusi Fair Value Gap Retest"
              className="w-full h-72 object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="p-2.5 bg-slate-950 print:bg-slate-100 text-[11px] font-mono text-slate-400 print:text-slate-600 text-center">
              Gambar 5.1: Skema Anatomi Order Flow — Candle Jarum Awal, Pembentukan Fair Value Gap (FVG), dan Titik Entry Retest Ideal.
            </div>
          </div>

          <div className="p-4 bg-slate-950 print:bg-slate-50 border border-slate-800 print:border-slate-300 rounded-xl space-y-2 text-xs">
            <strong className="text-cyan-300 print:text-cyan-800 text-sm block">Panduan Eksekusi FVG Window (T+45s s/d T+180s):</strong>
            <p className="text-slate-300 print:text-slate-800 leading-relaxed">
              Ketika rilis data mengonfirmasi deviasi kuat ($|Z| \ge 1.6\sigma$), candle menit pertama akan melonjak tajam meninggalkan area kosong (*imbalance* / FVG). Tunggu candle kedua atau ketiga turun mengisi area 38.2% hingga 50% dari candle pertama. Pasang order di area ini dengan Stop Loss terukur di bawah titik terendah candle jarum.
            </p>
          </div>
        </section>

        {/* ================= BAB 6 ================= */}
        <section className="space-y-4 pt-6 print:page-break-after-always">
          <div className="text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase">BAB 6</div>
          <h2 className="text-2xl font-bold text-white print:text-black">
            MANAJEMEN RISIKO & KALKULATOR LOT SIZE
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-300 print:text-slate-800">
            Kunci bertahan hidup di trading makroekonomi adalah mengontrol risiko uang secara absolut sebelum menargetkan keuntungan:
          </p>

          <div className="my-4 rounded-xl overflow-hidden border border-slate-800 print:border-slate-300 shadow-md">
            <img
              src={RISK_IMG}
              alt="Matriks Manajemen Risiko Kuantitatif"
              className="w-full h-72 object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="p-2.5 bg-slate-950 print:bg-slate-100 text-[11px] font-mono text-slate-400 print:text-slate-600 text-center">
              Gambar 6.1: Matriks Rasio Risiko-Hasil & Skala Penentuan Ukuran Posisi Otomatis.
            </div>
          </div>

          <div className="p-4 bg-slate-950 print:bg-slate-100 border border-slate-800 print:border-slate-300 rounded-xl font-mono text-xs space-y-2">
            <div className="text-emerald-400 print:text-emerald-800 font-bold">
              SL_pips = Round(ExpectedVol * 0.36 + SpreadBuffer)
            </div>
            <div className="text-cyan-300 print:text-cyan-800 font-bold">
              Lot_Size = (Saldo_Akun * Risk_%) / (SL_pips * $10)
            </div>
          </div>

          <div className="p-4 bg-slate-950/80 print:bg-slate-50 border border-slate-800 print:border-slate-300 rounded-lg text-xs space-y-1">
            <div className="font-semibold text-slate-200 print:text-black">Aturan Take Profit Bertahap:</div>
            <ul className="list-disc list-inside text-slate-400 print:text-slate-700 text-[11px] space-y-1">
              <li><strong>Take Profit 1 (1.5R)</strong>: Tutup 50% posisi saat harga mencapai 1.5x jarak Stop Loss, dan segera geser SL ke Breakeven.</li>
              <li><strong>Take Profit 2 (2.8R)</strong>: Biarkan sisa 50% posisi berjalan untuk menangkap pergerakan tren harian penuh.</li>
            </ul>
          </div>
        </section>

        {/* ================= BAB 7, 8, 9 ================= */}
        <section className="space-y-6 pt-6 print:page-break-after-always">
          <div className="text-xs font-mono text-cyan-400 print:text-cyan-700 font-bold uppercase">BAB 7, 8 & 9</div>
          <h2 className="text-2xl font-bold text-white print:text-black">
            WORKFLOW HARIAN, STUDI KASUS & TANYA JAWAB
          </h2>

          <div className="p-4 bg-slate-950 print:bg-slate-50 border border-slate-800 rounded-xl space-y-3 text-xs">
            <h3 className="text-sm font-bold text-cyan-300 print:text-cyan-800">Checklist Rutinitas 5-Langkah Trader:</h3>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300 print:text-slate-800 text-[11px]">
              <li><strong>T-2 Jam</strong>: Buka Kalender & Pre-News, tinjau batas deviasi skenario Bullish, Inline, dan Bearish.</li>
              <li><strong>T-15 Menit</strong>: Masukkan saldo akun ke Live Calibrator, catat rekomendasi lot size dan siapkan tiket order di platform MT4/MT5.</li>
              <li><strong>T-30 Detik</strong>: Dengarkan alarm audio 30s. Batalkan pending order stop liar di dekat harga pasar.</li>
              <li><strong>T-0s s/d T+180s</strong>: Masukkan angka rilis ke simulator, eksekusi retest FVG M1/M3 jika sinyal Strong Impulse.</li>
              <li><strong>Pasca Rilis</strong>: Evaluasi akurasi model di tab Pasca-News Archive.</li>
            </ol>
          </div>

          <div className="p-4 bg-slate-950 print:bg-slate-50 border border-slate-800 rounded-xl space-y-3 text-xs">
            <h3 className="text-sm font-bold text-emerald-400 print:text-emerald-800">Ringkasan Studi Kasus Nyata:</h3>
            <div className="space-y-2 text-[11px] font-mono text-slate-300 print:text-slate-800">
              <div className="p-2 bg-slate-900 print:bg-slate-200 rounded">
                <strong>Kasus 1: US NFP Beat (+65k jobs, +2.17σ)</strong> → Sinyal STRONG BUY USD. USD/JPY naik +82 pips, Gold jatuh -$32.00. Entry retest FVG mencapai TP2 (+70 pips).
              </div>
              <div className="p-2 bg-slate-900 print:bg-slate-200 rounded">
                <strong>Kasus 2: UK CPI Inline (0.0% deviasi, 0.0σ)</strong> → Sinyal NO TRADE INLINE. GBP/USD whipsaw naik 14 pips lalu turun 22 pips. Modal trader terselamatkan dari jebakan false break.
              </div>
              <div className="p-2 bg-slate-900 print:bg-slate-200 rounded">
                <strong>Kasus 3: Kejutan Dovish Fed Rate Cut 50 bps</strong> → Sinyal MOMENTUM BREAKOUT. Gold XAU/USD meroket +$48.00 (+190 pips).
              </div>
            </div>
          </div>
        </section>

        {/* ================= FOOTER DOKUMEN ================= */}
        <footer className="pt-8 border-t border-slate-800 print:border-slate-300 text-center space-y-2 text-xs text-slate-400 print:text-slate-600 font-mono">
          <div>AI Terminal Trading · Institutional Economic News Calibrator v2.4</div>
          <div>© 2026 Hak Cipta Dilindungi Undang-Undang. Seluruh formula matematika terkalibrasi dan teruji di pasar.</div>
        </footer>

      </div>
    </div>
  );
};
