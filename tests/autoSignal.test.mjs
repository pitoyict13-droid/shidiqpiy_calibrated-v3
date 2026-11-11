// Unit test papan sinyal otomatis: status akhir per event (SIGNAL / COOLDOWN /
// NO_TRADE / EXPIRED / WAITING / NO_DATA), tiket Entry-SL-TP, dan mode simulasi.
// Jalankan: node --import tsx --test tests/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendarEvents } from '../src/utils/calendar.ts';
import { buildAutoBoard, formatCountdown } from '../src/utils/autoSignal.ts';

const now = Date.parse('2026-11-10T12:00:00.000Z');

const AVAILABLE = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'GBPJPY', 'EURJPY', 'XAUUSD', 'NAS100', 'US500'];

const quote = (symbol, mid) => ({ symbol, bid: mid - 0.0002, ask: mid + 0.0002, mid, spreadPips: 1.2, source: 'test-feed' });
const PRICES = {
  EURUSD: quote('EURUSD', 1.1),
  GBPUSD: quote('GBPUSD', 1.3),
  USDJPY: quote('USDJPY', 150),
  USDCHF: quote('USDCHF', 0.8),
  AUDUSD: quote('AUDUSD', 0.66),
  USDCAD: quote('USDCAD', 1.35),
  NZDUSD: quote('NZDUSD', 0.6),
  GBPJPY: quote('GBPJPY', 195),
  EURJPY: quote('EURJPY', 165),
  XAUUSD: quote('XAUUSD', 4000),
  NAS100: quote('NAS100', 27000),
  US500: quote('US500', 7400)
};

const parse = (rows) => parseCalendarEvents(rows, { now, available: AVAILABLE, maxAgeHours: 168 });

test('event belum rilis -> WAITING dengan hitung mundur, tanpa tiket', () => {
  const events = parse([
    { Date: new Date(now + 3 * 3600000).toISOString(), Event: 'Core CPI m/m', Country: 'USD', Importance: 3, Forecast: '0.2%', Previous: '0.3%' }
  ]);
  const board = buildAutoBoard({ events, prices: PRICES, now });

  assert.equal(board.items.length, 1);
  const item = board.items[0];
  assert.equal(item.state, 'WAITING');
  assert.equal(item.phase, 'PRE_RELEASE');
  assert.ok(item.countdownMs > 0, 'harus ada hitung mundur');
  assert.equal(item.tickets.length, 0, 'belum ada tiket pasca-rilis sebelum rilis');
  assert.ok(item.preNewsTickets && item.preNewsTickets.length > 0, 'tiket pra-news & straddle disiapkan sebelum rilis');
  const eurusdPre = item.preNewsTickets.find((t) => t.pair === 'EURUSD');
  assert.equal(eurusdPre.action, 'BUY', 'Core CPI Forecast 0.2% < Previous 0.3% (USD bearish) -> BUY EURUSD pra-news');
  assert.equal(eurusdPre.tradable, true);
  assert.match(item.headline, /Menunggu rilis/);
  assert.ok(item.preNews !== null, 'bias pra-news dihitung dari Forecast vs Previous');
  assert.equal(board.headline, item);
});

test('rilis aktif + deviasi kuat -> SINYAL dengan tiket Entry/SL/TP/lot', () => {
  const events = parse([
    {
      Date: new Date(now - 30 * 60000).toISOString(), // 30 menit lalu: lewat cooldown, masih dalam jendela
      Event: 'Core CPI m/m',
      Country: 'USD',
      Importance: 3,
      Forecast: '0.2%',
      Previous: '0.3%',
      Actual: '0.6%'
    }
  ]);
  const board = buildAutoBoard({ events, prices: PRICES, now });

  const item = board.items[0];
  assert.equal(item.state, 'SIGNAL');
  assert.equal(item.phase, 'ACTIVE');
  assert.equal(item.simulated, false);
  assert.ok(item.z >= 2, `z harus kuat, dapat ${item.z}`);
  assert.match(item.headline, /SINYAL AKTIF/);
  assert.ok(item.gateReason === '', 'sinyal lolos gate tidak punya alasan tolak');

  const tradable = item.tickets.filter((t) => t.tradable);
  assert.ok(tradable.length > 0, 'minimal satu pair punya tiket siap');
  for (const t of tradable) {
    assert.ok(t.action === 'BUY' || t.action === 'SELL');
    assert.ok(Number.isFinite(t.entryPrice) && Number.isFinite(t.slPrice));
    assert.ok(Number.isFinite(t.tp1Price) && Number.isFinite(t.tp2Price));
    assert.ok(t.slPips > 0 && t.tp1Pips > t.slPips && t.tp2Pips > t.tp1Pips);
    assert.ok(t.lots > 0, 'lot dihitung dari risiko, bukan nol');
  }
  assert.equal(board.headline, item, 'sinyal aktif menjadi fokus papan');
});

test('rilis inline (Actual == Forecast) -> NO TRADE dengan alasan ambang', () => {
  const events = parse([
    { Date: new Date(now - 30 * 60000).toISOString(), Event: 'CPI m/m', Country: 'USD', Importance: 3, Forecast: '0.3%', Previous: '0.6%', Actual: '0.3%' }
  ]);
  const board = buildAutoBoard({ events, prices: PRICES, now });

  const item = board.items[0];
  assert.equal(item.state, 'NO_TRADE');
  assert.ok(item.gateReason.length > 0, 'wajib menyebut alasan NO TRADE');
  assert.match(item.headline, /NO TRADE/);
  assert.ok(item.tickets.every((t) => !t.tradable), 'tiket tidak boleh siap saat gate menolak');
});

test('impact LOW tidak pernah menghasilkan sinyal aktif', () => {
  const events = parse([
    { Date: new Date(now - 30 * 60000).toISOString(), Event: 'Final Wholesale Inventories m/m', Country: 'USD', Importance: 1, Forecast: '0.6%', Previous: '0.6%', Actual: '2.0%' }
  ]);
  const board = buildAutoBoard({ events, prices: PRICES, now });

  const item = board.items[0];
  assert.notEqual(item.state, 'SIGNAL');
  assert.equal(item.state, 'NO_TRADE');
  assert.match(item.gateReason, /LOW/i);
});

test('event lewat tanpa angka rilis -> NO_DATA (pidato/rapat)', () => {
  const events = parse([
    { Date: new Date(now - 2 * 3600000).toISOString(), Event: 'FOMC Member Bowman Speaks', Country: 'USD', Importance: 1 }
  ]);
  const board = buildAutoBoard({ events, prices: PRICES, now });

  const item = board.items[0];
  assert.equal(item.state, 'NO_DATA');
  assert.equal(item.countdownMs, null);
  assert.equal(item.tickets.length, 0);
  assert.match(item.headline, /tanpa angka rilis/);
});

test('mode simulasi membuka satu sinyal contoh tanpa menyentuh event lain', () => {
  const events = parse([
    { Date: new Date(now + 3600000).toISOString(), Event: 'Core CPI m/m', Country: 'USD', Importance: 3, Forecast: '0.2%', Previous: '0.3%' },
    { Date: new Date(now + 5 * 3600000).toISOString(), Event: 'Unemployment Claims', Country: 'USD', Importance: 2, Forecast: '194K', Previous: '189K' }
  ]);

  const real = buildAutoBoard({ events, prices: PRICES, now, simulate: false });
  assert.equal(real.simulated, false);
  assert.ok(real.items.every((i) => !i.simulated));

  const sim = buildAutoBoard({ events, prices: PRICES, now, simulate: true });
  assert.equal(sim.simulated, true);
  const target = sim.items.find((i) => i.simulated);
  assert.ok(target, 'harus ada satu event yang disimulasikan');
  assert.equal(target.event.id, events[0].id, 'event terdekat ber-impact MEDIUM+ yang dipilih');
  assert.equal(target.state, 'SIGNAL');
  assert.equal(target.simulated, true);
  assert.ok(target.tickets.some((t) => t.tradable));

  const untouched = sim.items.find((i) => !i.simulated);
  assert.equal(untouched.state, 'WAITING', 'event lain tetap menunggu rilis sungguhan');
});

test('urutan papan: sinyal/ronde rilis dulu, baru jadwal menunggu', () => {
  const events = parse([
    { Date: new Date(now + 2 * 3600000).toISOString(), Event: 'GDP q/q', Country: 'GBP', Importance: 3, Forecast: '0.7%', Previous: '0.5%' },
    { Date: new Date(now - 30 * 60000).toISOString(), Event: 'Core CPI m/m', Country: 'USD', Importance: 3, Forecast: '0.2%', Previous: '0.3%', Actual: '0.5%' },
    { Date: new Date(now - 3 * 3600000).toISOString(), Event: 'FOMC Member Williams Speaks', Country: 'USD', Importance: 1 }
  ]);
  const board = buildAutoBoard({ events, prices: PRICES, now });

  const states = board.items.map((i) => i.state);
  assert.deepEqual(states, ['SIGNAL', 'NO_DATA', 'WAITING']);
  assert.equal(board.counts.SIGNAL, 1);
  assert.equal(board.counts.NO_DATA, 1);
  assert.equal(board.counts.WAITING, 1);
});

test('formatCountdown manusiawi', () => {
  assert.equal(formatCountdown(45 * 1000), '45 detik');
  assert.equal(formatCountdown(5 * 60000 + 1000), '5 menit 1 detik');
  assert.equal(formatCountdown(2 * 3600000 + 15 * 60000), '2 jam 15 menit');
  assert.equal(formatCountdown(3 * 86400000 + 4 * 3600000), '3 hari 4 jam');
  assert.equal(formatCountdown(-1000), '0 detik');
});
