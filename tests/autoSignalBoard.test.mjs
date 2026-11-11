// Smoke test UI: papan sinyal otomatis harus bisa dirender (SSR) tanpa error
// dan menampilkan keputusan akhir beserta tiketnya.
// Jalankan: node --import tsx --test tests/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCalendarEvents } from '../src/utils/calendar.ts';
import { AutoSignalBoard } from '../src/components/AutoSignalBoard.tsx';

// Waktu berjalan: komponen memakai Date.now() sendiri, jadi fixture event juga
// harus relatif terhadap jam sekarang agar fase rilis bisa diuji andal.
const now = Date.now();
const AVAILABLE = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'GBPJPY', 'EURJPY', 'XAUUSD', 'NAS100', 'US500'];

const quote = (symbol, mid) => ({ symbol, bid: mid - 0.0002, ask: mid + 0.0002, mid, spreadPips: 1.2, source: 'test-feed' });
const PRICES = {
  EURUSD: quote('EURUSD', 1.1),
  GBPUSD: quote('GBPUSD', 1.3),
  USDJPY: quote('USDJPY', 150),
  USDCHF: quote('USDCHF', 0.8),
  XAUUSD: quote('XAUUSD', 4000)
};

const events = parseCalendarEvents(
  [
    {
      Date: new Date(now - 30 * 60000).toISOString(),
      Event: 'Core CPI m/m',
      Country: 'USD',
      Importance: 3,
      Forecast: '0.2%',
      Previous: '0.3%',
      Actual: '0.6%'
    },
    { Date: new Date(now + 3 * 3600000).toISOString(), Event: 'Unemployment Claims', Country: 'USD', Importance: 2, Forecast: '194K', Previous: '189K' },
    { Date: new Date(now - 2 * 3600000).toISOString(), Event: 'FOMC Member Bowman Speaks', Country: 'USD', Importance: 1 }
  ],
  { now, available: AVAILABLE, maxAgeHours: 168 }
);

const render = () =>
  renderToStaticMarkup(
    React.createElement(AutoSignalBoard, {
      events,
      prices: PRICES,
      bars: {},
      priceSource: 'snapshot uji',
      onRefreshPrices: () => {},
      onOpenEvent: () => {}
    })
  );

test('papan sinyal otomatis ter-render lengkap tanpa error', () => {
  const html = render();

  assert.match(html, /Sinyal Kalibrasi Otomatis/);
  assert.match(html, /SINYAL AKTIF/, 'keputusan utama tampil');
  assert.ok(html.includes('Core CPI m/m'), 'judul event tampil');
  assert.match(html, /MENUNGGU RILIS/, 'ringkasan status menunggu tampil');
  assert.match(html, /Unemployment Claims/);
  assert.match(html, /TANPA ANGKA/, 'pidato tanpa angka ditandai');
  assert.match(html, /hitung mundur|Cara kerja otomatis/);

  // Tiket: pasangan angka Entry/SL/TP harus muncul untuk sinyal yang lolos gate, tanpa STRADDLE OCO pada bagian sinyal aktif.
  assert.match(html, /Entry/);
  assert.match(html, /\bSL\b/);
  assert.match(html, /\bTP2\b/);
  const heroAndReleasedSection = html.split('Berikutnya (')[0];
  assert.doesNotMatch(
    heroAndReleasedSection,
    /Fallback Straddle OCO|Straddle Breakout|STRADDLE OCO/,
    'sinyal arah tunggal tidak boleh menampilkan STRADDLE OCO'
  );
  // Kontrol mode contoh selalu tersedia (mati karena sudah ada rilis riil).
  assert.match(html, /Lihat contoh sinyal \(simulasi\)|Simulasi ON/);
  assert.ok(html.length > 2000, 'markup tidak boleh kosong');
});

test('event pra-rilis dengan sentimen pasar jelas menampilkan sinyal 1 harga, bukan STRADDLE OCO', () => {
  const neutralUpcoming = parseCalendarEvents(
    [{ Date: new Date(now + 2 * 3600000).toISOString(), Event: 'GDP q/q', Country: 'EUR', Importance: 3, Forecast: '0.4%', Previous: '0.4%' }],
    { now, available: AVAILABLE, maxAgeHours: 168 }
  );
  const sentimentPrices = {
    ...PRICES,
    EURUSD: { ...PRICES.EURUSD, changePct: 0.42 }
  };
  const html = renderWith({ events: neutralUpcoming, prices: sentimentPrices, defaultSimulate: false });
  assert.match(html, /Sentimen Pasar|SIAP \(SENTIMEN\)/);
  assert.match(html, /Entry/);
  assert.doesNotMatch(html, /STRADDLE OCO|Fallback Straddle OCO/, 'bila sentimen pasar memberi arah BUY/SELL, tidak boleh muncul STRADDLE OCO');
});

const renderWith = (props) =>
  renderToStaticMarkup(
    React.createElement(AutoSignalBoard, {
      prices: PRICES,
      bars: {},
      priceSource: 'snapshot uji',
      onRefreshPrices: () => {},
      onOpenEvent: () => {},
      ...props
    })
  );

test('semua event ber-sinyal 1 harga (HIGH/MEDIUM) tampil langsung meski berada di bawah banyak event LOW', () => {
  const mixed = parseCalendarEvents(
    [
      { Date: new Date(now + 1 * 3600000).toISOString(), Event: 'Italian Industrial Production m/m', Country: 'EUR', Importance: 1, Forecast: '0.7%', Previous: '-1.3%' },
      { Date: new Date(now + 2 * 3600000).toISOString(), Event: 'Bank Holiday', Country: 'USD', Importance: 1 },
      { Date: new Date(now + 12 * 3600000).toISOString(), Event: 'GDP m/m', Country: 'GBP', Importance: 3, Forecast: '0.1%', Previous: '0.1%' },
      { Date: new Date(now + 24 * 3600000).toISOString(), Event: 'Core PPI m/m', Country: 'USD', Importance: 3, Forecast: '0.2%', Previous: '0.4%' },
      { Date: new Date(now + 24 * 3600000).toISOString(), Event: 'PPI m/m', Country: 'USD', Importance: 3, Forecast: '0.1%', Previous: '0.5%' }
    ],
    { now, available: AVAILABLE, maxAgeHours: 168 }
  );
  const html = renderWith({ events: mixed, defaultSimulate: false });
  assert.match(html, /Semua Event Ber-Sinyal 1 Harga/);
  assert.ok(html.includes('Core PPI m/m'), 'Core PPI harus tampil di papan sinyal 1 harga');
  assert.ok(html.includes('PPI m/m'), 'PPI m/m harus tampil di papan sinyal 1 harga');
});

test('papan tetap tampil saat semua jadwal menunggu (mode contoh dimatikan)', () => {
  const upcoming = parseCalendarEvents(
    [{ Date: new Date(now + 2 * 3600000).toISOString(), Event: 'GDP q/q', Country: 'GBP', Importance: 3, Forecast: '0.7%', Previous: '0.5%' }],
    { now, available: AVAILABLE, maxAgeHours: 168 }
  );
  const html = renderWith({ events: upcoming, defaultSimulate: false });

  assert.match(html, /MENUNGGU RILIS/);
  assert.match(html, /Belum ada rilis hari ini/i);
  assert.match(html, /Menunggu rilis dalam \d+/, 'hero menampilkan hitung mundur, bukan sinyal');
  // Label "SINYAL AKTIF" juga muncul di kartu ringkasan (angka 0) — yang dilarang
  // adalah headline sinyal, ditandai em dash.
  assert.doesNotMatch(html, /SINYAL AKTIF —/);
});

test('tanpa rilis sungguhan: mode contoh aktif otomatis dan ditandai SIMULASI', () => {
  const upcoming = parseCalendarEvents(
    [{ Date: new Date(now + 2 * 3600000).toISOString(), Event: 'Core CPI m/m', Country: 'USD', Importance: 3, Forecast: '0.2%', Previous: '0.3%' }],
    { now, available: AVAILABLE, maxAgeHours: 168 }
  );
  // defaultSimulate default true + belum ada Actual riil -> sinyal contoh tampil.
  const html = renderWith({ events: upcoming });

  assert.match(html, /SINYAL AKTIF —/, 'keputusan akhir langsung terlihat');
  assert.match(html, /SIMULASI \(bukan rilis sungguhan\)/, 'wajib ditandai bukan data sungguhan');
  assert.match(html, /Belum ada rilis hari ini/);

  // Mode contoh dimatikan paksa -> kembali menunggu rilis sungguhan.
  const off = renderWith({ events: upcoming, defaultSimulate: false });
  assert.doesNotMatch(off, /SINYAL AKTIF —/);
  assert.match(off, /Menunggu rilis dalam \d+/);
});

test('begitu ada Actual sungguhan, mode contoh tidak mengambil alih', () => {
  // events (fixture utama) memuat rilis riil Core CPI -> simulasi otomatis off.
  const html = renderWith({ events });
  assert.match(html, /SINYAL AKTIF —/);
  assert.doesNotMatch(html, /SIMULASI \(bukan rilis sungguhan\)/, 'sinyal riil tanpa label simulasi');
});
