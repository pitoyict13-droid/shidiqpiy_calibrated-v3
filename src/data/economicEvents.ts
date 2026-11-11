import { EconomicEvent } from '../types/trading';

// Current time anchor based on environment: 2026-11-08T08:56:00
export const INITIAL_ECONOMIC_EVENTS: EconomicEvent[] = [
  {
    id: 'usd-cpi-core-mom',
    title: 'Core CPI (MoM)',
    currency: 'USD',
    scheduledTime: new Date(Date.now() + 1000 * 60 * 42).toISOString(), // 42 mins from now
    status: 'UPCOMING',
    impact: 'HIGH',
    forecast: 0.3,
    previous: 0.3,
    actual: null,
    unit: '%',
    category: 'INFLATION',
    affectedPairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'USDCHF'],
    calibration: {
      indicatorType: 'Core CPI MoM',
      standardDeviationUnit: 0.1,
      highImpactThreshold: 0.2, // >= 0.5% or <= 0.1% triggers extreme flow
      moderateThreshold: 0.1,   // 0.4% or 0.2% triggers moderate flow
      unit: '%',
      expectedVolatilityPips: {
        low: 25,
        moderate: 50,
        extreme: 95
      },
      liquiditySpreadBufferPips: 2.8,
      optimalExecutionWindow: 'T+60s to T+180s (After 1-min initial liquidity sweep)',
      invalidationTimeMinutes: 45
    },
    preNewsScenarios: [
      {
        scenario: 'BULLISH',
        condition: 'Actual >= 0.4% (Deviation >= +0.1%)',
        minDeviation: 0.1,
        expectedDirection: 'USD Surge / Hawkish Yields Rise',
        expectedPips: '+45 to +85 pips USDJPY / -60 to -110 pips XAUUSD',
        primaryPairs: [
          { pair: 'USDJPY', action: 'BUY', targetPips: 65, stopLossPips: 22 },
          { pair: 'EURUSD', action: 'SELL', targetPips: 50, stopLossPips: 18 },
          { pair: 'XAUUSD', action: 'SELL', targetPips: 120, stopLossPips: 40 }
        ],
        orderFlowPlaybook: 'Do not chase the first 15-second tick. Wait for the 1-minute candle close. If deviation is >= +0.2% (Actual 0.5%+), enter market or on minor pullback to 50% of the initial 1-min wick.'
      },
      {
        scenario: 'NEUTRAL',
        condition: 'Actual == 0.3% (Deviation == 0.0%)',
        minDeviation: 0.0,
        expectedDirection: 'Inline / Initial Whipsaw followed by Mean Reversion',
        expectedPips: '15-25 pips initial fakeout, then return to baseline',
        primaryPairs: [
          { pair: 'EURUSD', action: 'BUY', targetPips: 20, stopLossPips: 15 },
          { pair: 'USDJPY', action: 'SELL', targetPips: 20, stopLossPips: 15 }
        ],
        orderFlowPlaybook: 'Avoid breakout orders. High risk of two-sided stop hunts. If price spikes aggressively on low liquidity, look to fade the move back to pre-news equilibrium.'
      },
      {
        scenario: 'BEARISH',
        condition: 'Actual <= 0.2% (Deviation <= -0.1%)',
        minDeviation: -0.1,
        expectedDirection: 'USD Selloff / Dovish Rate Cut Bets Surge',
        expectedPips: '-40 to -75 pips USDJPY / +60 to +115 pips XAUUSD',
        primaryPairs: [
          { pair: 'EURUSD', action: 'BUY', targetPips: 55, stopLossPips: 18 },
          { pair: 'XAUUSD', action: 'BUY', targetPips: 130, stopLossPips: 45 },
          { pair: 'USDJPY', action: 'SELL', targetPips: 60, stopLossPips: 20 }
        ],
        orderFlowPlaybook: 'Strong disinflation catalyst. Dollar dump expected. Watch EUR/USD for breakout above prior session high with tight 18-pip stop loss.'
      }
    ]
  },
  {
    id: 'usd-nfp-labor',
    title: 'Non-Farm Employment Change (NFP)',
    currency: 'USD',
    scheduledTime: new Date(Date.now() + 1000 * 60 * 185).toISOString(), // ~3 hours from now
    status: 'UPCOMING',
    impact: 'HIGH',
    forecast: 165,
    previous: 142,
    actual: null,
    unit: 'k',
    category: 'LABOR',
    affectedPairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'USDCAD'],
    calibration: {
      indicatorType: 'Non-Farm Payrolls',
      standardDeviationUnit: 30, // 30k
      highImpactThreshold: 60,   // >= 225k or <= 105k
      moderateThreshold: 35,     // 200k or 130k
      unit: 'k',
      expectedVolatilityPips: {
        low: 35,
        moderate: 75,
        extreme: 140
      },
      liquiditySpreadBufferPips: 4.5,
      optimalExecutionWindow: 'T+90s to T+300s (Fair Value Gap retest)',
      invalidationTimeMinutes: 60
    },
    preNewsScenarios: [
      {
        scenario: 'BULLISH',
        condition: 'Actual >= 200k (Deviation >= +35k)',
        minDeviation: 35,
        expectedDirection: 'USD Strength / Labor Market Resilience',
        expectedPips: '+55 to +90 pips USDJPY / -70 to -130 pips XAUUSD',
        primaryPairs: [
          { pair: 'USDJPY', action: 'BUY', targetPips: 75, stopLossPips: 25 },
          { pair: 'GBPUSD', action: 'SELL', targetPips: 55, stopLossPips: 20 }
        ],
        orderFlowPlaybook: 'Validate with Average Hourly Earnings (AHE). If NFP is beat and AHE is >= 0.3%, institutional momentum is confirmed.'
      },
      {
        scenario: 'NEUTRAL',
        condition: 'Actual 145k - 185k (Within +/- 20k of Forecast)',
        minDeviation: 0,
        expectedDirection: 'Choppy Consolidation / Trendless Volatility',
        expectedPips: '20-30 pips range',
        primaryPairs: [
          { pair: 'EURUSD', action: 'BUY', targetPips: 25, stopLossPips: 20 }
        ],
        orderFlowPlaybook: 'No trade recommended on breakout. Wait for 15-minute range boundary test.'
      },
      {
        scenario: 'BEARISH',
        condition: 'Actual <= 130k (Deviation <= -35k)',
        minDeviation: -35,
        expectedDirection: 'USD Heavy Selloff / Recession & Rate Cut Concerns',
        expectedPips: '+60 to +100 pips EURUSD / +100 to +180 pips XAUUSD',
        primaryPairs: [
          { pair: 'XAUUSD', action: 'BUY', targetPips: 150, stopLossPips: 45 },
          { pair: 'EURUSD', action: 'BUY', targetPips: 70, stopLossPips: 22 }
        ],
        orderFlowPlaybook: 'High conviction short USD. Gold offers the highest liquidity and cleanest follow-through.'
      }
    ]
  },
  {
    id: 'fomc-rate-decision',
    title: 'Fed Interest Rate Decision',
    currency: 'USD',
    scheduledTime: new Date(Date.now() + 1000 * 60 * 380).toISOString(),
    status: 'UPCOMING',
    impact: 'HIGH',
    forecast: 4.75,
    previous: 5.00,
    actual: null,
    unit: '%',
    category: 'CENTRAL_BANK',
    affectedPairs: ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD', 'AUDUSD'],
    calibration: {
      indicatorType: 'Federal Funds Rate',
      standardDeviationUnit: 25, // bps
      highImpactThreshold: 25,
      moderateThreshold: 0,
      unit: '%',
      expectedVolatilityPips: {
        low: 40,
        moderate: 90,
        extreme: 180
      },
      liquiditySpreadBufferPips: 5.0,
      optimalExecutionWindow: 'T+120s or Press Conference T+30m',
      invalidationTimeMinutes: 120
    },
    preNewsScenarios: [
      {
        scenario: 'BULLISH',
        condition: 'Hold at 5.00% (Hawkish Pause / No Cut)',
        minDeviation: 0.25,
        expectedDirection: 'Extreme USD Surge / Equity & Gold Liquidation',
        expectedPips: '+120 pips USDJPY / -180 pips XAUUSD',
        primaryPairs: [
          { pair: 'USDJPY', action: 'BUY', targetPips: 110, stopLossPips: 35 },
          { pair: 'XAUUSD', action: 'SELL', targetPips: 190, stopLossPips: 55 }
        ],
        orderFlowPlaybook: 'Massive repricing event. Execute aggressive long USD, maintain wider stop to survive initial spread expansion.'
      },
      {
        scenario: 'NEUTRAL',
        condition: 'Cut 25 bps to 4.75% (Fully Priced In)',
        minDeviation: 0,
        expectedDirection: 'Focus Shifts to Statement and Dot Plot',
        expectedPips: '40-60 pips initial reaction then waiting for Powell',
        primaryPairs: [
          { pair: 'EURUSD', action: 'BUY', targetPips: 35, stopLossPips: 25 }
        ],
        orderFlowPlaybook: 'Trade post-statement reaction rather than instantaneous release.'
      },
      {
        scenario: 'BEARISH',
        condition: 'Jumbo Cut 50 bps to 4.50% (Dovish Surprise)',
        minDeviation: -0.25,
        expectedDirection: 'Explosive Dollar Plunge / Gold Skyrockets',
        expectedPips: '+140 pips EURUSD / +220 pips XAUUSD',
        primaryPairs: [
          { pair: 'XAUUSD', action: 'BUY', targetPips: 220, stopLossPips: 60 },
          { pair: 'EURUSD', action: 'BUY', targetPips: 125, stopLossPips: 35 }
        ],
        orderFlowPlaybook: 'Immediate high-momentum breakout. Gold and EUR/USD prime long candidates.'
      }
    ]
  },
  {
    id: 'eur-ecb-rate',
    title: 'ECB Main Refinancing Rate',
    currency: 'EUR',
    scheduledTime: new Date(Date.now() + 1000 * 60 * 540).toISOString(),
    status: 'UPCOMING',
    impact: 'HIGH',
    forecast: 3.25,
    previous: 3.40,
    actual: null,
    unit: '%',
    category: 'CENTRAL_BANK',
    affectedPairs: ['EURUSD', 'EURGBP', 'EURJPY'],
    calibration: {
      indicatorType: 'ECB Rate',
      standardDeviationUnit: 15,
      highImpactThreshold: 25,
      moderateThreshold: 15,
      unit: '%',
      expectedVolatilityPips: { low: 30, moderate: 65, extreme: 120 },
      liquiditySpreadBufferPips: 3.0,
      optimalExecutionWindow: 'T+60s and Lagarde Presser T+45m',
      invalidationTimeMinutes: 90
    },
    preNewsScenarios: [
      {
        scenario: 'BULLISH',
        condition: 'Rate Hold at 3.40% (Hawkish surprise)',
        minDeviation: 0.15,
        expectedDirection: 'EUR Rallies across all crosses',
        expectedPips: '+50 to +80 pips EURUSD / +40 pips EURGBP',
        primaryPairs: [
          { pair: 'EURUSD', action: 'BUY', targetPips: 65, stopLossPips: 20 },
          { pair: 'EURGBP', action: 'BUY', targetPips: 40, stopLossPips: 15 }
        ],
        orderFlowPlaybook: 'Target previous weekly high on EUR/USD.'
      },
      {
        scenario: 'NEUTRAL',
        condition: 'Rate Cut to 3.25% as expected',
        minDeviation: 0,
        expectedDirection: 'Muted initial reaction, press conference dependent',
        expectedPips: '20-30 pips oscillation',
        primaryPairs: [
          { pair: 'EURUSD', action: 'BUY', targetPips: 25, stopLossPips: 18 }
        ],
        orderFlowPlaybook: 'Wait for Christine Lagarde forward guidance at 13:45 GMT.'
      },
      {
        scenario: 'BEARISH',
        condition: 'Rate Cut 50 bps to 3.00%',
        minDeviation: -0.25,
        expectedDirection: 'Severe EUR Depreciation',
        expectedPips: '-80 to -130 pips EURUSD',
        primaryPairs: [
          { pair: 'EURUSD', action: 'SELL', targetPips: 95, stopLossPips: 28 },
          { pair: 'EURJPY', action: 'SELL', targetPips: 110, stopLossPips: 32 }
        ],
        orderFlowPlaybook: 'Heavy sell algorithm activation.'
      }
    ]
  },
  {
    id: 'gbp-cpi-yoy',
    title: 'UK CPI (YoY)',
    currency: 'GBP',
    scheduledTime: new Date(Date.now() + 1000 * 60 * 720).toISOString(),
    status: 'UPCOMING',
    impact: 'HIGH',
    forecast: 2.2,
    previous: 2.3,
    actual: null,
    unit: '%',
    category: 'INFLATION',
    affectedPairs: ['GBPUSD', 'EURGBP', 'GBPJPY'],
    calibration: {
      indicatorType: 'UK CPI YoY',
      standardDeviationUnit: 0.2,
      highImpactThreshold: 0.3,
      moderateThreshold: 0.1,
      unit: '%',
      expectedVolatilityPips: { low: 30, moderate: 60, extreme: 110 },
      liquiditySpreadBufferPips: 3.5,
      optimalExecutionWindow: 'T+30s to T+120s',
      invalidationTimeMinutes: 45
    },
    preNewsScenarios: [
      {
        scenario: 'BULLISH',
        condition: 'Actual >= 2.5% (+0.3% beat)',
        minDeviation: 0.3,
        expectedDirection: 'Pound Sterling spikes as BoE delay cuts',
        expectedPips: '+50 to +85 pips GBPUSD',
        primaryPairs: [{ pair: 'GBPUSD', action: 'BUY', targetPips: 70, stopLossPips: 22 }],
        orderFlowPlaybook: 'Clean momentum breakout on GBP/USD.'
      },
      {
        scenario: 'NEUTRAL',
        condition: 'Actual 2.2% - 2.3%',
        minDeviation: 0,
        expectedDirection: 'Inline reaction',
        expectedPips: '15-25 pips chop',
        primaryPairs: [{ pair: 'GBPUSD', action: 'SELL', targetPips: 20, stopLossPips: 15 }],
        orderFlowPlaybook: 'Low edge environment.'
      },
      {
        scenario: 'BEARISH',
        condition: 'Actual <= 1.9% (-0.3% miss)',
        minDeviation: -0.3,
        expectedDirection: 'Pound dumps on accelerating disinflation',
        expectedPips: '-60 to -95 pips GBPUSD',
        primaryPairs: [{ pair: 'GBPUSD', action: 'SELL', targetPips: 80, stopLossPips: 24 }],
        orderFlowPlaybook: 'Short GBP/USD into key demand breaks.'
      }
    ]
  },
  // RECENT RELEASED (PASCA NEWS) DATA FOR BACKTESTING & MODEL CALIBRATION VALIDATION
  {
    id: 'usd-retail-sales-recent',
    title: 'Retail Sales (MoM)',
    currency: 'USD',
    scheduledTime: new Date(Date.now() - 1000 * 60 * 135).toISOString(), // Released 2h 15m ago
    status: 'RELEASED',
    impact: 'HIGH',
    forecast: 0.4,
    previous: 0.1,
    actual: 0.8,
    unit: '%',
    category: 'CONSUMER',
    affectedPairs: ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'],
    calibration: {
      indicatorType: 'Retail Sales MoM',
      standardDeviationUnit: 0.2,
      highImpactThreshold: 0.3,
      moderateThreshold: 0.2,
      unit: '%',
      expectedVolatilityPips: { low: 20, moderate: 45, extreme: 80 },
      liquiditySpreadBufferPips: 2.2,
      optimalExecutionWindow: 'T+30s to T+120s',
      invalidationTimeMinutes: 40
    },
    preNewsScenarios: [],
    postNewsAnalysis: {
      actualDeviation: 0.4, // +0.4% above consensus
      normalizedZScore: 2.0, // High standard deviation surge
      bias: 'STRONG_BUY',
      actualPipsMoved: 58,
      summary: 'Massive beat (+0.8% vs +0.4% expected). Robust US consumer spending reinforced US economic exceptionalism. USDJPY surged +62 pips, EURUSD fell -48 pips.',
      modelAccuracy: 'ACCURATE'
    }
  },
  {
    id: 'usd-ism-mfg-recent',
    title: 'ISM Manufacturing PMI',
    currency: 'USD',
    scheduledTime: new Date(Date.now() - 1000 * 60 * 320).toISOString(), // ~5h ago
    status: 'RELEASED',
    impact: 'HIGH',
    forecast: 49.5,
    previous: 48.6,
    actual: 46.8,
    unit: 'pts',
    category: 'MANUFACTURING',
    affectedPairs: ['EURUSD', 'USDJPY', 'XAUUSD'],
    calibration: {
      indicatorType: 'ISM Manufacturing',
      standardDeviationUnit: 1.0,
      highImpactThreshold: 1.5,
      moderateThreshold: 0.8,
      unit: 'pts',
      expectedVolatilityPips: { low: 25, moderate: 50, extreme: 85 },
      liquiditySpreadBufferPips: 2.5,
      optimalExecutionWindow: 'T+45s to T+180s',
      invalidationTimeMinutes: 45
    },
    preNewsScenarios: [],
    postNewsAnalysis: {
      actualDeviation: -2.7,
      normalizedZScore: -2.7,
      bias: 'STRONG_SELL',
      actualPipsMoved: 72,
      summary: 'Deep contractionary print (46.8 vs 49.5 expected, deviation -2.7 pts). New orders sub-index crashed. Dollar plunged, XAU/USD surged +$18.50 (+74 pips equivalent).',
      modelAccuracy: 'ACCURATE'
    }
  },
  {
    id: 'aud-employment-change',
    title: 'Employment Change',
    currency: 'AUD',
    scheduledTime: new Date(Date.now() - 1000 * 60 * 650).toISOString(),
    status: 'RELEASED',
    impact: 'HIGH',
    forecast: 25.0,
    previous: 32.6,
    actual: 26.2,
    unit: 'k',
    category: 'LABOR',
    affectedPairs: ['AUDUSD', 'AUDJPY', 'EURAUD'],
    calibration: {
      indicatorType: 'Employment Change',
      standardDeviationUnit: 15.0,
      highImpactThreshold: 20.0,
      moderateThreshold: 10.0,
      unit: 'k',
      expectedVolatilityPips: { low: 18, moderate: 35, extreme: 65 },
      liquiditySpreadBufferPips: 2.0,
      optimalExecutionWindow: 'T+30s to T+90s',
      invalidationTimeMinutes: 30
    },
    preNewsScenarios: [],
    postNewsAnalysis: {
      actualDeviation: 1.2,
      normalizedZScore: 0.08,
      bias: 'NEUTRAL',
      actualPipsMoved: 14,
      summary: 'Print was essentially inline with consensus (26.2k vs 25.0k expected). Initial 12-pip spike in AUD/USD was rapidly absorbed, returning to consolidation.',
      modelAccuracy: 'ACCURATE'
    }
  }
];
