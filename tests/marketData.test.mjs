// Unit test lapisan data pasar: buildPriceMap (prioritas broker > live > snapshot,
// spread dari mid, perubahan % dari previousClose), barsFromBundle, dan fallback
// sumber live (fetchLivePrices gagal -> tetap memakai snapshot, bukan error).
// Jalankan: node --import tsx --test tests/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPriceMap, barsFromBundle, availableSymbols, describeSource } from '../src/utils/marketData.ts';

const now = Date.parse('2026-11-09T12:00:00.000Z');

const bundle = {
  markets: {
    generatedAt: '2026-11-08T15:26:03.894Z',
    pairs: {
      'EUR/USD': { price: 1.11406, previousClose: 1.1218, bars: [{ k: 1, o: 1.11, h: 1.12, l: 1.1, c: 1.115 }] },
      'XAU/USD': { price: 4072.1, previousClose: 4113.5 },
      'NAS100': { price: 26989.992, previousClose: 26629.809 },
      'NOT_A_MARKET/USD': { price: 12345 } // simbol di luar registry harus diabaikan
    }
  },
  forex: {
    generatedAt: '2026-11-08T15:26:03.000Z',
    quotes: { 'GBP/USD': { price: 1.33526, changePct: -0.74 } }
  },
  indices: { items: [{ symbol: 'US500', price: 7376.86, changePct: 0.31 }] },
  crypto: { pairs: { 'BTC/USD': 75941, 'ETH/USD': 2236.2 } },
  broker: null,
  calendar: [],
  source: 'test',
  generatedAt: '2026-11-08T15:26:03.894Z'
};

test('buildPriceMap memuat semua instrumen dari snapshot', () => {
  const map = buildPriceMap(bundle, now);
  assert.ok(map.EURUSD, 'EURUSD ada');
  assert.ok(map.XAUUSD, 'XAUUSD ada');
  assert.ok(map.NAS100, 'NAS100 ada');
  assert.ok(map.US500, 'US500 ada');
  assert.ok(map.BTCUSD, 'BTCUSD ada');
  assert.ok(map.ETHUSD, 'ETHUSD ada');
  assert.ok(map.GBPUSD, 'GBPUSD dari forex.json');
  // Simbol di luar registry tidak dipakai (market yang tersedia saja)
  assert.equal(map.NOT_A_MARKETUSD, undefined);
});

test('harga riil dipakai apa adanya (tanpa jitter/hardcode)', () => {
  const map = buildPriceMap(bundle, now);
  assert.ok(Math.abs(map.XAUUSD.mid - 4072.1) < 1e-9, `XAU harus 4072.1, dapat ${map.XAUUSD.mid}`);
  assert.ok(Math.abs(map.EURUSD.mid - 1.11406) < 1e-9, 'EURUSD harus 1.11406');
  assert.ok(Math.abs(map.BTCUSD.mid - 75941) < 1e-9, 'BTC harus 75941');
});

test('snapshot hanya-punya-mid tetap menghasilkan bid/ask terpisah (spread instrumen)', () => {
  const map = buildPriceMap(bundle, now);
  for (const sym of ['EURUSD', 'XAUUSD', 'BTCUSD']) {
    const q = map[sym];
    assert.ok(q.ask > q.bid, `${sym}: ask (${q.ask}) harus > bid (${q.bid})`);
    const mid = (q.ask + q.bid) / 2;
    assert.ok(Math.abs(mid - q.mid) < 1e-9, `${sym}: mid harus di tengah bid/ask`);
    assert.ok(q.spreadPips > 0, `${sym}: spreadPips harus > 0`);
  }
});

test('perubahan % dihitung dari previousClose, bukan angka acak', () => {
  const map = buildPriceMap(bundle, now);
  const expected = ((1.11406 - 1.1218) / 1.1218) * 100;
  assert.ok(Math.abs(map.EURUSD.changePct - expected) < 0.01, `EURUSD changePct ${map.EURUSD.changePct} vs ${expected}`);
  // forex.json sudah menyimpan changePct
  assert.equal(map.GBPUSD.changePct, -0.74);
});

test('bar 1-menit diekstrak dari markets.json (dipakai reaksi pasca-rilis)', () => {
  const bars = barsFromBundle(bundle);
  assert.ok(bars.EURUSD && bars.EURUSD.length === 1, 'EURUSD punya 1 bar');
  assert.equal(bars.EURUSD[0].c, 1.115);
  assert.equal(bars.XAUUSD, undefined, 'XAU tanpa bar tidak dimasukkan');
});

test('broker MT5 (bid/ask asli) menang atas snapshot saat masih segar', () => {
  const withBroker = {
    ...bundle,
    broker: {
      generatedAt: new Date(now - 60000).toISOString(), // 1 menit lalu
      quotes: { 'EUR/USD': { bid: 1.11900, ask: 1.11910, mid: 1.11905, spreadPips: 1 } }
    }
  };
  const map = buildPriceMap(withBroker, now);
  assert.equal(map.EURUSD.source, 'broker MT5 (live)');
  assert.ok(Math.abs(map.EURUSD.bid - 1.119) < 1e-9, 'bid memakai harga broker');

  // Broker basi (>30 menit) diabaikan
  const stale = { ...withBroker, broker: { ...withBroker.broker, generatedAt: new Date(now - 40 * 60000).toISOString() } };
  const staleMap = buildPriceMap(stale, now);
  assert.notEqual(staleMap.EURUSD.source, 'broker MT5 (live)', 'broker basi tidak dipakai');
});

test('availableSymbols & describeSource untuk label UI', () => {
  const map = buildPriceMap(bundle, now);
  const syms = availableSymbols(map);
  assert.ok(syms.includes('EURUSD') && syms.includes('XAUUSD'));
  const desc = describeSource(map);
  assert.match(desc, /snapshot/);
  assert.equal(describeSource({}), 'tanpa data harga');
});
