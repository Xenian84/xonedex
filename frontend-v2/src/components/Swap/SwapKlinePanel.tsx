import { useState } from 'react';

interface SwapKlinePanelProps {
  baseMint: string;
  quoteMint: string;
  onDirectionToggle: () => void;
}

export function SwapKlinePanel({ onDirectionToggle }: SwapKlinePanelProps) {
  const [timeframe, setTimeframe] = useState('15m');
  
  const timeframes = ['1m', '5m', '15m', '1H', '4H', '1D', '1W'];

  return (
    <div className="h-full flex flex-col">
      {/* Header - Raydium pattern */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-divider-bg">
        <div className="flex items-center gap-3">
          {/* Token Pair */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-sm font-bold text-btn-solid-text">
              X
            </div>
            <h3 className="text-lg font-semibold text-text-primary">
              XNT/USDC
            </h3>
          </div>

          {/* Direction Toggle */}
          <button
            onClick={onDirectionToggle}
            className="p-1.5 hover:bg-bg-transparent-10 rounded-lg transition-colors"
            title="Reverse chart direction"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* Timeframe Selector - Raydium's exact style */}
        <div className="flex items-center gap-1 bg-bg-medium rounded-lg p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-md transition-all
                ${timeframe === tf
                  ? 'bg-secondary text-btn-solid-text shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-transparent-07'
                }
              `}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Price Info - Raydium pattern */}
      <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
        <div>
          <span className="text-text-tertiary mr-2">Price:</span>
          <span className="text-text-primary font-semibold">1.2345</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-text-tertiary">24h:</span>
          <span className="text-price-up font-medium">+5.67%</span>
        </div>
        <div>
          <span className="text-text-tertiary mr-2">24h High:</span>
          <span className="text-text-secondary">1.2890</span>
        </div>
        <div>
          <span className="text-text-tertiary mr-2">24h Low:</span>
          <span className="text-text-secondary">1.1234</span>
        </div>
        <div>
          <span className="text-text-tertiary mr-2">Volume:</span>
          <span className="text-text-secondary">$1,234,567</span>
        </div>
      </div>

      {/* Chart Area - Placeholder (will integrate TradingView or lightweight-charts) */}
      <div className="flex-1 bg-bg-medium rounded-lg flex items-center justify-center relative overflow-hidden">
        {/* Mock Chart Bars */}
        <div className="absolute inset-0 flex items-end justify-around p-4 gap-1">
          {Array.from({ length: 50 }).map((_, i) => {
            const height = Math.random() * 80 + 20;
            const isGreen = Math.random() > 0.5;
            return (
              <div
                key={i}
                className={`flex-1 rounded-sm ${isGreen ? 'bg-price-up' : 'bg-price-down'} opacity-30`}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>

        {/* Overlay Text */}
        <div className="relative z-10 text-center">
          <svg className="w-16 h-16 mx-auto mb-3 text-text-tertiary opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-text-tertiary text-sm">
            Chart will be integrated with TradingView
          </p>
          <p className="text-text-tertiary text-xs mt-1 opacity-70">
            Showing mock data for layout preview
          </p>
        </div>
      </div>

      {/* Chart Controls - Raydium pattern */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-divider-bg">
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-xs bg-bg-medium hover:bg-bg-transparent-10 text-text-secondary rounded-lg transition-colors">
            Candlestick
          </button>
          <button className="px-3 py-1.5 text-xs bg-bg-transparent-07 text-text-tertiary hover:bg-bg-transparent-10 rounded-lg transition-colors">
            Line
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button className="p-1.5 hover:bg-bg-transparent-10 rounded-lg transition-colors" title="Fullscreen">
            <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <button className="p-1.5 hover:bg-bg-transparent-10 rounded-lg transition-colors" title="Settings">
            <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 001.066 1.066c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-1.066-1.066c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-1.066z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

