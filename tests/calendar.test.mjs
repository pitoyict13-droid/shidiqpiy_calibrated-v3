// Unit test loader kalender news: importance -> impact, parse angka "%"/"K",
// preset parameter kalibrasi per indikator, dan filter instrumen yang tersedia.
// Jalankan: node --import tsx --test tests/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCalendarEvents,
  parseCalendarNumber,
  parseCalendarUnit,
  impactFromImportance,
  buildCalibrationFor,
  affectedPairsFor,
  inferCategory,
  buildPreNewsScenarios,
  pickEventSource
} from '../src/utils/calendar.ts';
import { thresholdsFor } from '../src/utils/calibrator.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const now = Date.parse('2026-11-09T12:00:00.000Z');

const AVAILABLE = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'GBPJPY', 'EURJPY', 'XAUUSD', 'NAS100', 'US500', 'BTCUSD', 'ETHUSD'];

test('parse angka kalender: suffix %, K, koma, dan nilai kosong', () => {
  assert.equal(parseCalendarNumber('0.6%'), 0.6);
  assert.equal(parseCalendarNumber('165K'), 165);
  assert.equal(parseCalendarNumber('1,234.5'), 1234.5);
  assert.equal(parseCalendarNumber('5.00%'), 5);
  assert.equal(parseCalendarNumber('-0.3'), -0.3);
  assert.equal(parseCalendarNumber(''), null);
  assert.equal(parseCalendarNumber('-'), null);
  assert.equal(parseCalendarNumber('N/A'), null);
  assert.equal(parseCalendarNumber(null), null);
  assert.equal(parseCalendarNumber('speak soon'), null);
});

test('parse unit dari suffix data', () => {
  assert.equal(parseCalendarUnit('0.6%'), '%');
  assert.equal(parseCalendarUnit('165K'), 'k');
  assert.equal(parseCalendarUnit('165k'), 'k');
  assert.equal(parseCalendarUnit(''), null);
});

test('importance 3/2/1 -> HIGH/MEDIUM/LOW', () => {
  assert.equal(impactFromImportance(3), 'HIGH');
  assert.equal(impactFromImportance('3'), 'HIGH');
  assert.equal(impactFromImportance(2), 'MEDIUM');
  assert.equal(impactFromImportance(1), 'LOW');
  assert.equal(impactFromImportance(undefined), 'LOW');
});

test('preset indikator: NFP, CPI, suku bunga, PMI', () => {
  const nfp = buildCalibrationFor('Non-Farm Payrolls', 'k', 165, 142);
  assert.equal(nfp.standardDeviationUnit, 30);
  assert.equal(nfp.highImpactThreshold, 60);
  assert.equal(nfp.moderateThreshold, 35);
  assert.equal(nfp.unit, 'k');
  assert.ok(nfp.invalidationTimeMinutes >= 45);

  const cpi = buildCalibrationFor('Core CPI (MoM)', '%', 0.3, 0.3);
  assert.equal(cpi.standardDeviationUnit, 0.1);
  assert.equal(cpi.highImpactThreshold, 0.2);

  const rate = buildCalibrationFor('Fed Interest Rate Decision', '%', 4.75, 5.0);
  assert.equal(rate.standardDeviationUnit, 25, 'sigma keputusan suku bunga dalam bps');
  assert.equal(rate.unit, '%');

  const pmi = buildCalibrationFor('ISM Manufacturing PMI', 'pts', 49.5, 48.6);
  assert.equal(pmi.standardDeviationUnit, 1.0);
  assert.equal(pmi.unit, 'pts');
});

test('preset default: sigma turunan dari skala seri, ambang = 1x/2x sigma', () => {
  const unknown = buildCalibrationFor('Mystery Index Of Doom', '%', 100, 90);
  assert.equal(unknown.standardDeviationUnit, 2, '2% dari 100');
  assert.equal(unknown.moderateThreshold, 2);
  assert.equal(unknown.highImpactThreshold, 4);

  // Ambang event tetap menghasilkan z kuat >= 1.6 dan z moderat >= 0.5
  const fake = { calibration: unknown, impact: 'HIGH', title: 'Mystery Index Of Doom', unit: '%' };
  const t = thresholdsFor(fake, 'HIGH');
  assert.ok(t.zStrong >= 1.6 && t.zModerate >= 0.5);
});

test('kategori event tersimpan benar', () => {
  assert.equal(inferCategory('Non-Farm Payrolls'), 'LABOR');
  assert.equal(inferCategory('Core CPI y/y'), 'INFLATION');
  assert.equal(inferCategory('Fed Interest Rate Decision'), 'CENTRAL_BANK');
  assert.equal(inferCategory('Retail Sales m/m'), 'CONSUMER');
  assert.equal(inferCategory('ISM Manufacturing PMI'), 'MANUFACTURING');
  assert.equal(inferCategory('GDP q/q'), 'GROWTH');
});

test('affectedPairs hanya memakai instrumen yang tersedia', () => {
  const usd = affectedPairsFor('USD', AVAILABLE);
  assert.ok(usd.includes('EURUSD') && usd.includes('XAUUSD'));
  assert.ok(!usd.includes('EURGBP'), 'EURGBP tidak ada di data pasar');

  const restricted = affectedPairsFor('USD', ['EURUSD', 'USDJPY']);
  assert.deepEqual(restricted, ['EURUSD', 'USDJPY']);

  const eur = affectedPairsFor('EUR', AVAILABLE);
  assert.deepEqual(eur, ['EURUSD', 'EURJPY']);
});

test('parseCalendarEvents: importance, status, waktu, dan id deterministik', () => {
  const rows = [
    { Date: '2026-11-10T13:30:00Z', Event: 'Non-Farm Payrolls', Country: 'USD', Importance: 3, Forecast: '165K', Previous: '142K', Actual: '' },
    { Date: '2026-11-10T15:00:00Z', Event: 'Final Wholesale Inventories m/m', Country: 'USD', Importance: 1, Forecast: '0.6%', Previous: '0.6%', Actual: '' },
    { Date: '2026-11-10T09:00:00Z', Event: 'Industrial Production m/m', Country: 'CNY', Importance: 3, Forecast: '0.5%', Previous: '0.4%', Actual: '' }, // negara tak didukung
    { Date: 'not-a-date', Event: 'Broken', Country: 'USD', Importance: 2 },
    { Date: new Date(now - 48 * 3600 * 1000).toISOString(), Event: 'Old Event', Country: 'USD', Importance: 3, Forecast: '1%', Previous: '1%' }, // terlalu lama
    { Date: '2026-11-09T08:00:00Z', Event: 'Retail Sales m/m', Country: 'USD', Importance: 2, Forecast: '0.4%', Previous: '0.1%', Actual: '0.8%' } // sudah rilis + actual
  ];

  const events = parseCalendarEvents(rows, { now, available: AVAILABLE });
  assert.equal(events.length, 3, 'CNY & tanggal rusak & event lama dibuang');

  const nfp = events.find((e) => e.title === 'Non-Farm Payrolls');
  assert.ok(nfp);
  assert.equal(nfp.impact, 'HIGH');
  assert.equal(nfp.status, 'UPCOMING');
  assert.equal(nfp.forecast, 165);
  assert.equal(nfp.previous, 142);
  assert.equal(nfp.actual, null);
  assert.equal(nfp.unit, 'k');
  assert.equal(nfp.calibration.standardDeviationUnit, 30);
  assert.ok(nfp.affectedPairs.includes('XAUUSD'));
  assert.equal(nfp.preNewsScenarios.length, 3);
  assert.ok(Number.isFinite(Date.parse(nfp.scheduledTime)));

  const released = events.find((e) => e.title === 'Retail Sales m/m');
  assert.equal(released.status, 'RELEASED');
  assert.equal(released.actual, 0.8);
  assert.equal(released.impact, 'MEDIUM');
  assert.equal(released.unit, '%');

  // id deterministik untuk baris yang sama
  const again = parseCalendarEvents(rows, { now, available: AVAILABLE });
  assert.equal(again.find((e) => e.title === 'Non-Farm Payrolls').id, nfp.id);
});

test('skenario pre-news selalu berisi BULLISH/NEUTRAL/BEARISH dengan pair tersedia', () => {
  const rows = [{ Date: '2026-11-10T13:30:00Z', Event: 'Core CPI (MoM)', Country: 'USD', Importance: 3, Forecast: '0.3%', Previous: '0.3%' }];
  const [event] = parseCalendarEvents(rows, { now, available: AVAILABLE });
  assert.equal(event.preNewsScenarios.length, 3);
  const [bull, neutral, bear] = event.preNewsScenarios;
  assert.equal(bull.scenario, 'BULLISH');
  assert.equal(neutral.scenario, 'NEUTRAL');
  assert.equal(bear.scenario, 'BEARISH');
  for (const s of event.preNewsScenarios) {
    assert.ok(s.primaryPairs.length > 0, 'tiap skenario punya pair');
    assert.ok(AVAILABLE.includes(s.primaryPairs[0].pair), 'pair harus tersedia di data pasar');
    assert.ok(s.primaryPairs[0].stopLossPips > 0 && s.primaryPairs[0].targetPips > 0);
  }
  assert.match(bull.condition, /Actual >=/);
  assert.match(bear.condition, /Actual <=/);
});

test('buildPreNewsScenarios menangani forecast kosong', () => {
  const scen = buildPreNewsScenarios({
    currency: 'USD',
    forecast: null,
    previous: 100,
    calibration: { standardDeviationUnit: 10, unit: 'k', expectedVolatilityPips: { low: 20, moderate: 40, extreme: 80 } },
    affectedPairs: ['EURUSD']
  });
  assert.equal(scen.length, 3);
  assert.match(scen[0].condition, /Previous/);
});

// --- Regresi: jadwal harus sama dengan kalender riil (bukan event contoh) --------

test('pickEventSource: kalender riil menang, event contoh hanya saat kosong', () => {
  const real = [{ id: 'real-1', title: 'FOMC Member Bowman Speaks' }];
  const contoh = [{ id: 'demo-nfp', title: 'Non-Farm Employment Change (NFP)' }];

  assert.equal(pickEventSource(real, contoh).length, 1, 'event riil tidak boleh digabung dengan contoh');
  assert.equal(pickEventSource(real, contoh)[0].id, 'real-1');
  assert.deepEqual(pickEventSource([], contoh), contoh, 'contoh dipakai hanya bila kalender kosong');
  assert.deepEqual(pickEventSource([], []), []);
});

test('event yang jam rilisnya sudah lewat tetap tersimpan agar UI bisa menandai LEWAT', () => {
  const rows = [
    { Date: new Date(now - 2 * 86400000).toISOString(), Event: 'FOMC Member Bowman Speaks', Country: 'USD', Importance: 1 },
    { Date: new Date(now + 3 * 3600000).toISOString(), Event: 'Core CPI m/m', Country: 'USD', Importance: 3, Forecast: '0.2%', Previous: '0.3%' }
  ];
  const events = parseCalendarEvents(rows, { now, maxAgeHours: 168, available: AVAILABLE });

  assert.equal(events.length, 2, 'event lampau (dalam 168 jam) tetap ditampilkan');
  const lewat = events.find((e) => e.title === 'FOMC Member Bowman Speaks');
  const akanDatang = events.find((e) => e.title === 'Core CPI m/m');
  assert.ok(Date.parse(lewat.scheduledTime) < now, 'waktu rilis lampau harus di masa lalu');
  assert.ok(Date.parse(akanDatang.scheduledTime) > now);
  assert.equal(lewat.status, 'UPCOMING', 'tanpa Actual tetap UPCOMING; penanda LEWAT dihitung dari waktu');
  assert.ok(Date.parse(events[0].scheduledTime) <= Date.parse(events[1].scheduledTime), 'urut waktu');
});

test('data/calendar.json segar: jadwal dalam jendela mingguan, tanpa NFP fiktif', (t) => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'calendar.json');
  let rows;
  try {
    rows = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    t.skip('data/calendar.json tidak ada di checkout ini');
    return;
  }

  const nowMs = Date.now();
  const events = parseCalendarEvents(rows, { now: nowMs, maxAgeHours: 168, available: AVAILABLE });
  assert.ok(events.length > 0, 'kalender wajib punya event');

  for (const e of events) {
    const at = Date.parse(e.scheduledTime);
    assert.ok(Number.isFinite(at), `${e.title}: waktu tidak valid`);
    assert.ok(at > nowMs - 168 * 3600 * 1000, `${e.title} sudah basi (> 7 hari)`);
    assert.ok(at < nowMs + 168 * 3600 * 1000, `${e.title} terlalu jauh ke depan (> 7 hari)`);
  }

  // Event contoh (relatif terhadap jam load) tidak boleh bocor ke jadwal riil.
  const contohBocor = events.filter((e) =>
    ['usd-cpi-core-mom', 'usd-nfp-labor', 'fomc-rate-decision', 'eur-ecb-rate'].includes(e.id)
  );
  assert.equal(contohBocor.length, 0, 'id event contoh tidak boleh ada di hasil parse kalender');
});

test('skenario pre-news: arah pair tepat (base vs quote) & indikator invers terbalik', () => {
  const rows = [
    { Date: '2026-11-10T13:30:00Z', Event: 'Core CPI m/m', Country: 'USD', Importance: 3, Forecast: '0.3%', Previous: '0.3%' },
    { Date: '2026-11-10T13:30:00Z', Event: 'Unemployment Rate', Country: 'USD', Importance: 3, Forecast: '4.1%', Previous: '4.1%' }
  ];
  const [cpi, unemp] = parseCalendarEvents(rows, { now, available: AVAILABLE });

  const cpiBull = cpi.preNewsScenarios.find((s) => s.scenario === 'BULLISH');
  const cpiBear = cpi.preNewsScenarios.find((s) => s.scenario === 'BEARISH');
  assert.equal(cpiBull.primaryPairs.find((p) => p.pair === 'EURUSD').action, 'SELL', 'USD bullish harus SELL EURUSD');
  assert.equal(cpiBull.primaryPairs.find((p) => p.pair === 'USDJPY').action, 'BUY', 'USD bullish harus BUY USDJPY');
  assert.equal(cpiBull.primaryPairs.find((p) => p.pair === 'XAUUSD').action, 'SELL', 'USD bullish harus SELL XAUUSD');
  assert.equal(cpiBear.primaryPairs.find((p) => p.pair === 'EURUSD').action, 'BUY', 'USD bearish harus BUY EURUSD');

  const unempBull = unemp.preNewsScenarios.find((s) => s.scenario === 'BULLISH');
  const unempBear = unemp.preNewsScenarios.find((s) => s.scenario === 'BEARISH');
  assert.match(unempBull.condition, /Actual <=/, 'Unemployment rate turun = bullish untuk USD');
  assert.match(unempBear.condition, /Actual >=/, 'Unemployment rate naik = bearish untuk USD');
});
