# Feriha Intelligence

<p align="center">
  <a href="[https://MarketForgeX.github.io/xauusd-ai-terminal]" target="_blank" rel="noopener noreferrer"><strong>🚀 CHECK LIVE TERMINAL</strong></a>
</p>

## Publish

1. Copy these files to the repository root and push.
2. Regenerate the exposed Twelve Data key, then add the new key in GitHub Actions secrets as `TWELVE_DATA_API_KEY`.
3. Run the `Update live economic calendar` workflow once.
4. Enable GitHub Pages from `main` and `/ (root)`.

The calendar uses Forex Factory's free public weekly export; no calendar key is required. The workflow merges each refresh into the current month and updates Twelve Data XAU/USD price every two hours. All displayed times use India Standard Time (`Asia/Kolkata`). Never put the private API key in public HTML. LONG/SHORT is scenario analysis, not a prediction.

## Auto order grid (forex major)

`scripts/mt5_grid_hft.py` is a breakout-grid executor for EUR/USD, GBP/USD and USD/JPY: lot 0.01, grid/SL 15 pips, TP 30 pips (RR 1:2), breakeven at +1R, daily loss stop $5. News behaviour: entries are blocked ±30 minutes around impact>=2 events, and for 60 minutes after an impact>=3 event the grid/SL/TP are widened ×1.5. It is DRY-RUN by default (paper book); orders are only sent to a DEMO account with `--enable`.

    start-grid.bat                :: dry-run
    start-grid.bat --enable       :: kirim order ke akun DEMO

Do not run it at the same time as `start.bat` (news executor) on the same terminal. Logs: `bridge/grid_orders.csv`; state: `bridge/grid_state.json`. Parameters: `python scripts\mt5_grid_hft.py --help`.

Opsi `--scale-out` (default mati) membuka dua leg 0.01 (total 0.02) per sinyal: leg A TP +15 pips, leg B TP +30 pips, dan setelah leg A TP, SL leg B otomatis digeser ke breakeven. Ini meniru partial TP → BE → runner, tetapi risiko per sinyal menjadi ~2x dan `--max-open` menghitung tiap leg (pakai `--max-open 6` bila ingin tiga sinyal). Backtest 50 ribu bar M1: +$20.43 vs +$19.08 baseline, PF 1.13, max DD $12.06 vs $17.00 — tipis, bukan jaminan. Laporan lengkap: `reports/backtest_grid_scaleout_2026-10-29.pdf`.

## GUI lokal (demo hanya)

    gui.bat

Buka `http://127.0.0.1:8765/` untuk mendeteksi terminal MetaTrader 5, login akun demo, melihat status akun, lalu menjalankan/menghentikan executor dengan log live. Server hanya listen di `127.0.0.1` dan setiap panggilan API memakai token acak per sesi. Login lewat GUI mengganti sesi akun pada terminal yang dipilih; password tidak disimpan. Login akun non-demo ditolak, dan tombol kirim order hanya aktif untuk akun DEMO. Jangan jalankan GUI/executor bersamaan dengan `start-grid.bat` atau `start.bat` di terminal yang sama.

## Backtest historis

    python scripts\grid_backtest.py                    :: M1 + laporan FOMC
    python scripts\grid_backtest.py --timeframe M5     :: uji sensitivitas, sampel lebih panjang
    python scripts\grid_backtest.py --no-news          :: tanpa filter news
    python scripts\grid_backtest.py --spread-pips 1.2 --csv bridge\backtest_trades.csv

Read-only: hanya membaca bar dari terminal, tidak mengirim order, dan memakai aturan yang sama dengan executor (grid/SL/TP, BE, sesi, news, guard). Aproksimasi: konfirmasi breakout dihitung per bar (bukan 2 poll 1 detik), SL didahulukan bila SL dan TP kena di bar yang sama, spread tetap, tanpa swap/komisi. Laporan memuat winrate, TP-rate, expectancy, profit factor, max drawdown, per pair, dan rincian hari FOMC. Tanggal FOMC 2026 ditanam di script; kalender news lokal hanya mencakup beberapa hari terakhir, jadi event impact tinggi lama tidak ikut difilter.

## Basis spot vs perpetual (port HTF-Nano-Tick)

    python scripts\basis_scanner.py --once
    python scripts\basis_scanner.py --interval 5
    python scripts\basis_scanner.py --once --ignore-fees --json
    python scripts\basis_scanner.py --paper --interval 5 --paper-csv bridge\basis_paper.csv

Port logika cash-and-carry dari `github.com/islero/HTF-Nano-Tick`: beli spot dan jual perpetual bila basis melewati ambang, keluar saat basis menyempit atau setelah 5 menit. Scanner ini hanya memakai GET publik OKX (spot vs USDT-perp), tanpa API key, tanpa order, dan tidak terhubung ke terminal MT5 — FBS tidak menyediakan leg futures. Ambang default 10 bps masuk / 2 bps keluar (komentar repo: 0,1% / 0,02%; kode aslinya memakai harga absolut 0,001/0,0002). Biaya taker dihitung: 4 fill = 30 bps round trip, jadi sinyal baru realistis bila basis melebihi biaya; funding ditampilkan sebagai konteks dan tidak masuk PnL. Mode `--paper` membuka posisi virtual (notional `--paper-notional`, default $1000) dan menutupnya saat basis unwind <= `--exit-bps` atau `--holding-s` habis, lalu mencatat PnL bersih ke CSV; tetap tanpa order dan state hanya di memori. Logika murni ada di `scripts/basis_core.py` dengan unit test di `tests/test_basis_core.py`.

## Session sweep (port repo Forex-trading-strategy-development)

    python scripts\session_sweep_backtest.py
    python scripts\session_sweep_backtest.py --pairs EUR/USD,GBP/USD --tp-mode opposite

Repo `MrPotatoHead-Dev/Forex-trading-strategy-development` hanya menghitung seberapa sering London menyapu kedua sisi range Asia (03:00-07:00 server, jendela 07:00-15:00), tanpa entry/SL/TP/biaya. Skrip ini mereproduksi statistik itu dari data M15 MT5 dan menguji aturan fade sederhana: entry di close sweep kedua, SL di luar extreme +3 pips, TP midpoint (atau sisi seberang), resolve sampai akhir London. Read-only, tanpa order.

Hasil 2024-09..2026-10: pola muncul di 39,9% hari EUR/USD, 43,5% GBP/USD, 19,1% USD/JPY. Fade-nya negatif di FX (tahan sampai close -526 pips, TP mid -440 pips, PF 0,78-0,90), jadi belum ada edge yang layak. Catatan: `seekanddestroy.py` di repo memeriksa sweep di luar jendela London sehingga `low to high` selalu 0; notebook-nya menghitung sebagian hari dua kali (60,3% vs 43,5% hari unik). XAU/USD memakai skala pip berbeda dan hasilnya tidak stabil, jadi tidak dijadikan bukti.

## Order flow BTC (port repo btcusdt-orderflow)

    python scripts\orderflow_backtest.py
    python scripts\orderflow_backtest.py --interval 5m --days 180 --hold 6
    python scripts\orderflow_live.py --seconds 300 --csv bridge\flow_live.csv

Repo `akenshaw/btcusdt-orderflow` hanya visualizer PyQt (heatmap depth Binance, tabel DOM, scatter skew 3D); tidak ada entry/exit/SL/TP/biaya, dan `main.py` menulis log ke path hardcode `/Users/berkes/...`. Skrip di sini menguji bagian yang bisa diukur: trade-flow imbalance (TFI, taker buy vs sell) historis dari klines Binance, dan book imbalance live dari WebSocket publik OKX. `fapi.binance.com` diblokir dari lokasi ini, jadi histori memakai mirror resmi `data-api.binance.vision` (spot sebagai proxy perp). Read-only, tanpa API key, tanpa order.

Hasil TFI: 1m 30 hari (43.200 bar) korelasi return 1-30 bar hanya +0,001..+0,026; desil ekstrem +0,37 bps per 5 menit; simulasi q=0,95 gross +0,25 bps/trade, net -9,75 bps (fee futures 5 bps/sisi) atau -19,75 bps (spot 10 bps/sisi). 5m 180 hari: gross -0,46 bps momentum / +0,46 bps contrarian; 15m 1 tahun: contrarian +1,05 bps. Semua negatif setelah biaya.

Book imbalance tidak punya data L2 historis gratis. Sampel live 5 menit (282 sampel) menunjukkan bias book persisten (mean +0,111) dan korelasi level dengan return 15 detik +0,20, tetapi perubahan imbalance (`d_imb`) praktis nol (|r| <= 0,05) dan simulasi ambang 1 sd hanya menghasilkan gross +0,25 bps per 15 detik (0% win, n=14, setelah spread 2,5 bps BTCUSD FBS). Sampel terlalu pendek dan jendela return tumpang tindih, jadi ini uji kelayakan alat, bukan bukti edge. Kesimpulan: metriknya bisa diadopsi, sinyalnya belum layak. `orderflow_live.py` butuh paket `websockets`.

# aiterminaltrading
