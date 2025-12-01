import { useState } from 'react';
import { useTokenStore } from '../../store/useTokenStore';

interface SwapInfoBoardProps {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  priceImpact: number;
  minReceived: string;
  fee?: number; // Optional fee amount (calculated from pool)
  feePercent?: number; // Optional fee percentage (e.g., 0.3 for 0.3%)
  isComputing?: boolean;
  onRefresh?: () => void;
  lastQuoteTime?: number;
  priceChange?: number | null; // Price change percentage (for indicators)
}

export function SwapInfoBoard({
  inputMint,
  outputMint,
  inputAmount,
  outputAmount,
  priceImpact,
  minReceived,
  fee,
  feePercent = 0.3, // Default 0.3% (same as Uniswap V2)
  isComputing = false,
  onRefresh,
  lastQuoteTime,
  priceChange,
}: SwapInfoBoardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const getAllTokens = useTokenStore(s => s.getAllTokens);
  const tokenList = getAllTokens();
  
  // Get token symbols
  const inputToken = tokenList.find((t: any) => t.address === inputMint);
  const outputToken = tokenList.find((t: any) => t.address === outputMint);
  const inputSymbol = inputToken?.symbol || 'Token';
  const outputSymbol = outputToken?.symbol || 'Token';

  // Calculate values - format large numbers properly
  const rateValue = inputAmount && parseFloat(inputAmount) > 0
    ? parseFloat(outputAmount) / parseFloat(inputAmount)
    : 0;
  
  // Format rate: use scientific notation if > 1M, otherwise use comma separators
  const rate = rateValue > 1000000
    ? rateValue.toExponential(4)
    : rateValue > 1000
    ? rateValue.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : rateValue.toFixed(6);
  const priceImpactColor = priceImpact < 1 
    ? 'text-semantic-success' 
    : priceImpact < 5 
    ? 'text-semantic-warning' 
    : 'text-semantic-error';
  // Calculate fee amount - use provided fee from swap calculation (more accurate)
  // The fee from calculateV2AmmSwapOutput is already calculated correctly using pool's fee_numerator/fee_denominator
  // This matches the actual fee charged by the smart contract
  const feeAmount = fee !== undefined && fee > 0
    ? fee.toFixed(6)
    : inputAmount && parseFloat(inputAmount) > 0
    ? (parseFloat(inputAmount) * (feePercent / 100)).toFixed(6)
    : '0.000000';
  
  // Format fee display - show reasonable precision
  const formattedFee = parseFloat(feeAmount) > 0 
    ? parseFloat(feeAmount).toLocaleString('en-US', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 6 
      })
    : '0';
  
  // Calculate time since last quote
  const timeSinceQuote = lastQuoteTime ? Math.floor((Date.now() - lastQuoteTime) / 1000) : 0;
  const refreshProgress = Math.min((timeSinceQuote / 30) * 100, 100); // 30 second refresh cycle

  return (
    <div className="bg-[#0d0e14] rounded-xl border border-[#2c2d3a]">
      {/* Summary Row - Always Visible (Raydium pattern) */}
      <div className="px-3 sm:px-4 py-3 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0 flex-1">
          <span className="text-[#5a5d7a] flex-shrink-0">Rate:</span>
          {isComputing ? (
            <div className="w-24 h-4 bg-bg-dark rounded animate-pulse"></div>
          ) : (
            <span className="text-white font-medium flex items-center gap-1 min-w-0">
              <span className="truncate">1 {inputSymbol} ≈ {rate} {outputSymbol}</span>
              {/* Price change indicator */}
              {priceChange !== null && priceChange !== undefined && Math.abs(priceChange) > 0.01 && (
                <span className={`text-xs flex-shrink-0 ${priceChange > 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {priceChange > 0 ? '↑' : '↓'} {Math.abs(priceChange).toFixed(2)}%
                </span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-xs sm:text-sm">
            <span className="text-[#5a5d7a]">Impact:</span>
            {isComputing ? (
              <div className="w-12 h-4 bg-bg-dark rounded animate-pulse"></div>
            ) : (
              <span className={`font-medium ${priceImpactColor}`}>
                {priceImpact < 0.01 ? '<0.01' : priceImpact.toFixed(2)}%
              </span>
            )}
          </div>

          {/* Refresh Button with Progress Circle */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isComputing}
              className="relative w-5 h-5 flex items-center justify-center text-[#8e92bc] hover:text-white transition-colors disabled:opacity-50"
              title="Refresh quote"
            >
              <svg
                className={`w-4 h-4 ${isComputing ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {/* Progress circle */}
              <svg className="absolute inset-0 w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeOpacity="0.2"
                />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray={`${2 * Math.PI * 8}`}
                  strokeDashoffset={`${2 * Math.PI * 8 * (1 - refreshProgress / 100)}`}
                  strokeLinecap="round"
                  opacity="0.5"
                />
              </svg>
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[#8e92bc] hover:text-white transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded Details - Raydium's exact layout */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-2 space-y-2.5 border-t border-divider-bg">
          {/* Minimum Received */}
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-1">
              <span className="text-[#5a5d7a]">Minimum Received</span>
              <button className="text-[#8e92bc] hover:text-white" title="Minimum amount you will receive considering slippage tolerance">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
            {isComputing ? (
              <div className="w-20 h-4 bg-bg-dark rounded animate-pulse"></div>
            ) : (
              <span className="text-white font-medium text-right break-all">
                {parseFloat(minReceived) > 1000000 
                  ? parseFloat(minReceived).toExponential(4)
                  : parseFloat(minReceived) > 1000
                  ? parseFloat(minReceived).toLocaleString('en-US', { maximumFractionDigits: 2 })
                  : parseFloat(minReceived).toFixed(6)
                } {outputSymbol}
              </span>
            )}
          </div>

          {/* Price Impact */}
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-1">
              <span className="text-[#5a5d7a]">Price Impact</span>
              <button className="text-[#8e92bc] hover:text-white" title="Estimated price impact of this swap on the pool">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
            {isComputing ? (
              <div className="w-16 h-4 bg-bg-dark rounded animate-pulse"></div>
            ) : (
              <span className={`font-medium ${priceImpactColor}`}>
                {priceImpact < 0.01 ? '<0.01' : priceImpact.toFixed(2)}%
              </span>
            )}
          </div>

          {/* Trading Fee */}
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-1">
              <span className="text-[#5a5d7a]">Trading Fee</span>
              <button className="text-[#8e92bc] hover:text-white" title="Fee charged by the AMM pool">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
            {isComputing ? (
              <div className="w-24 h-4 bg-bg-dark rounded animate-pulse"></div>
            ) : (
              <span className="text-white font-medium">
                {parseFloat(feeAmount) > 0 ? (
                  <>
                    {formattedFee} {inputSymbol} ({feePercent}%)
                  </>
                ) : (
                  '—'
                )}
              </span>
            )}
          </div>

          {/* Route */}
          <div className="flex justify-between items-start text-sm pt-2 border-t border-divider-bg">
            <div className="flex items-center gap-1">
              <span className="text-[#5a5d7a]">Route</span>
            </div>
            <div className="flex items-center gap-1 justify-end flex-wrap">
              <div className="px-2 py-1 bg-bg-transparent-10 rounded text-xs text-[#8e92bc] truncate max-w-[100px]">
                {inputSymbol}
              </div>
              <svg className="w-3 h-3 text-[#5a5d7a] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <div className="px-2 py-1 bg-bg-transparent-10 rounded text-xs text-[#8e92bc] truncate max-w-[100px]">
                {outputSymbol}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
