import React from 'react';
import { Volume2, VolumeX, Plus, RefreshCw, Radio, BookOpen } from 'lucide-react';

interface Props {
  activeTab: 'auto' | 'calendar' | 'calibrator' | 'matrix' | 'archive' | 'ebook';
  setActiveTab: (tab: 'auto' | 'calendar' | 'calibrator' | 'matrix' | 'archive' | 'ebook') => void;
  onOpenAddModal: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  audioAlertsEnabled: boolean;
  setAudioAlertsEnabled: (enabled: boolean) => void;
  autoSync: boolean;
  setAutoSync: (sync: boolean) => void;
}

export const Header: React.FC<Props> = ({
  activeTab,
  setActiveTab,
  onOpenAddModal,
  onRefresh,
  isRefreshing,
  audioAlertsEnabled,
  setAudioAlertsEnabled,
  autoSync,
  setAutoSync
}) => {
  return (
    <header className="bg-slate-950/95 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-6">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
            <a href="/" className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap hover:text-cyan-300 transition-colors">
              AI Terminal Trading
            </a>
          </div>
          <span className="hidden sm:inline-block text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
            Impact Calibrator v2.4
          </span>
        </div>

        {/* Zone 2: Navigation Links / Workspace Tabs */}
        <nav className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium">
          <button
            onClick={() => setActiveTab('auto')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === 'auto'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                : 'text-cyan-300 hover:text-cyan-200 hover:bg-slate-900 border border-cyan-800/60'
            }`}
          >
            🤖 Sinyal Otomatis
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'calendar'
                ? 'bg-cyan-500/15 text-cyan-400 font-semibold border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Kalender & Pre-News
          </button>

          <button
            onClick={() => setActiveTab('calibrator')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'calibrator'
                ? 'bg-cyan-500/15 text-cyan-400 font-semibold border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Kalibrator Manual
          </button>

          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'matrix'
                ? 'bg-cyan-500/15 text-cyan-400 font-semibold border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Formula & Logika
          </button>

          <button
            onClick={() => setActiveTab('archive')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'archive'
                ? 'bg-cyan-500/15 text-cyan-400 font-semibold border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Arsip & Winrate
          </button>

          <button
            onClick={() => setActiveTab('ebook')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === 'ebook'
                ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40 shadow-sm'
                : 'text-cyan-400 hover:text-cyan-300 hover:bg-slate-900'
            }`}
          >
            <span>📘 Panduan Ebook</span>
          </button>
        </nav>

        {/* Zone 3: Primary Action & Controls */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={() => setAutoSync(!autoSync)}
            title={autoSync ? 'Auto-updater aktif (Polling 15s)' : 'Auto-updater nonaktif'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border font-mono transition-colors ${
              autoSync
                ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className={`w-3 h-3 ${autoSync ? 'text-emerald-400 animate-pulse' : ''}`} />
            <span className="hidden md:inline">{autoSync ? 'Auto-Update ON' : 'Auto-Update OFF'}</span>
          </button>

          <button
            onClick={() => setAudioAlertsEnabled(!audioAlertsEnabled)}
            title={audioAlertsEnabled ? 'Audio Chime Aktif (Countdown 30s & 5s)' : 'Audio Muted'}
            className="p-1.5 rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {audioAlertsEnabled ? <Volume2 className="w-3.5 h-3.5 text-cyan-400" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh Economic Calendar Data"
            className="p-1.5 rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            onClick={() => setActiveTab('ebook')}
            title="Buka Ebook Manual (.md & PDF)"
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-md border transition-all whitespace-nowrap shrink-0 shadow-sm ${
              activeTab === 'ebook'
                ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 ring-1 ring-cyan-400/40'
                : 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>📘 Ebook (.md/PDF)</span>
          </button>

          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-md transition-colors whitespace-nowrap shrink-0 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Add News</span>
          </button>
        </div>
      </div>
    </header>
  );
};
