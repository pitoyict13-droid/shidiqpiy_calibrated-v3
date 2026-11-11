// Unit & SSR tests untuk evaluasi winrate sinyal, deteksi fake vs profit per pair,
// evaluator cron Node (.mjs), serta render UI PascaNewsArchive.
// Jalankan: node --import tsx --test tests/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  evaluateSignalAgainstBars,
  evaluateSignalAgainstReaction,
  summarizeWinrate,
  syncAndEvaluateHistory
} from '../src/utils/winrateStats.ts';
import { PascaNewsArchive } from '../src/components/PascaNewsArchive.tsx';
import { parseCalendarEvents } from '../src/utils/calendar.ts';
import { evaluatePendingHistory } from '../scripts/fetch-calendar.mjs';

function makeRecord(overrides = {}) {
  return {
    id: 'ev-1::XAUUSD::PRE_NEWS',
    eventId: 'ev-1',
    eventTitle: 'Core CPI m/m',
    currency: 'USD',
    impact: 'HIGH',
    scheduledTime: '2026-11-11T13:30:00.000Z',
    pair: 'XAUUSD',
    display: 'XAU/USD',
    action: 'BUY',
    signalType: 'PRE_NEWS',
    via: 'sentiment',
    entryPrice: 4000,
    slPrice: 3990,
    tp1Price: 4015,
    tp2Price: 4028,
    digits: 2,
    pipUnit: 'pips',
    createdAt: '2026-11-11T13:00:00.000Z',
    outcome: 'PENDING',
    pipsResult: 0,
    rMultiple: 0,
    evaluationNote: 'Menunggu pergerakan pasar',
    source: 'pending',
    ...overrides
  };
}

const kMin = (iso) => Math.floor(Date.parse(iso) / 60000);

test('evaluateSignalAgainstBars mendeteksi WIN_TP2, WIN_TP1, FAKE_REVERSAL, dan LOSS_SL', () => {
  const rec = makeRecord();

  // Skenario 1: TP2 tercapai penuh
  const tp2Res = evaluateSignalAgainstBars(rec, [
    { k: kMin('2026-11-11T13:05:00.000Z'), o: 4000, h: 4018, l: 3998, c: 4016 },
    { k: kMin('2026-11-11T13:12:00.000Z'), o: 4016, h: 4030, l: 4014, c: 4029 }
  ]);
  assert.equal(tp2Res?.outcome, 'WIN_TP2');
  assert.equal(tp2Res?.rMultiple, 2.8);
  assert.ok((tp2Res?.pipsResult ?? 0) > 0);

  // Skenario 2: Kena TP1 dulu lalu retrace ke SL -> masih dihitung WIN_TP1
  const tp1Res = evaluateSignalAgainstBars(rec, [
    { k: kMin('2026-11-11T13:04:00.000Z'), o: 4000, h: 4016, l: 3999, c: 4015 },
    { k: kMin('2026-11-11T13:20:00.000Z'), o: 4015, h: 4015, l: 3989, c: 3990 }
  ]);
  assert.equal(tp1Res?.outcome, 'WIN_TP1');

  // Skenario 3: SL tersentuh dalam <= 15 menit -> FAKE_REVERSAL
  const fakeRes = evaluateSignalAgainstBars(rec, [
    { k: kMin('2026-11-11T13:06:00.000Z'), o: 4000, h: 4003, l: 3988, c: 3989 }
  ]);
  assert.equal(fakeRes?.outcome, 'FAKE_REVERSAL');
  assert.equal(fakeRes?.rMultiple, -1);

  // Skenario 4: SL tersentuh setelah > 15 menit -> LOSS_SL
  const lossRes = evaluateSignalAgainstBars(rec, [
    { k: kMin('2026-11-11T13:25:00.000Z'), o: 4000, h: 4002, l: 3989, c: 3990 }
  ]);
  assert.equal(lossRes?.outcome, 'LOSS_SL');
});

test('evaluateSignalAgainstReaction membedakan PROFIT_MOVE vs FAKE_REVERSAL', () => {
  const buyRec = makeRecord({ pair: 'EURUSD', display: 'EUR/USD', action: 'BUY', entryPrice: 1.1, slPrice: 1.098, tp1Price: 1.103, tp2Price: 1.1056 });
  const reactionEvents = {
    '2026-11-11T13:30:00.000Z|Core CPI m/m': {
      releasedAt: '2026-11-11T13:30:00.000Z',
      pairs: {
        'EUR/USD': { baseClose: 1.1, lastClose: 1.1045, movePct: 0.41, dir: 'long', minutes: 45 },
        'USD/CHF': { baseClose: 0.88, lastClose: 0.876, movePct: -0.45, dir: 'short', minutes: 45 }
      }
    }
  };

  const profitRes = evaluateSignalAgainstReaction(buyRec, reactionEvents);
  assert.equal(profitRes?.outcome, 'PROFIT_MOVE');
  assert.equal(profitRes?.source, 'reaction-feed');
  assert.ok((profitRes?.pipsResult ?? 0) > 0);

  const fakeRec = makeRecord({ id: 'ev-1::USDCHF::PRE_NEWS', pair: 'USDCHF', display: 'USD/CHF', action: 'BUY', entryPrice: 0.88, slPrice: 0.878, tp1Price: 0.883, tp2Price: 0.8856 });
  const fakeRes = evaluateSignalAgainstReaction(fakeRec, reactionEvents);
  assert.equal(fakeRes?.outcome, 'FAKE_REVERSAL');
  assert.ok((fakeRes?.rMultiple ?? 0) < 0);
});

test('summarizeWinrate mengklasifikasikan pair PROFITABLE vs RAWAN_FAKE dengan benar', () => {
  const records = [
    makeRecord({ id: '1', pair: 'XAUUSD', display: 'XAU/USD', outcome: 'WIN_TP2', pipsResult: 280, rMultiple: 2.8 }),
    makeRecord({ id: '2', pair: 'XAUUSD', display: 'XAU/USD', outcome: 'WIN_TP1', pipsResult: 150, rMultiple: 1.5 }),
    makeRecord({ id: '3', pair: 'USDCHF', display: 'USD/CHF', outcome: 'FAKE_REVERSAL', pipsResult: -20, rMultiple: -1 }),
    makeRecord({ id: '4', pair: 'USDCHF', display: 'USD/CHF', outcome: 'LOSS_SL', pipsResult: -20, rMultiple: -1 }),
    makeRecord({ id: '5', pair: 'EURUSD', display: 'EUR/USD', outcome: 'PENDING', pipsResult: 0, rMultiple: 0 })
  ];

  const summary = summarizeWinrate(records);
  assert.equal(summary.overall.total, 5);
  assert.equal(summary.overall.evaluated, 4);
  assert.equal(summary.overall.wins, 2);
  assert.equal(summary.overall.losses, 2);
  assert.equal(summary.overall.fakeSignals, 1);
  assert.equal(summary.overall.winratePct, 50);

  const xau = summary.byPair.find((p) => p.pair === 'XAUUSD');
  const chf = summary.byPair.find((p) => p.pair === 'USDCHF');
  assert.equal(xau?.verdict, 'PROFITABLE');
  assert.equal(xau?.winratePct, 100);
  assert.equal(chf?.verdict, 'RAWAN_FAKE');
  assert.equal(chf?.winratePct, 0);
});

test('syncAndEvaluateHistory mencatat tiket aktif dari event & mengevaluasi PENDING record', () => {
  const now = Date.parse('2026-11-11T13:20:00.000Z');
  const events = parseCalendarEvents([
    {
      Date: '2026-11-11T14:00:00.000Z',
      Event: 'CPI m/m',
      Country: 'USD',
      Importance: 3,
      Forecast: '0.2%',
      Previous: '0.2%'
    }
  ]);
  const prices = {
    XAUUSD: { symbol: 'XAUUSD', bid: 4000, ask: 4000.5, mid: 4000.25, spreadPips: 5, changePct: -0.4, source: 'test' },
    EURUSD: { symbol: 'EURUSD', bid: 1.1, ask: 1.1002, mid: 1.1001, spreadPips: 1.5, changePct: 0.35, source: 'test' },
    GBPUSD: { symbol: 'GBPUSD', bid: 1.3, ask: 1.3002, mid: 1.3001, spreadPips: 1.5, changePct: 0.3, source: 'test' },
    USDJPY: { symbol: 'USDJPY', bid: 150, ask: 150.02, mid: 150.01, spreadPips: 1.5, changePct: -0.35, source: 'test' }
  };
  const pending = makeRecord({ id: 'old::XAUUSD::PRE_NEWS', outcome: 'PENDING' });
  const bars = {
    XAUUSD: [{ k: kMin('2026-11-11T13:10:00.000Z'), o: 4000, h: 4032, l: 3999, c: 4030 }]
  };

  const result = syncAndEvaluateHistory({ existingRecords: [pending], events, prices, bars, now });
  const oldUpdated = result.find((r) => r.id === 'old::XAUUSD::PRE_NEWS');
  assert.equal(oldUpdated?.outcome, 'WIN_TP2');
  assert.ok(result.length >= 2);
});

test('evaluatePendingHistory (fetch-calendar.mjs) mengevaluasi record PENDING memakai bars & reaction', () => {
  const pendingBar = makeRecord({ id: 'cron-1', outcome: 'PENDING' });
  const pendingReact = makeRecord({
    id: 'cron-2',
    pair: 'EURUSD',
    display: 'EUR/USD',
    action: 'BUY',
    entryPrice: 1.1,
    slPrice: 1.098,
    tp1Price: 1.103,
    tp2Price: 1.1056,
    outcome: 'PENDING'
  });

  const out = evaluatePendingHistory(
    [pendingBar, pendingReact],
    {
      pairs: {
        XAUUSD: {
          price: 4030,
          bars: [{ k: kMin('2026-11-11T13:10:00.000Z'), o: 4000, h: 4030, l: 3998, c: 4029 }]
        }
      }
    },
    {
      events: {
        '2026-11-11T13:30:00.000Z|Core CPI m/m': {
          releasedAt: '2026-11-11T13:30:00.000Z',
          pairs: { 'EUR/USD': { baseClose: 1.1, lastClose: 1.097, movePct: -0.27, dir: 'short', minutes: 45 } }
        }
      }
    }
  );

  assert.equal(out[0].outcome, 'WIN_TP2');
  assert.equal(out[1].outcome, 'FAKE_REVERSAL');
});

test('PascaNewsArchive SSR merender statistik winrate, tabel pair profit vs fake, dan riwayat sinyal', () => {
  const history = [
    makeRecord({ id: 'ssr-1', pair: 'XAUUSD', display: 'XAU/USD', outcome: 'WIN_TP2', pipsResult: 280, rMultiple: 2.8, source: '1m-bars' }),
    makeRecord({ id: 'ssr-2', pair: 'USDCHF', display: 'USD/CHF', outcome: 'FAKE_REVERSAL', pipsResult: -20, rMultiple: -1, source: 'reaction-feed' })
  ];
  const html = renderToStaticMarkup(
    React.createElement(PascaNewsArchive, {
      events: [],
      signalHistory: history,
      onSelectForCalibration: () => {},
      onOpenAIAnalysis: () => {}
    })
  );

  assert.match(html, /Statistik Winrate/);
  assert.match(html, /50%/);
  assert.match(html, /XAU\/USD/);
  assert.match(html, /USD\/CHF/);
  assert.match(html, /PROFITABLE/);
  assert.match(html, /RAWAN FAKE/);
  assert.match(html, /FAKE SIGNAL/);
});
