export const EBOOK_RAW_MARKDOWN = `# 📘 EBOOK PANDUAN MANUAL LENGKAP
## AI Terminal Trading: Kalibrasi Dampak Berita Makroekonomi & Parameter Eksekusi Presisi
*Versi 2.4 — Edisi Institusional Kuantitatif*
*Penulis: Tim Pengembang AI Terminal Trading*

---

## DAFTAR ISI
1. **BAB 1**: Pendahuluan & Filosofi Sistem
2. **BAB 2**: Arsitektur Kalender Ekonomi & Hirarki Indikator
3. **BAB 3**: Analisis Otomatis Pre-News (Sebelum Data Rilis)
4. **BAB 4**: Model Matematika Kalibrasi Deviasi ($Z$-Score)
5. **BAB 5**: Protokol Eksekusi Order Flow & Anti-Slippage
6. **BAB 6**: Manajemen Risiko & Kalkulator Lot Size Presisi
7. **BAB 7**: Workflow Harian Trader (Step-by-Step)
8. **BAB 8**: Tiga Studi Kasus Riil (NFP, CPI, Fed Rate Decision)
9. **BAB 9**: Tanya Jawab & Glosarium Istilah

---

# BAB 1: PENDAHULUAN & FILOSOFI SISTEM

### 1.1 Masalah Mendasar Trading Berita Konvensional
Banyak trader retail mengalami kerugian fatal saat mencoba trading pada peristiwa rilis berita ekonomi *high-impact*. Tiga kesalahan paling umum adalah:
1. **Mengejar Lilin Jarum (Chasing Spikes)**: Membuka order beli atau jual di ujung candle 5 detik pertama saat spread broker sedang melebar 3x hingga 10x lipat dari kondisi normal.
2. **Jebakan Straddle (Pending Order Trap)**: Menaruh Buy Stop dan Sell Stop berdekatan (5-10 pips dari harga pasar). Saat rilis berita, spread yang melebar menyentuh kedua order sekaligus dan memicu Stop Loss ganda (*dual whipsaw*).
3. **Analisa Pasca-News yang Terlambat**: Trader baru mulai membaca angka rilis setelah pasar bergerak 60 pips, sehingga kehilangan momentum terbaik dan masuk pada fase pembalikan (*exhaustion pullback*).

### 1.2 Solusi AI Terminal Trading
AI Terminal Trading dirancang untuk mengatasi ketiga masalah tersebut dengan mentransformasikan pendekatan trading berita menjadi sistematis dan terkalibrasi:
- **Pre-News Automated Anticipation**: Sebelum data keluar, sistem sudah menghitung secara otomatis batas ambang deviasi untuk 3 skenario (*Bullish Beat*, *Inline/Chop*, dan *Bearish Miss*).
- **Standardized Surprise Model ($Z$-Score)**: Mengeliminasi bias skala dengan menstandarisasi deviasi angka aktual terhadap unit volatilitas historis per indikator.
- **Fair Value Gap (FVG) Window Execution**: Memberikan panduan waktu masuk (*window timing*) optimal pasca penyerapan spread awal (T+45s hingga T+180s).
- **Continuous Calendar Updater**: Sinkronisasi jadwal kalender berita secara terus-menerus lengkap dengan alarm hitung mundur audio.

---

# BAB 2: ARSITEKTUR KALENDER & HIRARKI INDIKATOR

### 2.1 Klasifikasi Tingkat Dampak Berita
Platform mengkategorikan rilis berita ke dalam tiga tingkatan dampak:

| Tingkat Dampak | Warna Label | Karakteristik Volatilitas | Contoh Rilis Berita |
| :--- | :--- | :--- | :--- |
| **HIGH IMPACT** | **Merah (Rose)** | Volatilitas $\\ge 50 - 150\\text{ pips}$, pelebaran spread signifikan, likuiditas institusional aktif. | NFP, Core CPI, FOMC Rate, ECB Rate, GDP QoQ. |
| **MEDIUM IMPACT**| **Oranye (Amber)** | Volatilitas $25 - 55\\text{ pips}$, memicu tren intra-sesi jika deviasi $\\ge 1.5\\sigma$. | Retail Sales, ISM PMI, Jobless Claims. |
| **LOW IMPACT** | **Kuning (Slate)** | Volatilitas $< 20\\text{ pips}$, cenderung diabaikan pasar kecuali terjadi deviasi ekstrem tak terduga. | Trade Balance, Wholesale Inventories. |

### 2.2 Pasangan Mata Uang & Komoditas yang Terdampak
Setiap mata uang memiliki pasangan likuiditas utama (*core pairs*) dan korelasi komoditas:
- **USD**: EUR/USD, GBP/USD, USD/JPY, USD/CHF, USD/CAD, dan komoditas utama **XAU/USD (Gold)**.
- **EUR**: EUR/USD, EUR/GBP, EUR/JPY, EUR/AUD.
- **GBP**: GBP/USD, EUR/GBP, GBP/JPY.
- **JPY**: USD/JPY, EUR/JPY, GBP/JPY, AUD/JPY.
- **AUD & CAD**: AUD/USD, USD/CAD (sangat sensitif terhadap harga komoditas dan suku bunga regional).

### 2.3 Sistem Alarm Audio Hitung Mundur (Web Audio API)
Ketika tombol audio diaktifkan pada header terminal:
- **T-30 Detik**: Mengeluarkan bunyi *gentle beep* (587 Hz) menandakan trader harus menutup posisi spekulatif dan membatalkan order liar.
- **T-5 Detik**: Mengeluarkan bunyi *urgent chime* (880 Hz) mengingatkan fokus penuh pada grafik tick dan angka aktual.
- **T-0 Detik**: Memainkan arpeggio *triple chime* menandakan data telah dirilis dan mesin kalibrasi mulai bekerja.

---

# BAB 3: OTOMATISASI ANALISIS PRE-NEWS

Salah satu keunggulan terbesar sistem ini adalah **Otomatisasi Analisa Pre-News**. Anda tidak perlu menunggu data keluar untuk mengetahui apa yang harus dilakukan.

### 3.1 Matriks 3-Skenario (The 3-Pronged Matrix)
Untuk setiap rilis kalender mendatang, sistem secara otomatis merumuskan tiga skenario:

#### Skenario 1: BULLISH SURPRISE (Data Lebih Baik dari Konsensus)
- **Kondisi Trigger**: Nilai Aktual $\\ge \\text{Forecast} + \\text{Threshold}$.
- **Arah Aliran Dana**: Penguatan agresif pada mata uang basis.
- **Tindakan**: Beli mata uang basis terhadap mata uang lawan yang lebih lemah (misal: Beli USD/JPY, Jual EUR/USD, Jual XAU/USD).
- **Ekspektasi Volatilitas**: $+45$ s/d $+95\\text{ pips}$.

#### Skenario 2: INLINE / CHOP FILTER (Data Sesuai Konsensus)
- **Kondisi Trigger**: Nilai Aktual berada dalam rentang toleransi netral ($|\\Delta| < 0.5\\sigma$).
- **Arah Aliran Dana**: Konsolidasi atau *fakeout* dua arah (pembantaian likuiditas).
- **Tindakan**: **STAND ASIDE / NO TRADE** pada breakout. Hanya pertimbangkan *fade* (mean reversion) jika harga melonjak menyentuh level support/resistance kunci tanpa didukung deviasi fundamental.

#### Skenario 3: BEARISH MISS (Data Lebih Buruk dari Konsensus)
- **Kondisi Trigger**: Nilai Aktual $\\le \\text{Forecast} - \\text{Threshold}$.
- **Arah Aliran Dana**: Tekanan jual tajam pada mata uang basis.
- **Tindakan**: Jual mata uang basis (misal: Beli EUR/USD, Beli XAU/USD, Jual USD/JPY).
- **Ekspektasi Volatilitas**: $+50$ s/d $+110\\text{ pips}$ pada aset lawan.

### 3.2 AI Macro Deep Dive (Gemini 3.8 Flash)
Dengan menekan ikon **AI Pre-News Playbook** (ikon bintang berkilau), terminal menghubungi server backend untuk memproses data makroekonomi terkini menggunakan model \`gemini-3.8-flash\`. Laporan yang dihasilkan mencakup:
1. Konteks kebijakan moneter bank sentral (*Hawkish vs Dovish*).
2. Peta posisi *smart money* dan penumpukan likuiditas stop order.
3. Rencana eksekusi taktis per pasangan mata uang.
4. Ringkasan formula aturan yang dapat disalin langsung ke jurnal trading Anda.

---

# BAB 4: MODEL MATEMATIKA KALIBRASI DEVIASI

### 4.1 Mengapa Deviasi Mutlak Menyesatkan?
- Deviasi **0.2%** pada inflasi Core CPI Amerika Serikat adalah angka yang sangat masif bagi perkiraan suku bunga The Fed.
- Sementara deviasi **0.2** pada angka Non-Farm Payrolls (misal 160.2k vs 160.0k) adalah angka yang sama sekali tidak berarti.
Oleh karena itu, sistem menggunakan **Standardized Surprise Score ($Z$-Score)**.

### 4.2 Rumus Normalisasi $Z$-Score
$$Z = \\frac{\\Delta_{\\text{raw}}}{\\sigma_{\\text{unit}}} = \\frac{\\text{Actual} - \\text{Forecast}}{\\sigma_{\\text{unit}}}$$

Di mana:
- $\\Delta_{\\text{raw}}$ = Selisih angka aktual dengan konsensus perkiraan pasar.
- $\\sigma_{\\text{unit}}$ = Bobot unit deviasi standar historis per indikator.

### 4.3 Kasus Khusus: Indikator Inversi
Untuk indikator seperti **Unemployment Rate** (Tingkat Pengangguran) atau **Jobless Claims** (Klaim Pengangguran), angka aktual yang lebih rendah adalah kabar **baik/positif** bagi mata uang. Sistem otomatis membalik tanda polaritas:
$$\\Delta_{\\text{inversi}} = -(\\text{Actual} - \\text{Forecast})$$

### 4.4 Tabel Parameter Terkalibrasi per Indikator Utama

| Indikator Ekonomi | Simbol | Unit $\\sigma$ | Ambang Sinyal Kuat | Spread Buffer | Window Timing |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Non-Farm Payrolls (NFP)** | USD | $30\\text{k}$ jobs | $\\pm 60\\text{k}$ | $4.5\\text{ pips}$ | T+90s s/d T+300s |
| **Core CPI (MoM & YoY)** | USD | $0.1\\%$ | $\\pm 0.2\\%$ | $2.8\\text{ pips}$ | T+60s s/d T+180s |
| **FOMC Fed Funds Rate** | USD | $25\\text{ bps}$ | $\\pm 25\\text{ bps}$ | $5.0\\text{ pips}$ | T+120s / Presser T+30m |
| **ECB Refinancing Rate** | EUR | $15\\text{ bps}$ | $\\pm 25\\text{ bps}$ | $3.0\\text{ pips}$ | T+60s / Presser T+45m |
| **UK CPI (YoY)** | GBP | $0.2\\%$ | $\\pm 0.3\\%$ | $3.5\\text{ pips}$ | T+30s s/d T+120s |
| **Retail Sales (MoM)** | USD | $0.2\\%$ | $\\pm 0.3\\%$ | $2.2\\text{ pips}$ | T+30s s/d T+120s |
| **ISM Manufacturing PMI** | USD | $1.0\\text{ pts}$ | $\\pm 1.5\\text{ pts}$ | $2.5\\text{ pips}$ | T+45s s/d T+180s |

---

# BAB 5: PROTOKOL EKSEKUSI ORDER FLOW & ANTI-SLIPPAGE

### 5.1 Siklus Anatomi 15 Menit Rilis Berita
Ketika berita berdampak tinggi dirilis, pergerakan harga melewati 4 fase kritis:

\`\`\`
[T-0s] ----> [T+15s] ----> [T+60s s/d T+180s] ----> [T+15m s/d T+45m]
 Rilis      Fase Spreading     Optimal FVG Retest        Trend Continuation
 Seketika    & Stop Hunt        (ENTRY TERBAIK)            atau Reversal
\`\`\`

1. **Fase 1: T-0s s/d T+15s (Spreading & Stop Hunt)**
   - Algoritma HFT melempar likuiditas keluar dari order book.
   - Spread broker melonjak drastis (misal spread EUR/USD dari 0.8 pips melompat ke 4.5 pips).
   - **Aturan**: DILARANG KERAS mengejar eksekusi instan di fase ini.
2. **Fase 2: T+15s s/d T+60s (Price Discovery)**
   - Arah deviasi fundamental mulai tercermin jelas pada grafik M1.
   - Lilin jarum pertama terbentuk meninggalkan area ketidakseimbangan (*Fair Value Gap* / FVG).
3. **Fase 3: T+60s s/d T+180s (Optimal Pullback Window)**
   - Spread kembali normal ke level reguler.
   - Harga melakukan koreksi teknikal sebesar 38.2% hingga 50% dari body candle lonjakan pertama.
   - **Aturan**: INI ADALAH TITIK ENTRY TERBAIK dengan rasio Risk/Reward maksimal.
4. **Fase 4: T+15m ke atas (Institutional Continuation)**
   - Aliran portofolio institusional makro masuk melanjutkan pergerakan searah deviasi fundamental.

### 5.2 Strategi Fair Value Gap (FVG) Retracement
Jika angka aktual CPI Amerika Serikat keluar $+0.4\\%$ (konsensus $+0.2\\%$, deviasi $+2.0\\sigma$):
- USD/JPY langsung meloncat naik 40 pips pada candle menit pertama.
- Jangan Buy di pucuk 40 pips.
- Tunggu candle menit kedua atau ketiga turun menguji area 50% candle pertama (FVG level).
- Lakukan eksekusi Buy dengan Stop Loss diletakkan di bawah titik terendah candle menit pertama ditambah *spread buffer* (misal 22 pips).

---

# BAB 6: MANAJEMEN RISIKO & KALKULATOR LOT SIZE

### 6.1 Rumus Stop Loss Terkalibrasi
Sistem menghitung Stop Loss dengan formula:
$$\\text{SL (Pips)} = \\text{Round}(\\text{ExpectedVol} \\times 0.36 + \\text{SpreadBuffer})$$

Contoh untuk EUR/USD pada rilis Core CPI:
- Proyeksi Volatilitas = $50\\text{ pips}$
- Spread Buffer = $2.8\\text{ pips}$
- $\\text{SL} = \\text{Round}(50 \\times 0.36 + 2.8) = \\text{Round}(18 + 2.8) = \\mathbf{21\\text{ pips}}$.

### 6.2 Rumus Ukuran Posisi Presisi (Lot Sizing)
Banyak trader gagal karena mematok ukuran lot tetap (misal selalu 1.00 lot) terlepas dari jarak Stop Loss. Formula presisi yang digunakan sistem adalah:
$$\\text{Maksimum Risiko (\\$)} = \\text{Saldo Akun} \\times \\frac{\\text{Risk \\%}}{100}$$
$$\\text{Lot Size} = \\frac{\\text{Maksimum Risiko (\\%)}}{\\text{SL (Pips)} \\times \\text{Nilai Pip per Standard Lot}}$$

*Catatan: Nilai 1 pip per 1.00 Standard Lot pada pasangan USD adalah rata-rata \\$10.00.*

#### Contoh Perhitungan Nyata:
- Saldo Akun: $\\$10,000$
- Risiko per Trade: $1.0\\%$ $\\rightarrow$ Maksimal Risiko = $\\$100.00$
- Jarak Stop Loss yang Dikalibrasi: $22\\text{ pips}$
$$\\text{Lot Size} = \\frac{\\$100}{22 \\times \\$10} = \\frac{\\$100}{\\$220} = \\mathbf{0.45\\text{ Lots}}$$

Jika terjadi kerugian, akun Anda hanya terpotong tepat $\\$99.00$ (tetap dalam batas 1%), menjaga ketahanan psikologi dan modal akun Anda.

### 6.3 Aturan Take Profit Bertahap (Partial Close)
- **Take Profit 1 (TP1)**: Ditetapkan pada rasio $1 : 1.5$ Risk/Reward. Tutup $50\\%$ posisi dan segera geser Stop Loss ke harga masuk (*Breakeven* / Risk-Free Trade).
- **Take Profit 2 (TP2)**: Ditetapkan pada rasio $1 : 2.8$ Risk/Reward untuk menangkap sisa pergerakan tren sesi harian.

---

# BAB 7: WORKFLOW HARIAN TRADER (STEP-BY-STEP)

Ikuti daftar periksa (*checklist*) harian berikut untuk konsistensi trading profesional:

### Tahap 1: Pagi Hari / 2 Jam Sebelum Sesi (Persiapan)
1. Buka tab **Kalender & Pre-News**.
2. Periksa berita dengan label **HIGH IMPACT** hari ini.
3. Klik tombol **Pre-News Matrix** pada berita terdekat untuk mempelajari skenario *Bullish, Inline,* dan *Bearish*.
4. Klik tombol **AI Pre-News Playbook** untuk membaca ringkasan posisi institusional.

### Tahap 2: 15 Menit Sebelum Rilis Berita
1. Pilih tab **Live Calibrator**.
2. Masukkan Saldo Akun Anda dan pilih persentase risiko (disarankan $1.0\\%$ atau $1.5\\%$).
3. Perhatikan angka rekomendasi Lot Size yang dihasilkan kalkulator.
4. Buka platform eksekusi (MT4/MT5/cTrader) dan siapkan tiket order dengan lot tersebut tanpa membuka posisi terlebih dahulu.
5. Pastikan tombol **Audio Chime** di header terminal dalam keadaan aktif (*ON*).

### Tahap 3: 30 Detik Sebelum Rilis Berita
1. Dengarkan alarm peringatan audio 30 detik.
2. Jangan memasang order pending liar (*no pending straddles*).
3. Bersiap membaca angka rilis aktual.

### Tahap 4: Detik Rilis hingga Menit Ketiga
1. Begitu data keluar, masukkan angka aktual ke dalam tab **Live Calibrator** (atau tekan tombol **Test Print / Simulate Release** di kalender).
2. Lihat sinyal bias:
   - Jika keluar **STRONG BUY** atau **STRONG SELL** ($|Z| \\ge 1.6\\sigma$): Segera siapkan order pada *retest wick* M1/M3.
   - Jika keluar **INLINE / CHOP** ($|Z| < 0.5\\sigma$): **TIDAK ADA TRADE**. Lindungi modal Anda dari jebakan whipsaw.
3. Pasang order dengan batas SL dan TP1 / TP2 yang telah tertera di tiket eksekusi.

### Tahap 5: Pasca-Rilis (Evaluasi)
1. Setelah sesi selesai, buka tab **Pasca-News Archive**.
2. Bandingkan deviasi yang terjadi dengan pergerakan pips pasar sesungguhnya.
3. Catat di jurnal trading Anda apakah model berjalan sesuai ekspektasi.

---

# BAB 8: TIGA STUDI KASUS RIIL

### Studi Kasus 1: US Non-Farm Payrolls (NFP) — Bullish Beat
- **Konsensus Forecast**: $165\\text{k}$ jobs
- **Data Aktual Rilis**: $230\\text{k}$ jobs
- **Perhitungan Deviasi**:
  $$\\Delta = 230 - 165 = +65\\text{k}$$
  $$Z = \\frac{+65}{30} = \\mathbf{+2.17\\sigma}\\quad (\\text{STRONG BUY USD})$$
- **Respon Pasar**:
  - DXY melonjak $+0.65\\%$.
  - USD/JPY naik $+82\\text{ pips}$.
  - XAU/USD (Gold) jatuh $-\\$32.00$ ($-128\\text{ pips}$ setara).
- **Hasil Eksekusi**: Trader yang menunggu retest 50% candle pertama USD/JPY berhasil masuk di harga $153.20$ dengan SL $152.95$ ($25\\text{ pips}$) dan mencapai TP2 di $153.90$ ($+70\\text{ pips}$, RR $1:2.8$).

### Studi Kasus 2: UK CPI YoY — Inline Chop Trap
- **Konsensus Forecast**: $2.2\\%$
- **Data Aktual Rilis**: $2.2\\%$
- **Perhitungan Deviasi**:
  $$\\Delta = 2.2 - 2.2 = 0.0\\%$$
  $$Z = 0.0\\sigma\\quad (\\text{NEUTRAL / INLINE CHOP})$$
- **Respon Pasar**: GBP/USD melonjak naik $14\\text{ pips}$ dalam 10 detik pertama, lalu berbalik turun $-22\\text{ pips}$ dalam 30 detik berikutnya, kemudian kembali ke harga awal.
- **Hasil Eksekusi**: Sinyal terminal mengeluarkan **NO TRADE INLINE**. Trader retail yang memasang Buy Stop di pucuk terkena *slippage* dan tersapu Stop Loss saat harga berbalik arah. Pengguna terminal berhasil menyelamatkan modal utuh.

### Studi Kasus 3: Kejutan Dovish Fed Rate Cut 50 bps
- **Konsensus Forecast**: Cut $25\\text{ bps}$ ($4.75\\%$)
- **Data Aktual Rilis**: Cut $50\\text{ bps}$ ($4.50\\%$)
- **Perhitungan Deviasi**:
  $$\\Delta = -25\\text{ bps}$$
  $$Z = \\frac{-25}{25} = \\mathbf{-1.0\\sigma}\\text{ deviasi suku bunga (kategori EXTREME IMPULSE)}$$
- **Respon Pasar**: Imbal hasil obligasi AS (*US 10Y Yields*) terjun bebas. XAU/USD Gold terbang melonjak $+\\$48.00$ ($+190\\text{ pips}$ setara) dalam satu sesi.
- **Hasil Eksekusi**: Terminal merekomendasikan strategi **MOMENTUM BREAKOUT** pada Gold dengan target pips di atas $180\\text{ pips}$.

---

# BAB 9: TANYA JAWAB (FAQ) & GLOSARIUM

**Q: Mengapa spread broker saya sangat besar saat rilis berita?**  
*A: Saat rilis berita, penyedia likuiditas bank (Liquidity Providers) menarik order limit mereka untuk menghindari kerugian volatilitas cepat. Karena order book menipis, selisih antara harga penawaran terendah (Ask) dan permintaan tertinggi (Bid) melebar. Terminal kami memperhitungkan hal ini dengan menambahkan "Spread Buffer" pada setiap perhitungan Stop Loss.*

**Q: Apakah sistem ini cocok untuk akun kecil (\\$100 s/d \\$500)?**  
*A: Sangat cocok. Dengan kalkulator Lot Size terintegrasi, trader dengan akun \\$100 dapat trading dengan micro lot (0.01 lot) dan membatasi risiko maksimal \\$1.00 s/d \\$2.00 per trade.*

**Q: Apa perbedaan antara Pre-News dan Pasca-News di terminal?**  
*A: Pre-News adalah analisis prediktif berbasis skenario konsensus sebelum data keluar. Pasca-News adalah evaluasi riil terhadap data yang sudah dirilis beserta validasi deviasi dan respon pasar sesungguhnya.*

---
*© 2026 AI Terminal Trading. Hak Cipta Dilindungi Undang-Undang.*
`;
