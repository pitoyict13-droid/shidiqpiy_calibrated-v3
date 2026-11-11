import React from 'react';
import { MarketPrice } from '../types/trading';
import { getInstrument } from '../utils/instruments';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface Props {
  prices: MarketPrice[];
  isLoading?: boolean;
}

export const LiveTickerBar: React.FC<Props> = ({ prices, isLoading }) => {
  return (
    <div className="bg-slate-900/90 border-b border-slate-800/80 px-4 py-2 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 overflow-x-auto no-scrollbar text-xs">
        <div className="flex items-center gap-2 text-slate-400 shrink-0 font-medium">
          <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="uppercase tracking-wider font-mono text-[11px] text-slate-300">Live FX & Yields</span>
        </div>

        <div className="flex items-center gap-6 shrink-0 font-mono">
          {prices.map((p) => {
            const isUp = p.change24h >= 0;
            const digits = getInstrument(p.symbol)?.digits ?? 4;
            return (
              <div key={p.symbol} className="flex items-center gap-2 group hover:text-white transition-colors">
                <span className="font-semibold text-slate-200">{getInstrument(p.symbol)?.display || p.symbol}</span>
                <span className="text-slate-100 tabular-nums font-bold">
                  {p.bid.toFixed(digits)}
                </span>
                <span className={`flex items-center text-[10px] tabular-nums font-medium ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isUp ? <TrendingUp className="w-2.5 h-2.5 mr-0.5 inline" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5 inline" />}
                  {isUp ? '+' : ''}{p.change24h.toFixed(2)}%
                </span>
                <span className="text-[10px] text-slate-500 tabular-nums">
                  Sprd: {p.spreadPips}p
                </span>
              </div>
            );
          })}
        </div>

        {isLoading && (
          <span className="text-[10px] text-slate-500 shrink-0 animate-pulse font-mono">Syncing ticks...</span>
        )}
      </div>
    </div>
  );
};
