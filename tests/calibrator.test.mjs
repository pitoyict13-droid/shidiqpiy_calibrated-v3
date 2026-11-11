// Unit test engine kalibrasi sinyal: arah pair, polaritas invers, ambang dari
// parameter event, fase rilis, gate impact, SL/TP + R:R, lot size, harga entry,
// dan konfirmasi reaksi harga pasca-rilis.
// Jalankan: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCalibration,
  evaluateSignal,
  buildPreNewsTicket,
  resolvePairAction,
  computeSurprise,
  thresholdsFor,
  signalPhase,
  sigmaScale,
  isInverseIndicator,
  preNewsEdge,
  reactionFromBars,
  expectedMoveForInstrument,
  volatilityRatio
} from '../src/utils/calibrator.ts';
import {
  INSTRUMENTS,
  normalizeSymbol,
  pipValuePerLot,
  buildUsdRates,
  getInstrument
} from '../src/utils/instruments.ts';

// --- Fixture ----------------------------------------------------------------------

const now = Date.parse('2026-11-09T12:00:00.000Z');

function makeEvent(overrides = {}) {
  return {
    id: 'test-event',
    title: 'Core CPI (MoM)',
    currency: 'USD',
    scheduledTime: new Date(now - 40 * 60000).toISOString(),
    releasedAt: new Date(now - 40 * 60000).toISOString(),
    status: 'RELEASED',
    impact: 'HIGH',
    forecast: 0.3,
    previous: 0.3,
    actual: 0.3,
    unit: '%',
    category: 'INFLATION',
    affectedPairs: ['EURUSD', 'USDJPY', 'XAUUSD'],
    calibration: {
      indicatorType: 'Core CPI MoM',
      standardDeviationUnit: 0.1,
      highImpactThreshold: 0.2,
      moderateThreshold: 0.1,
      unit: '%',
      expectedVolatilityPips: { low: 25, moderate: 50, extreme: 95 },
      liquiditySpreadBufferPips: 2.8,
      optimalExecutionWindow: 'T+60s to T+180s',
      invalidationTimeMinutes: 45
    },
    preNewsScenarios: [],
    ...overrides
  };
}

// Harga contoh: EURUSD 1.1140, USDJPY 158.50, XAUUSD 4072.10
const prices = {
  EURUSD: { symbol: 'EURUSD', bid: 1.11395, ask: 1.11405, mid: 1.114, spreadPips: 1, source: 'test' },
  USDJPY: { symbol: 'USDJPY', bid: 158.494, ask: 158.504, mid: 158.499, spreadPips: 1, source: 'test' },
  XAUUSD: { symbol: 'XAUUSD', bid: 4071.9, ask: 4072.2, mid: 4072.05, spreadPips: 3, source: 'test' },
  USDCAD: { symbol: 'USDCAD', bid: 1.413, ask: 1.4131, mid: 1.41305, spreadPips: 1, source: 'test' },
  GBPJPY: { symbol: 'GBPJPY', bid: 211.64, ask: 211.66, mid: 211.65, spreadPips: 2, source: 'test' },
  EURGBP: { symbol: 'EURGBP', bid: 0.8333, ask: 0.8335, mid: 0.8334, spreadPips: 2, source: 'test' },
  NAS100: { symbol: 'NAS100', bid: 26989, ask: 26991, mid: 26990, spreadPips: 1.5, source: 'test' },
  BTCUSD: { symbol: 'BTCUSD', bid: 75939, ask: 75941, mid: 75940, spreadPips: 4, source: 'test' }
};

// --- Polaritas, skala sigma, ambang ----------------------------------------------

test('indikator invers: Unemployment Rate membalik tanda deviasi', () => {
  const ev = makeEvent({ title: 'Unemployment Rate', calibration: { ...makeEvent().calibration, indicatorType: 'Unemployment Rate', standardDeviationUnit: 0.2, moderateThreshold: 0.2, highImpactThreshold: 0.3 } });
  assert.equal(isInverseIndicator(ev), true);
  const s = computeSurprise(ev, 4.4, 4.2, 4.1);
  assert.ok(s.rawDeviation > 0, 'deviasi mentah positif');
  assert.ok(s.signedDeviation < 0, 'deviasi bertanda negatif (USD melemah)');
  assert.ok(s.zScore < 0);
});

test('keputusan suku bunga: selisih % dikonversi ke bps (z bukan ~0 lagi)', () => {
  const ev = makeEvent({
    title: 'Fed Interest Rate Decision',
    forecast: 4.75,
    previous: 5.0,
    actual: 5.0, // +25bp surprise
    unit: '%',
    calibration: { ...makeEvent().calibration, standardDeviationUnit: 25, moderateThreshold: 25, highImpactThreshold: 25 }
  });
  assert.equal(sigmaScale(ev), 100, 'unit % dengan sigma >= 1 = sigma dalam bps');
  const s = computeSurprise(ev, 5.0, 4.75, 5.0);
  assert.ok(Math.abs(s.zScore - 1.0) < 1e-6, `z harus 1.0, dapat ${s.zScore}`);
  const cal = calculateCalibration({ event: ev, actual: 5.0, now });
  assert.notEqual(cal.bias, 'NEUTRAL', 'surprise 25bp harus memberi bias, bukan netral');
});

test('ambang z diambil dari parameter event (bukan hardcode 1.6/0.5)', () => {
  const nfp = makeEvent({
    title: 'Non-Farm Employment Change (NFP)',
    unit: 'k',
    forecast: 165,
    previous: 142,
    calibration: { ...makeEvent().calibration, standardDeviationUnit: 30, highImpactThreshold: 60, moderateThreshold: 35, unit: 'k' }
  });
  const t = thresholdsFor(nfp, 'HIGH');
  assert.ok(Math.abs(t.zStrong - 2.0) < 1e-6, `zStrong harus 60/30 = 2.0, dapat ${t.zStrong}`);
  assert.ok(Math.abs(t.zModerate - 35 / 30) < 0.001, `zModerate harus 35/30, dapat ${t.zModerate}`);

  // Event medium impact mengetatkan ambang +0.2sigma
  const tMed = thresholdsFor(nfp, 'MEDIUM');
  assert.ok(tMed.zStrong > t.zStrong && tMed.zModerate > t.zModerate);
});

// --- Arah per instrumen ------------------------------------------------------------

function usdBearishEvent(impact = 'HIGH') {
  // CPI inline forecast 0.3, actual 0.5 => +0.2 => z = +2.0 (USD bullish)
  return makeEvent({ actual: 0.5, impact });
}

test('event USD bullish memetakan seluruh pair dengan benar', () => {
  const ev = usdBearishEvent();
  const cal = calculateCalibration({ event: ev, actual: 0.5, now });
  assert.equal(cal.bias, 'STRONG_BUY');

  const cases = [
    ['EURUSD', 'SELL'], // quote USD menguat -> pair turun
    ['GBPUSD', 'SELL'],
    ['USDJPY', 'BUY'], // base USD menguat -> pair naik
    ['USDCHF', 'BUY'],
    ['USDCAD', 'BUY'],
    ['XAUUSD', 'SELL'], // emas berlawanan USD
    ['BTCUSD', 'SELL'] // kripto aset risk, tertekan USD kuat
  ];
  for (const [pair, expected] of cases) {
    const dir = resolvePairAction(ev, pair, cal.normalizedZScore, cal.zModerate);
    assert.equal(dir.action, expected, `${pair}: ${dir.action} != ${expected} (${dir.reason})`);
  }
});

test('index mengikuti kategori event: inflasi/kebijakan vs pertumbuhan', () => {
  const inflation = makeEvent({ actual: 0.5, category: 'INFLATION' }); // USD kuat
  const calInf = calculateCalibration({ event: inflation, actual: 0.5, now });
  assert.equal(resolvePairAction(inflation, 'NAS100', calInf.normalizedZScore, calInf.zModerate).action, 'SELL');

  const labor = makeEvent({
    title: 'Non-Farm Employment Change',
    unit: 'k',
    forecast: 165,
    previous: 142,
    actual: 230, // beat besar (+65k = 2.17sigma) -> risk-on
    category: 'LABOR',
    calibration: { ...makeEvent().calibration, standardDeviationUnit: 30, highImpactThreshold: 60, moderateThreshold: 35, unit: 'k' }
  });
  const calLab = calculateCalibration({ event: labor, actual: 230, now });
  assert.equal(calLab.bias, 'STRONG_BUY');
  assert.equal(resolvePairAction(labor, 'NAS100', calLab.normalizedZScore, calLab.zModerate).action, 'BUY');
});

test('event non-USD hanya men-trade pair yang menjadi kakinya', () => {
  const eur = makeEvent({ currency: 'EUR', title: 'German Factory Orders', actual: 0.4 });
  const cal = calculateCalibration({ event: eur, actual: 0.4, now });
  assert.equal(resolvePairAction(eur, 'EURUSD', cal.normalizedZScore, cal.zModerate).action, 'BUY');
  assert.equal(resolvePairAction(eur, 'EURJPY', cal.normalizedZScore, cal.zModerate).action, 'BUY');
  assert.equal(resolvePairAction(eur, 'GBPJPY', cal.normalizedZScore, cal.zModerate).action, 'NONE', 'EUR bukan kaki GBP/JPY');
  // EURGBP tidak punya harga di data pasar -> memang tidak boleh ditradingkan
  const unavailable = resolvePairAction(eur, 'EURGBP', cal.normalizedZScore, cal.zModerate);
  assert.equal(unavailable.action, 'NONE');
  assert.match(unavailable.reason, /tidak tersedia di data pasar/i);
});

test('event USD pada instrumen di luar data pasar -> NONE', () => {
  const ev = usdBearishEvent();
  const cal = calculateCalibration({ event: ev, actual: 0.5, now });
  const dir = resolvePairAction(ev, 'EURGBP', cal.normalizedZScore, cal.zModerate);
  assert.equal(dir.action, 'NONE');
  assert.match(dir.reason, /tidak tersedia di data pasar/i);
});

test('event USD pada cross ber-JPY mengikuti pelemahan JPY', () => {
  const ev = usdBearishEvent();
  const cal = calculateCalibration({ event: ev, actual: 0.5, now });
  assert.equal(resolvePairAction(ev, 'GBPJPY', cal.normalizedZScore, cal.zModerate).action, 'BUY');
});

test('deviasi di bawah ambang -> NEUTRAL / NONE', () => {
  const ev = makeEvent({ actual: 0.3 }); // z = 0
  const cal = calculateCalibration({ event: ev, actual: 0.3, now });
  assert.equal(cal.bias, 'NEUTRAL');
  assert.equal(resolvePairAction(ev, 'EURUSD', cal.normalizedZScore, cal.zModerate).action, 'NONE');
  assert.equal(cal.tradable, false);
  assert.match(cal.gateReason, /ambang/i);
});

test('edge pre-news memakai Forecast vs Previous dengan polaritas sama', () => {
  const direct = makeEvent({ forecast: 0.4, previous: 0.2 });
  assert.ok(preNewsEdge(direct) > 0);

  const inverse = makeEvent({ title: 'Unemployment Rate', forecast: 4.5, previous: 4.2 });
  assert.ok(preNewsEdge(inverse) < 0, 'forecast pengangguran naik = USD bearish');
});

// --- Fase rilis & gate --------------------------------------------------------------

test('fase sinyal: COOLDOWN (T<60s) -> ACTIVE (T>=1m) -> EXPIRED mengikuti waktu rilis', () => {
  const ev = makeEvent();
  const rel = Date.parse(ev.releasedAt);

  const cooldown = signalPhase(ev, rel + 30 * 1000);
  assert.equal(cooldown.phase, 'COOLDOWN');

  const active = signalPhase(ev, rel + 5 * 60000);
  assert.equal(active.phase, 'ACTIVE');

  const expired = signalPhase(ev, rel + 90 * 60000);
  assert.equal(expired.phase, 'EXPIRED');
});

test('belum rilis -> PRE_RELEASE tanpa menit sejak rilis', () => {
  const ev = makeEvent({ status: 'UPCOMING', actual: null, releasedAt: undefined, scheduledTime: new Date(now + 60000).toISOString() });
  const phase = signalPhase(ev, now);
  assert.equal(phase.phase, 'PRE_RELEASE');
  assert.equal(phase.minutesSinceRelease, null);
});

test('gate: impact LOW tidak pernah tradable walau z besar', () => {
  const ev = makeEvent({ impact: 'LOW', actual: 0.6 }); // z = +3
  const cal = calculateCalibration({ event: ev, actual: 0.6, now });
  assert.equal(cal.bias, 'STRONG_BUY');
  assert.equal(cal.tradable, false);
  assert.match(cal.gateReason, /LOW/);
});

test('gate: cooldown (< 60 detik) memblokir eksekusi sekalipun arah jelas', () => {
  const ev = makeEvent({ actual: 0.5 });
  const recent = { ...ev, releasedAt: new Date(now - 30 * 1000).toISOString() };
  const cal = calculateCalibration({ event: recent, actual: 0.5, now });
  assert.equal(cal.phase, 'COOLDOWN');
  assert.equal(cal.tradable, false);
  assert.match(cal.gateReason, /Cooldown/i);
});

test('gate: jendela ACTIVE menghasilkan sinyal tradable + harga valid', () => {
  const ev = makeEvent({ actual: 0.5 });
  const { calibration, ticket } = evaluateSignal({
    event: ev,
    actual: 0.5,
    pair: 'EURUSD',
    quote: prices.EURUSD,
    prices,
    now,
    accountBalance: 10000,
    riskPercent: 1
  });
  assert.equal(calibration.phase, 'ACTIVE');
  assert.equal(calibration.tradable, true);
  assert.equal(ticket.tradable, true);
  assert.equal(ticket.action, 'SELL');
  assert.ok(Number.isFinite(ticket.entryPrice));
});

// --- SL/TP, volatilitas, ukuran lot ------------------------------------------------

function activeEval(pair, overrides = {}, balance = 10000, risk = 1) {
  const ev = makeEvent({ actual: 0.5, ...overrides });
  return evaluateSignal({
    event: ev,
    actual: 0.5,
    pair,
    quote: prices[pair],
    prices,
    now,
    accountBalance: balance,
    riskPercent: risk
  });
}

test('SL/TP konsisten R:R 1:1.5 / 1:2.8 dan entry memakai harga pasar', () => {
  const { ticket } = activeEval('EURUSD');
  assert.equal(ticket.action, 'SELL');
  // SELL memakai bid
  assert.equal(ticket.entryPrice, prices.EURUSD.bid);
  assert.ok(ticket.slPrice > ticket.entryPrice, 'SL sell di atas entry');
  assert.ok(ticket.tp1Price < ticket.entryPrice && ticket.tp2Price < ticket.entryPrice);
  assert.equal(ticket.tp1Pips, Math.round(ticket.slPips * 1.5));
  assert.equal(ticket.tp2Pips, Math.round(ticket.slPips * 2.8));
  assert.ok(ticket.slPips >= getInstrument('EURUSD').minSlPips, 'SL tidak di bawah minimum kelas');
});

test('BUY memakai ask, dan jarak price -> pip memakai pipSize instrumen', () => {
  const ev = makeEvent({ actual: 0.1 }); // z = -2 -> USD bearish -> EURUSD BUY
  const { ticket } = evaluateSignal({ event: ev, actual: 0.1, pair: 'EURUSD', quote: prices.EURUSD, prices, now });
  assert.equal(ticket.action, 'BUY');
  assert.equal(ticket.entryPrice, prices.EURUSD.ask);
  const expectedSl = Number((ticket.entryPrice - ticket.slPips * 0.0001).toFixed(5));
  assert.equal(ticket.slPrice, expectedSl);
});

test('logam: minimum SL emas $3 (30 pip) dan pip = 0.1', () => {
  const { ticket } = activeEval('XAUUSD');
  assert.ok(ticket.slPips >= 30, `SL emas ${ticket.slPips} < 30 pip`);
  const inst = getInstrument('XAUUSD');
  const expectedSl = Number((ticket.entryPrice + ticket.slPips * inst.pipSize).toFixed(2)); // SELL
  assert.equal(ticket.slPrice, expectedSl);
  assert.equal(ticket.pipUnit, 'pips');
});

test('index/crypto memakai titik (pts) dengan SL minimum % harga', () => {
  const nas = activeEval('NAS100');
  assert.equal(nas.ticket.pipUnit, 'pts');
  assert.ok(nas.ticket.slPips >= getInstrument('NAS100').minSlPips);

  const btc = activeEval('BTCUSD');
  assert.equal(btc.ticket.pipUnit, 'pts');
  const minPts = Math.ceil(getInstrument('BTCUSD').minSlPct * prices.BTCUSD.mid);
  assert.ok(btc.ticket.slPips >= minPts, `SL BTC ${btc.ticket.slPips} < ${minPts}`);
});

test('lot size memakai nilai pip per instrumen, bukan asumsi $10', () => {
  const risk = 100; // 1% dari 10000
  const eurusd = activeEval('EURUSD', {}, 10000, 1).ticket;
  const expectEur = risk / (eurusd.slPips * pipValuePerLot(INSTRUMENTS.EURUSD, prices.EURUSD.mid, buildUsdRates({})));
  assert.ok(Math.abs(eurusd.lots - Number(expectEur.toFixed(2))) < 0.01, `${eurusd.lots} vs ${expectEur}`);

  const usdjpy = activeEval('USDJPY', {}, 10000, 1).ticket;
  const rates = buildUsdRates({ USDJPY: prices.USDJPY.mid, EURUSD: prices.EURUSD.mid });
  const pipJpy = pipValuePerLot(INSTRUMENTS.USDJPY, prices.USDJPY.mid, rates);
  assert.ok(pipJpy < 10, `nilai pip USDJPY harus < $10 (JPY), dapat ${pipJpy}`);
  const expectJpy = risk / (usdjpy.slPips * pipJpy);
  assert.ok(Math.abs(usdjpy.lots - Number(expectJpy.toFixed(2))) < 0.01);
  assert.notEqual(usdjpy.lots, eurusd.lots, 'lot harus berbeda antar pair');
});

test('konversi kurs USD untuk pair cross', () => {
  const rates = buildUsdRates({ EURUSD: 1.114, GBPUSD: 1.345, USDJPY: 158.5, USDCAD: 1.413, USDCHF: 0.821 });
  assert.ok(Math.abs(rates.JPY - 1 / 158.5) < 1e-9);
  assert.ok(Math.abs(rates.CAD - 1 / 1.413) < 1e-9);
  assert.ok(Math.abs(rates.EUR - 1.114) < 1e-9);
  // GBPJPY: 1000 JPY per pip dikonversi ke USD
  const gbpjpy = pipValuePerLot(INSTRUMENTS.GBPJPY, 211.65, rates);
  assert.ok(Math.abs(gbpjpy - 1000 / 158.5) < 0.01);
});

// --- Volatilitas terealisasi & proyeksi per instrumen ------------------------------

function barsAround(releaseMs, closes) {
  // bar 1 menit: bar pertama <= release, sisanya tersebar di window reaksi
  const bars = [];
  bars.push({ k: Math.floor(releaseMs / 60000) - 1, o: closes[0], h: closes[0], l: closes[0], c: closes[0] });
  closes.forEach((c, i) => {
    const k = Math.floor(releaseMs / 60000) + 15 + i * 5;
    bars.push({ k, o: c, h: c, l: c, c });
  });
  return bars;
}

test('reaksi harga pasca-rilis: bar 15-45 menit setelah rilis', () => {
  const rel = now;
  const rising = barsAround(rel, [1.1, 1.102, 1.105, 1.108]);
  const r = reactionFromBars(rising, rel);
  assert.ok(r, 'reaksi terukur');
  assert.equal(r.dir, 'long');
  assert.ok(r.movePct > 0.05);
  assert.ok(r.minutes >= 15 && r.minutes <= 45);

  const flat = barsAround(rel, [1.1, 1.1, 1.1, 1.1]);
  assert.equal(reactionFromBars(flat, rel).dir, null, 'gerakan < 0.05% dianggap datar');
  assert.equal(reactionFromBars(rising, rel - 3600 * 1000 * 24), null, 'tanpa bar dekat rilis -> null');
});

test('reaksi harga berlawanan dengan fundamental -> sinyal mengikuti harga', () => {
  const ev = makeEvent({ actual: 0.5 }); // z +2 -> USD kuat -> EURUSD SELL
  const rel = Date.parse(ev.releasedAt);
  // Tapi harga EURUSD naik tajam pasca rilis -> konflik, harga menang
  const rising = barsAround(rel, [1.114, 1.116, 1.119, 1.122]);
  const { ticket } = evaluateSignal({
    event: ev,
    actual: 0.5,
    pair: 'EURUSD',
    quote: prices.EURUSD,
    prices,
    bars: rising,
    now: rel + 30 * 60000
  });
  assert.equal(ticket.action, 'BUY', 'arah mengikuti harga, bukan fundamental');
  assert.equal(ticket.via, 'price-reaction');
  assert.match(ticket.directionReason, /berlawanan/i);
});

test('reaksi searah memperkuat sinyal (via + reaction)', () => {
  const ev = makeEvent({ actual: 0.5 });
  const rel = Date.parse(ev.releasedAt);
  const falling = barsAround(rel, [1.114, 1.112, 1.109, 1.106]);
  const { ticket } = evaluateSignal({
    event: ev,
    actual: 0.5,
    pair: 'EURUSD',
    quote: prices.EURUSD,
    prices,
    bars: falling,
    now: rel + 30 * 60000
  });
  assert.equal(ticket.action, 'SELL');
  assert.match(ticket.via, /\+reaction$/);
});

test('volatilitas terealisasi menggeser proyeksi tapi dibatasi 0.7 - 1.5', () => {
  const inst = INSTRUMENTS.EURUSD;
  const quiet = Array.from({ length: 60 }, (_, i) => ({ k: i, o: 1.1, h: 1.10004, l: 1.09996, c: 1.1 }));
  assert.equal(volatilityRatio(inst, quiet), 0.7, 'range jauh di bawah baseline -> dibatasi 0.7');
  const wild = Array.from({ length: 60 }, (_, i) => ({ k: i, o: 1.1, h: 1.1001, l: 1.0999, c: 1.1 }));
  assert.equal(volatilityRatio(inst, wild), 1.5, 'range jauh di atas baseline -> dibatasi 1.5');
  assert.equal(volatilityRatio(inst, undefined), 1, 'tanpa bar -> netral');

  // Proyeksi per instrumen konsisten dengan gerakan % yang sama
  const eur = expectedMoveForInstrument({ inst, basePips: 75, mid: 1.114, impact: 'HIGH' });
  const jpy = expectedMoveForInstrument({ inst: INSTRUMENTS.USDJPY, basePips: 75, mid: 158.5, impact: 'HIGH' });
  assert.ok(Math.abs(eur.pips - 75) <= 3, `EURUSD ~75 pip, dapat ${eur.pips}`);
  assert.ok(jpy.pips > 90, `USDJPY pip lebih banyak untuk gerakan % sama, dapat ${jpy.pips}`);
  assert.ok(Math.abs(eur.pct - jpy.pct) < 1e-6, 'persentase gerakan harus identik');
});

test('impact mengecilkan proyeksi volatilitas (HIGH > MEDIUM > LOW)', () => {
  const inst = INSTRUMENTS.EURUSD;
  const hi = expectedMoveForInstrument({ inst, basePips: 75, mid: 1.114, impact: 'HIGH' });
  const md = expectedMoveForInstrument({ inst, basePips: 75, mid: 1.114, impact: 'MEDIUM' });
  const lo = expectedMoveForInstrument({ inst, basePips: 75, mid: 1.114, impact: 'LOW' });
  assert.ok(hi.pips > md.pips && md.pips > lo.pips);
});

// --- Instrumen ----------------------------------------------------------------------

test('registry instrumen & normalisasi simbol', () => {
  assert.equal(normalizeSymbol('EUR/USD'), 'EURUSD');
  assert.equal(normalizeSymbol('xau-usd'), 'XAUUSD');
  assert.ok(getInstrument('NAS100'));
  assert.equal(getInstrument('DXY'), null, 'simbol di luar data pasar tidak dikenal');
});

test('nilai pip: EURUSD $10, USDJPY ~$6.3, emas $10, index $1/pt', () => {
  const rates = buildUsdRates({ EURUSD: 1.114, USDJPY: 158.5, USDCAD: 1.413, USDCHF: 0.821 });
  assert.equal(pipValuePerLot(INSTRUMENTS.EURUSD, 1.114, rates), 10);
  assert.ok(Math.abs(pipValuePerLot(INSTRUMENTS.USDJPY, 158.5, rates) - 1000 / 158.5) < 0.01);
  assert.ok(Math.abs(pipValuePerLot(INSTRUMENTS.USDCAD, 1.413, rates) - 10 / 1.413) < 0.01);
  assert.equal(pipValuePerLot(INSTRUMENTS.XAUUSD, 4072, rates), 10);
  assert.equal(pipValuePerLot(INSTRUMENTS.NAS100, 26990, rates), 1);
  assert.equal(pipValuePerLot(INSTRUMENTS.BTCUSD, 75940, rates), 1);
});

test('pra-news: tiket pra-rilis menghasilkan arah valid, pullback FVG, dan Straddle OCO', () => {
  // Forecast 0.4% vs Previous 0.2% (sigma 0.1%) -> +2.0σ bullish USD
  const ev = makeEvent({
    status: 'UPCOMING',
    actual: null,
    releasedAt: undefined,
    scheduledTime: new Date(now + 30 * 60000).toISOString(),
    forecast: 0.4,
    previous: 0.2
  });

  const eurTicket = buildPreNewsTicket({ event: ev, pair: 'EURUSD', quote: prices.EURUSD, prices, now });
  assert.equal(eurTicket.tradable, true);
  assert.equal(eurTicket.action, 'SELL', 'USD bullish pra-news harus SELL EURUSD');
  assert.ok(eurTicket.pullbackEntryPrice > eurTicket.entryPrice, 'Limit FVG SELL harus di atas market entry');
  assert.equal(eurTicket.straddle, null, 'sinyal 1 harga BUY/SELL tidak boleh memunculkan Straddle OCO');

  const jpyTicket = buildPreNewsTicket({ event: ev, pair: 'USDJPY', quote: prices.USDJPY, prices, now });
  assert.equal(jpyTicket.tradable, true);
  assert.equal(jpyTicket.action, 'BUY', 'USD bullish pra-news harus BUY USDJPY');
  assert.ok(jpyTicket.pullbackEntryPrice < jpyTicket.entryPrice, 'Limit FVG BUY harus di bawah market entry');
  assert.equal(jpyTicket.straddle, null, 'sinyal 1 harga BUY/SELL tidak boleh memunculkan Straddle OCO');

  // Forecast == Previous tanpa sentimen pasar -> fallback Straddle OCO (action NONE)
  const neutralEv = makeEvent({
    status: 'UPCOMING',
    actual: null,
    releasedAt: undefined,
    scheduledTime: new Date(now + 30 * 60000).toISOString(),
    forecast: 0.3,
    previous: 0.3
  });
  const neutralTicket = buildPreNewsTicket({ event: neutralEv, pair: 'EURUSD', quote: prices.EURUSD, prices, now });
  assert.equal(neutralTicket.tradable, false);
  assert.equal(neutralTicket.action, 'NONE');
  assert.ok(neutralTicket.straddle !== null, 'event netral tanpa sentimen tetap punya fallback Straddle OCO');

  // Forecast == Previous TETAPI sentimen pasar jelas (+0.45% harian) -> 1 harga BUY + SL/TP, straddle null
  const bullQuote = { ...prices.EURUSD, changePct: 0.45 };
  const sentimentPre = buildPreNewsTicket({ event: neutralEv, pair: 'EURUSD', quote: bullQuote, prices, now });
  assert.equal(sentimentPre.tradable, true, 'sentimen pasar bullish harus menghasilkan sinyal siap pakai');
  assert.equal(sentimentPre.action, 'BUY');
  assert.equal(sentimentPre.via, 'market-sentiment');
  assert.ok(Number.isFinite(sentimentPre.entryPrice) && sentimentPre.slPrice < sentimentPre.entryPrice);
  assert.ok(sentimentPre.tp1Price > sentimentPre.entryPrice && sentimentPre.tp2Price > sentimentPre.tp1Price);
  assert.equal(sentimentPre.straddle, null, 'bila sentimen pasar memberi arah BUY/SELL, straddle wajib null');

  // Pasca-rilis ACTIVE dengan Actual inline tetapi sentimen pasar bearish (-0.4%) -> 1 harga SELL + SL/TP, straddle null
  const activeInlineEv = makeEvent({
    status: 'RELEASED',
    actual: 0.3,
    forecast: 0.3,
    previous: 0.2,
    releasedAt: new Date(now - 5 * 60000).toISOString()
  });
  const bearQuote = { ...prices.EURUSD, changePct: -0.4 };
  const activeSentimentEval = evaluateSignal({
    event: activeInlineEv,
    actual: 0.3,
    forecast: 0.3,
    previous: 0.2,
    pair: 'EURUSD',
    quote: bearQuote,
    prices,
    now
  });
  assert.equal(activeSentimentEval.ticket.tradable, true);
  assert.equal(activeSentimentEval.ticket.action, 'SELL');
  assert.equal(activeSentimentEval.ticket.via, 'market-sentiment');
  assert.equal(activeSentimentEval.ticket.straddle, null);

  // Konflik sentimen harian (+0.5%) vs intraday bar (-0.3%) -> tetap netral (NONE)
  const conflictingBars = [
    { k: Math.floor((now - 30 * 60000) / 60000), o: 1.105, h: 1.106, l: 1.104, c: 1.105 },
    { k: Math.floor((now - 5 * 60000) / 60000), o: 1.102, h: 1.103, l: 1.100, c: 1.101 }
  ];
  const conflictTicket = buildPreNewsTicket({
    event: neutralEv,
    pair: 'EURUSD',
    quote: bullQuote,
    prices,
    bars: conflictingBars,
    now
  });
  assert.equal(conflictTicket.action, 'NONE', 'konflik sentimen harian vs intraday harus menahan diri');
  assert.equal(conflictTicket.tradable, false);

  // XAUUSD tanpa changePct sendiri (0/kosong) tetapi basket USD menguat -> SELL XAUUSD (1 harga)
  const usdStrongPrices = {
    ...prices,
    XAUUSD: { ...prices.XAUUSD, changePct: 0 },
    EURUSD: { ...prices.EURUSD, changePct: -0.15 },
    GBPUSD: { ...prices.GBPUSD, changePct: -0.14 },
    USDJPY: { ...prices.USDJPY, changePct: 0.12 },
    USDCHF: { ...prices.USDCHF, changePct: 0.25 }
  };
  const xauBasketTicket = buildPreNewsTicket({
    event: neutralEv,
    pair: 'XAUUSD',
    quote: usdStrongPrices.XAUUSD,
    prices: usdStrongPrices,
    now
  });
  assert.equal(xauBasketTicket.tradable, true, 'XAUUSD harus muncul lewat sentimen basket USD');
  assert.equal(xauBasketTicket.action, 'SELL', 'USD menguat -> SELL XAUUSD');
  assert.equal(xauBasketTicket.via, 'market-sentiment');
  assert.equal(xauBasketTicket.straddle, null);
});
