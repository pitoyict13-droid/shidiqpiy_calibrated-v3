export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'CHF' | 'NZD' | 'XAU';

export type EventStatus = 'UPCOMING' | 'RELEASED' | 'REVISED';

export type MarketBias = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

export type ExecutionStrategy = 
  | 'MOMENTUM_BREAKOUT'       // Instant market order on high deviation
  | 'PULLBACK_RETRACEMENT'    // Wait for 1-3 min wick/Fair Value Gap retracement
  | 'FADE_THE_SPIKE'          // Mean reversion when deviation is weak but market spiked on liquidity grab
  | 'NO_TRADE_INLINE';        // Consolidating, high risk of choppy whipsaw

// Fase sinyal relatif terhadap waktu rilis: menentukan apakah Entry/SL/TP boleh dieksekusi.
// PRE_RELEASE : belum rilis (hanya skenario pre-news)
// COOLDOWN    : baru rilis < cooldown — spread masih melebar, dilarang masuk
// ACTIVE      : jendela pasca-rilis valid, sinyal boleh dieksekusi
// EXPIRED     : momentum rilis sudah habis (invalidationTimeMinutes)
export type SignalPhase = 'PRE_RELEASE' | 'COOLDOWN' | 'ACTIVE' | 'EXPIRED';

export interface PriceQuote {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spreadPips: number;
  source: string;
  changePct?: number | null;
  updatedAt?: string;
}

export interface MinuteBar {
  k: number; // indeks menit = floor(unixSeconds / 60)
  o: number;
  h: number;
  l: number;
  c: number;
}

// Hasil ukur reaksi harga 1-menit pasca-rilis dari bar di data/markets.json.
export interface PriceReaction {
  baseClose: number;
  lastClose: number;
  movePct: number;
  dir: 'long' | 'short' | null;
  minutes: number;
  via?: string;
}

// Tiket eksekusi per instrumen: arah, entry, SL, TP1, TP2, lot, dan alasan gate.
export interface PairTicket {
  pair: string;
  display: string;
  action: 'BUY' | 'SELL' | 'NONE';
  phase: SignalPhase;
  tradable: boolean;
  gateReason: string;
  directionReason: string;
  via: string;
  entryPrice: number;
  pullbackEntryPrice?: number;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  slPips: number;
  tp1Pips: number;
  tp2Pips: number;
  expectedPips: number;
  expectedMovePct: number;
  pipValue: number;
  lots: number;
  riskAmount: number;
  digits: number;
  pipUnit: string;
  spreadPips: number;
  priceSource: string;
  priceAvailable: boolean;
  reaction: PriceReaction | null;
  validUntil: string | null;
  signalType?: 'PRE_NEWS' | 'POST_NEWS';
  straddle?: {
    buyStopPrice: number;
    sellStopPrice: number;
    bufferPips: number;
    stopLossPips: number;
    takeProfitPips: number;
  } | null;
}

export interface ScenarioTrigger {
  scenario: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  condition: string;
  minDeviation: number;
  expectedDirection: string;
  expectedPips: string;
  primaryPairs: {
    pair: string;
    action: 'BUY' | 'SELL';
    targetPips: number;
    stopLossPips: number;
    reason?: string;
  }[];
  orderFlowPlaybook: string;
  straddleOrders?: {
    pair: string;
    buyStopPips: number;
    sellStopPips: number;
    stopLossPips: number;
    targetPips: number;
  }[];
}

export interface CalibrationParameters {
  indicatorType: string;
  standardDeviationUnit: number; // e.g. 30 (for 30k jobs in NFP), 0.1 (for 0.1% in CPI)
  highImpactThreshold: number;   // Deviation that sparks strong algorithmic flows
  moderateThreshold: number;     // Deviation that sparks moderate directional drift
  unit: string;                  // 'k', '%', 'bps', 'pts', 'B'
  expectedVolatilityPips: {
    low: number;
    moderate: number;
    extreme: number;
  };
  liquiditySpreadBufferPips: number; // expected spread widening during release
  optimalExecutionWindow: string;    // e.g. "T+45s to T+180s (Post-initial spike)"
  invalidationTimeMinutes: number;   // when news momentum is exhausted
}

export interface EconomicEvent {
  id: string;
  title: string;
  currency: CurrencyCode;
  scheduledTime: string; // ISO string
  releasedAt?: string; // waktu aktual rilis (diisi saat Actual masuk; dipakai untuk fase sinyal)
  status: EventStatus;
  impact: ImpactLevel;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  unit: string;
  category: 'LABOR' | 'INFLATION' | 'CENTRAL_BANK' | 'GROWTH' | 'CONSUMER' | 'MANUFACTURING';
  affectedPairs: string[];
  calibration: CalibrationParameters;
  preNewsScenarios: ScenarioTrigger[];
  postNewsAnalysis?: {
    actualDeviation: number;
    normalizedZScore: number;
    bias: MarketBias;
    actualPipsMoved: number;
    summary: string;
    modelAccuracy: 'ACCURATE' | 'MODERATE' | 'FALSE_BREAK';
  };
}

export interface CalibrationResult {
  rawDeviation: number;      // Actual - Forecast (sesuai satuan data, tanpa pembalikan polaritas)
  signedDeviation: number;   // deviasi yang sudah dikalikan polaritas (+ = mata uang event bullish)
  normalizedZScore: number;  // signedDeviation / sigmaUnit (skala sigma sudah disamakan ke unit data)
  zStrong: number;           // ambang |z| untuk sinyal kuat (dari highImpactThreshold event)
  zModerate: number;         // ambang |z| untuk sinyal moderat (dari moderateThreshold event)
  deviationBasis: 'actual-forecast' | 'actual-previous' | 'none';
  bias: MarketBias;
  biasLabel: string;
  confidenceScore: number; // 0 - 100%
  expectedPips: number;
  strategy: ExecutionStrategy;
  strategyDescription: string;
  stopLossPips: number;
  takeProfit1Pips: number;
  takeProfit2Pips: number;
  riskRewardRatio: string;
  recommendedPositionSizeLots: number;
  optimalTiming: string;
  phase: SignalPhase;
  tradable: boolean;
  gateReason: string;
  minutesSinceRelease: number | null;
  validUntil: string | null;
  correlatedAssets: {
    symbol: string;
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    expectedPips: number;
    reason: string;
  }[];
}

export interface MarketPrice {
  symbol: string;
  bid: number;
  ask: number;
  change24h: number;
  changePips: number;
  high24h: number;
  low24h: number;
  spreadPips: number;
}

export interface AIEventAnalysis {
  eventId: string;
  generatedAt: string;
  marketContext: string;
  macroSignificance: string;
  preNewsInstitutionalPositioning: string;
  scenarioGameplan: {
    bullish: {
      triggerThreshold: string;
      bias: string;
      tradeAction: string;
      targetPips: string;
      riskRule: string;
    };
    inline: {
      triggerThreshold: string;
      bias: string;
      tradeAction: string;
      targetPips: string;
      riskRule: string;
    };
    bearish: {
      triggerThreshold: string;
      bias: string;
      tradeAction: string;
      targetPips: string;
      riskRule: string;
    };
  };
  keyPairsTactics: {
    pair: string;
    bias: string;
    entryTactic: string;
    invalidation: string;
  }[];
  liquidityWarnings: string[];
  calibratedRulesSummary: string;
}

export type SignalOutcome =
  | 'WIN_TP2'
  | 'WIN_TP1'
  | 'PROFIT_MOVE'
  | 'FAKE_REVERSAL'
  | 'LOSS_SL'
  | 'BREAKEVEN'
  | 'PENDING';

export interface SignalHistoryRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  currency: string;
  impact: ImpactLevel;
  scheduledTime: string;
  pair: string;
  display: string;
  action: 'BUY' | 'SELL';
  signalType: 'PRE_NEWS' | 'POST_NEWS';
  via: string;
  entryPrice: number;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  digits: number;
  pipUnit: string;
  createdAt: string;
  evaluatedAt?: string;
  outcome: SignalOutcome;
  pipsResult: number;
  rMultiple: number;
  evaluationNote: string;
  source: '1m-bars' | 'reaction-feed' | 'live-quote' | 'pending';
}

export interface PairWinrateStats {
  pair: string;
  display: string;
  total: number;
  evaluated: number;
  wins: number;
  losses: number;
  fakeSignals: number;
  pending: number;
  winratePct: number | null;
  fakeRatePct: number | null;
  netPips: number;
  netR: number;
  verdict: 'PROFITABLE' | 'MIXED' | 'RAWAN_FAKE' | 'NO_DATA';
}

export interface WinrateSummary {
  overall: {
    total: number;
    evaluated: number;
    wins: number;
    losses: number;
    fakeSignals: number;
    pending: number;
    winratePct: number | null;
    fakeRatePct: number | null;
    netPips: number;
    netR: number;
  };
  byPair: PairWinrateStats[];
}
