import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { INITIAL_ECONOMIC_EVENTS } from './src/data/economicEvents.ts';
import { calculateCalibration, thresholdsFor } from './src/utils/calibrator.ts';
import { parseCalendarEvents, buildCalibrationFor, affectedPairsFor, buildPreNewsScenarios, pickEventSource } from './src/utils/calendar.ts';
import { buildPriceMap, type MarketDataBundle } from './src/utils/marketData.ts';
import { getInstrument } from './src/utils/instruments.ts';
import { EconomicEvent, AIEventAnalysis, PriceQuote } from './src/types/trading.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

const DATA_DIR = path.resolve(__dirname, 'data');

// --- Sumber data riil (data/*.json) --------------------------------------------
// Harga & kalender TIDAK lagi di-hardcode: server membaca file snapshot dari disk
// sehingga Entry/SL/TP selalu berbasis harga pasar yang benar-benar tersedia.

function readDataJson<T>(file: string): T | null {
  try {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) return null;
    return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
  } catch (err) {
    console.warn(`Gagal membaca data/${file}:`, (err as Error).message);
    return null;
  }
}

function loadDataBundle(): MarketDataBundle & { calendar: unknown[] | null } {
  return {
    markets: readDataJson('markets.json'),
    forex: readDataJson('forex.json'),
    indices: readDataJson('indices.json'),
    crypto: readDataJson('crypto.json'),
    broker: readDataJson('forex-broker.json'),
    calendar: readDataJson('calendar.json'),
    source: 'disk',
    generatedAt: readDataJson<{ generatedAt?: string }>('markets.json')?.generatedAt || null
  };
}

// In-memory persistent events database for current session
function seedEvents(): EconomicEvent[] {
  // Jadwal riil (data/calendar.json) menang mutlak. Event contoh dipakai HANYA
  // bila file kalender tidak ada — waktu event contoh relatif terhadap jam load,
  // sehingga gabungan membuat NFP/FOMC palsu selalu tampil "akan datang".
  const calendar = parseCalendarEvents(readDataJson('calendar.json'), {
    maxAgeHours: 168 // mingguan, ikut siklus file kalender
  });
  // Tidak ada kalender riil -> event contoh (waktunya relatif terhadap jam load).
  return pickEventSource(calendar, JSON.parse(JSON.stringify(INITIAL_ECONOMIC_EVENTS)));
}

let currentEvents: EconomicEvent[] = seedEvents();

// Harga acuan (previousClose) untuk menghitung perubahan % dari snapshot.
function getReferenceClose(symbol: string, bundle: MarketDataBundle): number {
  const market = bundle.markets?.pairs?.[getInstrument(symbol)?.display || ''];
  const prev = Number(market?.previousClose);
  if (Number.isFinite(prev) && prev > 0) return prev;
  const q = bundle.forex?.quotes?.[getInstrument(symbol)?.display || ''];
  const price = Number(q?.price);
  if (Number.isFinite(price) && price > 0 && q?.changePct !== undefined) {
    return price / (1 + (Number(q.changePct) || 0) / 100);
  }
  const inst = getInstrument(symbol);
  return 0;
}

// Initialize Gemini SDK with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function startServer() {
  const app = express();
  app.use(express.json());

  // GET: Fetch all economic calendar events (both upcoming and released)
  app.get('/api/events', (req, res) => {
    // Sort upcoming first (by scheduledTime ascending), then released (by scheduledTime descending)
    const upcoming = currentEvents
      .filter(e => e.status === 'UPCOMING')
      .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
    
    const released = currentEvents
      .filter(e => e.status !== 'UPCOMING')
      .sort((a, b) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime());

    res.json({
      events: [...upcoming, ...released],
      timestamp: new Date().toISOString(),
      upcomingCount: upcoming.length,
      releasedCount: released.length
    });
  });

  // POST: Add new upcoming economic news to the calendar (Updater terus)
  app.post('/api/events/add', (req, res) => {
    try {
      const newEvent: EconomicEvent = req.body;
      if (!newEvent.title || !newEvent.currency || !newEvent.scheduledTime) {
        return res.status(400).json({ error: 'Missing required event fields' });
      }

      // Parameter kalibrasi dari preset indikator (bukan angka generik)
      if (!newEvent.calibration) {
        newEvent.calibration = buildCalibrationFor(
          newEvent.title,
          newEvent.unit || '',
          newEvent.forecast ?? null,
          newEvent.previous ?? null
        );
      }

      // Hanya pair yang benar-benar punya harga di data pasar
      if (!newEvent.affectedPairs || !newEvent.affectedPairs.length) {
        newEvent.affectedPairs = affectedPairsFor(newEvent.currency);
      }

      if (!newEvent.preNewsScenarios || newEvent.preNewsScenarios.length === 0) {
        newEvent.preNewsScenarios = buildPreNewsScenarios(newEvent);
      }

      currentEvents.unshift(newEvent);
      res.json({ success: true, event: newEvent });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to add event' });
    }
  });

  // POST: Update Actual release for an upcoming news item (Transiting from Pre-News to Post-News)
  app.post('/api/events/update-actual', (req, res) => {
    try {
      const { eventId, actualValue } = req.body;
      const index = currentEvents.findIndex(e => e.id === eventId);
      if (index === -1) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = currentEvents[index];
      const actualNum = Number(actualValue);
      event.actual = actualNum;
      event.status = 'RELEASED';
      // Waktu rilis aktual dipakai engine untuk fase COOLDOWN/ACTIVE/EXPIRED.
      event.releasedAt = event.releasedAt || new Date().toISOString();
      event.postNewsAnalysis = undefined;

      // Perform instant calibration calculation
      const calibrationResult = calculateCalibration({
        event,
        actual: actualNum
      });

      event.postNewsAnalysis = {
        actualDeviation: calibrationResult.rawDeviation,
        normalizedZScore: calibrationResult.normalizedZScore,
        bias: calibrationResult.bias,
        actualPipsMoved: calibrationResult.expectedPips,
        summary: `Actual ${actualNum}${event.unit} released vs Forecast ${event.forecast}${event.unit}. Deviation: ${calibrationResult.rawDeviation >= 0 ? '+' : ''}${calibrationResult.rawDeviation} (${calibrationResult.normalizedZScore}σ). Signal: ${calibrationResult.bias}. Optimal Play: ${calibrationResult.strategy}.`,
        modelAccuracy: 'ACCURATE'
      };

      currentEvents[index] = event;

      res.json({
        success: true,
        event,
        calibration: calibrationResult
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update actual' });
    }
  });

  // POST: Calibrate parameter simulator (mathematical calibration)
  app.post('/api/calibrate', (req, res) => {
    try {
      const { event, actual, forecast, previous, accountBalance, riskPercent } = req.body;
      if (!event || actual === undefined) {
        return res.status(400).json({ error: 'Missing event or actual value' });
      }

      const result = calculateCalibration({
        event,
        actual: Number(actual),
        forecast: forecast !== undefined ? Number(forecast) : undefined,
        previous: previous !== undefined ? Number(previous) : undefined,
        accountBalance: accountBalance ? Number(accountBalance) : 10000,
        riskPercent: riskPercent ? Number(riskPercent) : 1.0
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Calibration calculation failed' });
    }
  });

  // POST: AI Deep Institutional News Analysis with Gemini 3.8 Flash
  app.post('/api/analyze-event', async (req, res) => {
    try {
      const { event, userQuestions } = req.body;
      if (!event) {
        return res.status(400).json({ error: 'Event data is required' });
      }

      const prompt = `
You are a senior institutional quantitative macro trader and chief economic strategist at a Tier-1 FX fund.
Analyze the following economic calendar event and generate calibrated trading logic parameters for automated news trading:

Event Details:
- Title: ${event.title}
- Currency: ${event.currency}
- Scheduled Time: ${event.scheduledTime}
- Status: ${event.status} (${event.status === 'UPCOMING' ? 'PRE-NEWS ANTICIPATION' : 'PASCA NEWS / POST-RELEASE'})
- Consensus Forecast: ${event.forecast ?? 'N/A'} ${event.unit}
- Previous Print: ${event.previous ?? 'N/A'} ${event.unit}
- Actual Value: ${event.actual !== null ? `${event.actual} ${event.unit}` : 'Not yet released (Awaiting release)'}
- Key Affected Pairs: ${(event.affectedPairs || []).join(', ')}
- Indicator Calibration Units: Std Dev = ${event.calibration?.standardDeviationUnit} ${event.unit}, High Impact Threshold = ${event.calibration?.highImpactThreshold} ${event.unit}
${userQuestions ? `Specific Trader Query: ${userQuestions}` : ''}

Provide a deep, precise, institutional macro analysis in Indonesian & English (bilingual clarity for Indonesian FX traders):
1. Market Context & Central Bank Policy Context
2. Pre-News Institutional Positioning (Where the stops/liquidity lie)
3. 3-Pronged Scenario Gameplan (Bullish Beat, Inline/Chop, Bearish Miss) with exact trigger numbers, expected pip range, and specific execution tactics.
4. Key currency pair tactics (e.g. EURUSD, USDJPY, XAUUSD Gold) with entry models (e.g. Fair Value Gap retest, VWAP rejection, instant breakout).
5. Liquidity & slippage mitigation rules (spread widening buffer, max slippage tolerance).
6. Calibrated summary rule formula.
`;

      let aiAnalysis: AIEventAnalysis;

      if (process.env.GEMINI_API_KEY) {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              systemInstruction: 'You are an institutional FX algorithmic trading and macroeconomics engine. Give realistic, mathematically grounded, and risk-managed trading parameters with zero fluff or generic disclaimers.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  eventId: { type: Type.STRING },
                  generatedAt: { type: Type.STRING },
                  marketContext: { type: Type.STRING },
                  macroSignificance: { type: Type.STRING },
                  preNewsInstitutionalPositioning: { type: Type.STRING },
                  scenarioGameplan: {
                    type: Type.OBJECT,
                    properties: {
                      bullish: {
                        type: Type.OBJECT,
                        properties: {
                          triggerThreshold: { type: Type.STRING },
                          bias: { type: Type.STRING },
                          tradeAction: { type: Type.STRING },
                          targetPips: { type: Type.STRING },
                          riskRule: { type: Type.STRING },
                        },
                      },
                      inline: {
                        type: Type.OBJECT,
                        properties: {
                          triggerThreshold: { type: Type.STRING },
                          bias: { type: Type.STRING },
                          tradeAction: { type: Type.STRING },
                          targetPips: { type: Type.STRING },
                          riskRule: { type: Type.STRING },
                        },
                      },
                      bearish: {
                        type: Type.OBJECT,
                        properties: {
                          triggerThreshold: { type: Type.STRING },
                          bias: { type: Type.STRING },
                          tradeAction: { type: Type.STRING },
                          targetPips: { type: Type.STRING },
                          riskRule: { type: Type.STRING },
                        },
                      },
                    },
                  },
                  keyPairsTactics: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        pair: { type: Type.STRING },
                        bias: { type: Type.STRING },
                        entryTactic: { type: Type.STRING },
                        invalidation: { type: Type.STRING },
                      },
                    },
                  },
                  liquidityWarnings: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  calibratedRulesSummary: { type: Type.STRING },
                },
                required: [
                  'marketContext',
                  'macroSignificance',
                  'preNewsInstitutionalPositioning',
                  'scenarioGameplan',
                  'keyPairsTactics',
                  'liquidityWarnings',
                  'calibratedRulesSummary',
                ],
              },
            },
          });

          const parsed = JSON.parse(response.text || '{}');
          aiAnalysis = {
            ...parsed,
            eventId: event.id,
            generatedAt: new Date().toISOString(),
          };
          return res.json(aiAnalysis);
        } catch (geminiError: any) {
          console.warn('Gemini call failed or rate-limited, generating calibrated algorithmic fallback:', geminiError?.message);
        }
      }

      // Institutional fallback if API key not supplied or network fails
      aiAnalysis = generateAlgorithmicMacroAnalysis(event);
      res.json(aiAnalysis);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to analyze event' });
    }
  });

  // GET: Snapshot data riil dari folder data/ (kalender, markets, forex, indices, crypto)
  app.get('/api/market-data', (req, res) => {
    const bundle = loadDataBundle();
    res.json({
      markets: bundle.markets,
      forex: bundle.forex,
      indices: bundle.indices,
      crypto: bundle.crypto,
      broker: bundle.broker,
      calendar: bundle.calendar,
      generatedAt: bundle.generatedAt,
      source: 'data/*.json',
      servedAt: new Date().toISOString()
    });
  });

  // GET: Harga pasar RIIL dari data/*.json (tanpa harga hardcode / jitter acak).
  // Bid/ask disusun dari mid + spread instrumen; sumber ditampilkan agar jujur.
  app.get('/api/market-prices', (req, res) => {
    const bundle = loadDataBundle();
    const priceMap = buildPriceMap(bundle);
    const now = Date.now();

    const quotes = Object.values(priceMap).map((q: PriceQuote) => {
      const inst = getInstrument(q.symbol);
      const digits = inst ? inst.digits : 5;
      const ref = getReferenceClose(q.symbol, bundle);
      const changePct = ref > 0 ? Number((((q.mid - ref) / ref) * 100).toFixed(2)) : 0;
      return {
        symbol: q.symbol,
        display: inst ? inst.display : q.symbol,
        bid: Number(q.bid.toFixed(digits)),
        ask: Number(q.ask.toFixed(digits)),
        mid: Number(q.mid.toFixed(digits)),
        spreadPips: q.spreadPips,
        changePct,
        changePips: inst && ref > 0 ? Math.round((q.mid - ref) / inst.pipSize) : 0,
        source: q.source,
        updatedAt: q.updatedAt || new Date(now).toISOString()
      };
    });

    res.json({
      quotes,
      count: quotes.length,
      generatedAt: bundle.generatedAt,
      servedAt: new Date(now).toISOString()
    });
  });

  // Setup Vite development server middleware or static build handler
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Trading Terminal server running on http://0.0.0.0:${PORT}`);
  });
}

// Label skala sigma untuk formula (bps vs unit data)
function sigmaScaleLabel(event: EconomicEvent): string {
  const unit = String(event.unit || event.calibration?.unit || '').toLowerCase();
  const sigma = Number(event.calibration?.standardDeviationUnit) || 1;
  return unit === '%' && sigma >= 1 ? 'sigma dalam basis point' : `sigma dalam ${event.unit || event.calibration?.unit || 'unit data'}`;
}

function generateAlgorithmicMacroAnalysis(event: EconomicEvent): AIEventAnalysis {  const isUsd = event.currency === 'USD';
  const f = event.forecast ?? 0;
  const p = event.previous ?? 0;
  const unit = event.unit;
  const std = event.calibration.standardDeviationUnit;

  return {
    eventId: event.id,
    generatedAt: new Date().toISOString(),
    marketContext: `Analisis Makro ${event.title} (${event.currency}): Pasar berada pada fase sensitif terhadap suku bunga & arah kebijakan bank sentral. Tingkat inflasi dan data ketenagakerjaan menjadi pendorong utama penetapan suku bunga (pricing fed funds rate futures).`,
    macroSignificance: `Rilis data ${event.title} memiliki bobot volatilitas Grade-A. Deviasi $\\ge ${event.calibration.highImpactThreshold}${unit}$ akan memicu rebalancing portofolio algoritmik dari hedge fund & CTA kuantitatif dalam hitungan detik.`,
    preNewsInstitutionalPositioning: `Posisi smart money saat ini net-terbuka dengan order pool likuiditas besar terletak di atas batas resistance sesi dan di bawah level support 24 jam. Likuiditas spread diperkirakan melebar hingga ${event.calibration.liquiditySpreadBufferPips} pips saat detik rilis T-0 hingga T+15s.`,
    scenarioGameplan: {
      bullish: {
        triggerThreshold: `Actual >= ${(f + std).toFixed(1)}${unit} (Deviasi >= +${std}${unit})`,
        bias: `STRONG ${event.currency} BULLISH IMPULSE`,
        tradeAction: isUsd ? 'BUY USDJPY, SELL EURUSD & SELL XAUUSD' : `BUY ${event.currency}USD on 1-min pullback`,
        targetPips: `+45 s/d +${event.calibration.expectedVolatilityPips.extreme} Pips`,
        riskRule: `Gunakan SL dinamis ${Math.round(event.calibration.expectedVolatilityPips.moderate * 0.4)} pips. Masuk setelah candle M1 pertama terbentuk untuk menghindari spread spike.`
      },
      inline: {
        triggerThreshold: `Actual berada dalam rentang ${(f - std * 0.4).toFixed(1)} s/d ${(f + std * 0.4).toFixed(1)}${unit}`,
        bias: 'NEUTRAL / INLINE CHOP & WHIPSAW TRAP',
        tradeAction: 'STAND ASIDE / FADE EXTREMES ONLY',
        targetPips: '15 - 25 Pips (Mean Reversion Scalp)',
        riskRule: 'Hindari order breakout instan. Resiko tinggi false breakout di kedua sisi level likuiditas.'
      },
      bearish: {
        triggerThreshold: `Actual <= ${(f - std).toFixed(1)}${unit} (Deviasi <= -${std}${unit})`,
        bias: `STRONG ${event.currency} BEARISH REJECTION`,
        tradeAction: isUsd ? 'BUY EURUSD & XAUUSD, SELL USDJPY' : `SELL ${event.currency}USD`,
        targetPips: `+50 s/d +${event.calibration.expectedVolatilityPips.extreme} Pips`,
        riskRule: `SL maksimum ${Math.round(event.calibration.expectedVolatilityPips.moderate * 0.4)} pips. Ambil TP1 di 1.5R dan geser Stop Loss ke Breakeven.`
      }
    },
    keyPairsTactics: [
      {
        pair: isUsd ? 'XAUUSD (Gold)' : `${event.currency}USD`,
        bias: isUsd ? 'Highly Inverted to USD Yields' : 'Direct Beta',
        entryTactic: 'Tunggu pengisian Fair Value Gap (FVG) pada timeframe 1-menit / 3-menit.',
        invalidation: 'Penutupan candle M5 berlawanan arah dengan deviasi fundamental.'
      },
      {
        pair: isUsd ? 'USDJPY' : `${event.currency}JPY`,
        bias: 'Interest Rate Differential Momentum',
        entryTactic: 'Breakout konfirmasi di atas/bawah level pembukaan sesi London/New York.',
        invalidation: 'Reversal 50% dari body candle lonjakan awal.'
      },
      {
        pair: isUsd ? 'EURUSD' : `EUR${event.currency}`,
        bias: 'Major Currency Counter-Flow',
        entryTactic: 'Execution window T+60s pasca penyerapan order institusional awal.',
        invalidation: 'Slippage spread melebihi batas 3.0 pips.'
      }
    ],
    liquidityWarnings: [
      `Spread Slippage: Perkiraan pelebaran spread hingga ${event.calibration.liquiditySpreadBufferPips} pips saat detik rilis.`,
      `Stop Hunt Trap: Waspadai candle jarum (long wick) 10-30 detik pertama sebelum arah deviasi riil terbentuk.`,
      `Optimal Execution Timing: ${event.calibration.optimalExecutionWindow}.`,
      `Invalidasi Momentum: Volatilitas primer berlangsung hingga ${event.calibration.invalidationTimeMinutes} menit pasca rilis.`
    ],
    calibratedRulesSummary: `Formula: Delta = (Actual - Forecast) / ${std} (skala ${sigmaScaleLabel(event)}). Ambang event: |z| >= ${thresholdsFor(event, event.impact).zStrong.toFixed(2)} -> Momentum Playbook, |z| < ${thresholdsFor(event, event.impact).zModerate.toFixed(2)} -> Neutral Range Filter (NO TRADE).`
  };
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
