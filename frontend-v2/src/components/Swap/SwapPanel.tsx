import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Connection, PublicKey } from '@solana/web3.js';
import { TokenInput } from './TokenInput';
import { SwapInfoBoard } from './SwapInfoBoard';
import { useV2AmmPool, calculateV2AmmSwapOutput } from '../../hooks/useV2AmmPool';
import { useUnifiedPool, calculateUnifiedSwapOutput } from '../../hooks/useUnifiedPool';
import { getWrappedXNTBalance } from '../../utils/unwrapXNT';
import { XNT_TOKEN_INFO } from '../../config/x1-native';
import { Toast, ToastContainer } from '../ui/Toast';
import { useToast } from '../../hooks/useToast';
import { useTokenStore } from '../../store/useTokenStore';
import { useSwapStore } from '../../store/useSwapStore';
import { debounce } from '../../utils/debounce';
import { getSwapPairCache, setSwapPairCache } from '../../utils/swapCache';
import { useSettingsStore } from '../../store/useSettingsStore';
import BN from 'bn.js';
import BigNumber from 'bignumber.js';

interface SwapPanelProps {
  inputMint: string;
  outputMint: string;
  onInputMintChange?: (mint: string) => void;
  onOutputMintChange?: (mint: string) => void;
  onDirectionNeedReverse?: () => void;
}

export function SwapPanel({
  inputMint,
  outputMint,
  onInputMintChange,
  onOutputMintChange,
  onDirectionNeedReverse,
}: SwapPanelProps) {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [inputAmount, setInputAmount] = useState<string>('');
  const [outputAmount, setOutputAmount] = useState<string>('');
  const [swapType, setSwapType] = useState<'BaseIn' | 'BaseOut'>('BaseIn');
  const [isSwapping, setIsSwapping] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [wrappedXNTBalance, setWrappedXNTBalance] = useState<number>(0);
  const [isUnwrapping, setIsUnwrapping] = useState(false);
  const [lastQuoteTime, setLastQuoteTime] = useState<number>(Date.now());
  const isInputFocusedRef = useRef(false); // Use ref instead of state to avoid re-renders on mobile
  const { toasts, hideToast, showInfo, showSuccess, showError } = useToast();
  
  // Settings
  const slippageFromSettings = useSettingsStore(s => s.slippage);
  const getComputedPriorityFee = useSettingsStore(s => s.getComputedPriorityFee);
  
  // Stores
  const loadBalances = useTokenStore(s => s.loadBalances);
  const wrappedXNTBalanceFromStore = useTokenStore(s => s.wrappedXNTBalance);
  const getTokenInfo = useTokenStore(s => s.getTokenInfo);
  const slippage = useSwapStore(s => s.slippage);
  const swapTokenAct = useSwapStore(s => s.swapTokenAct);
  const unWrapXNTAct = useSwapStore(s => s.unWrapXNTAct);
  
  // Fetch real pool data (with automatic polling and WebSocket subscriptions)
  // Use unified pool hook that auto-detects native vs regular pools
  const { poolInfo, hasPool, isLoading: poolLoading, refresh: refreshPool } = useUnifiedPool(inputMint, outputMint, connection);
  
  // Track previous price for change indicators
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  
  // Update previous price when pool info changes
  useEffect(() => {
    if (poolInfo?.price && poolInfo.price !== previousPrice) {
      setPreviousPrice(poolInfo.price);
    }
  }, [poolInfo?.price]);
  
  // Sync wrapped XNT balance from store (store is updated by loadBalances)
  useEffect(() => {
    if (connected) {
      setWrappedXNTBalance(wrappedXNTBalanceFromStore);
    } else {
      setWrappedXNTBalance(0);
    }
  }, [connected, wrappedXNTBalanceFromStore]);
  
  // Calculate real swap quote (memoized to prevent unnecessary recalculations)
  // Use unified calculation that works for both native and regular pools
  const swapQuote = useMemo(() => {
    if (!poolInfo || !inputAmount || isComputing) return null;
    try {
      return calculateUnifiedSwapOutput(
        parseFloat(inputAmount),
        poolInfo,
        poolInfo.mint0 === inputMint,
        9, // inputDecimals
        9  // outputDecimals
      );
    } catch (e) {
      return null;
    }
  }, [poolInfo, inputAmount, inputMint, outputMint, isComputing]);
  
  const priceImpact = swapQuote?.priceImpact || 0;
  const minReceived = swapQuote
    ? (swapQuote.outputAmount * (1 - slippage)).toFixed(9) // Use 9 decimals for precision
    : '0';
  
  // Auto-refresh quotes every 30 seconds (only when not typing)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (!poolInfo || !inputAmount || isSwapping || isInputFocusedRef.current) return;
    
    // Clear existing interval
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }
    
    // Set up auto-refresh every 30 seconds
    refreshIntervalRef.current = setInterval(() => {
      // Skip refresh if user is typing or input is focused
      if (isInputFocusedRef.current || !inputAmount || !poolInfo) return;
      
      setIsComputing(true);
      setTimeout(() => {
        if (!isInputFocusedRef.current && inputAmount && poolInfo) {
          const quote = calculateUnifiedSwapOutput(
            parseFloat(inputAmount),
            poolInfo,
            poolInfo.mint0 === inputMint,
            9, // inputDecimals
            9  // outputDecimals
          );
          if (quote) {
            setOutputAmount(quote.outputAmount.toFixed(6));
            setLastQuoteTime(Date.now());
          }
        }
        setIsComputing(false);
      }, 100);
    }, 30000);
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [poolInfo, inputAmount, inputMint, outputMint, isSwapping]);
  
  // Debounced input handlers - use useMemo to create debounced function once
  const debouncedInputChange = useMemo(
    () => debounce((val: string, isBaseIn: boolean, currentPoolInfo: any, currentInputMint: string, currentOutputMint: string) => {
      setIsComputing(true);
      setTimeout(() => {
        if (val && currentPoolInfo) {
          const quote = calculateUnifiedSwapOutput(
            parseFloat(val),
            currentPoolInfo,
            isBaseIn ? currentPoolInfo.mint0 === currentInputMint : currentPoolInfo.mint0 === currentOutputMint,
            9, // inputDecimals
            9  // outputDecimals
          );
          if (isBaseIn) {
            setOutputAmount(quote ? quote.outputAmount.toFixed(6) : '');
          } else {
            setInputAmount(quote ? quote.outputAmount.toFixed(6) : '');
          }
          setLastQuoteTime(Date.now());
        } else {
          if (isBaseIn) {
            setOutputAmount('');
          } else {
            setInputAmount('');
          }
        }
        setIsComputing(false);
      }, 100);
    }, 200),
    [] // Empty deps - create once and never recreate
  );
  
  // Allow swapping in both directions freely
  const handleSwapTokens = () => {
    // Simply swap input and output tokens
    onInputMintChange?.(outputMint);
    onOutputMintChange?.(inputMint);
    setSwapPairCache({ inputMint: outputMint, outputMint: inputMint });
    // Clear amounts instead of swapping them (better UX - user can enter new amount)
    setInputAmount('');
    setOutputAmount('');
    onDirectionNeedReverse?.();
  };
  
  // Allow XNT to be selected as output token (removed restriction)
  const handleOutputMintChange = useCallback((newOutputMint: string) => {
    onOutputMintChange?.(newOutputMint);
    setSwapPairCache({ inputMint, outputMint: newOutputMint });
  }, [inputMint, onOutputMintChange]);
  
  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    if (!inputAmount || !poolInfo || isSwapping) return;
    setIsComputing(true);
    setTimeout(() => {
      const quote = calculateUnifiedSwapOutput(
        parseFloat(inputAmount),
        poolInfo,
        poolInfo.mint0 === inputMint,
        9, // inputDecimals
        9  // outputDecimals
      );
      if (quote) {
        setOutputAmount(quote.outputAmount.toFixed(6));
        setLastQuoteTime(Date.now());
      }
      setIsComputing(false);
    }, 100);
  }, [inputAmount, poolInfo, inputMint, isSwapping]);

  const handleSwap = async () => {
    if (!connected || !publicKey || !signTransaction) {
      showError('Wallet Not Connected', 'Please connect your wallet first');
      return;
    }

    if (!poolInfo) {
      showError('Pool Not Found', 'No liquidity pool exists for this token pair');
      return;
    }

    if (!inputAmount || parseFloat(inputAmount) === 0) {
      showError('Invalid Amount', 'Please enter an amount to swap');
      return;
    }

    setIsSwapping(true);
    showInfo('Building Transaction', 'Preparing your swap transaction...');
    
    try {
      // Get token info for display
      const inputToken = getTokenInfo(inputMint);
      const outputToken = getTokenInfo(outputMint);
      const inputTokenSymbol = inputToken?.symbol || inputMint.slice(0, 4) + '...';
      const outputTokenSymbol = outputToken?.symbol || outputMint.slice(0, 4) + '...';
      
      // Use BigNumber for safe large number handling
      const amountInBN = new BigNumber(inputAmount).multipliedBy(new BigNumber(10).pow(9));
      const minAmountOutBN = new BigNumber(minReceived).multipliedBy(new BigNumber(10).pow(9));
      
      console.log('💰 Swap amounts:', {
        inputAmount,
        minReceived,
        amountInBN: amountInBN.toFixed(0),
        minAmountOutBN: minAmountOutBN.toFixed(0)
      });
      
      // Get priority fee in lamports (XNT = SOL, 1 XNT = 1e9 lamports)
      const priorityFeeXNT = getComputedPriorityFee();
      const priorityFeeInLamports = Math.floor(priorityFeeXNT * 1e9);

      // Use swap store action (pass strings directly to support NATIVE_XNT_MARKER)
      await swapTokenAct({
        connection,
        owner: publicKey,
        signTransaction,
        inputMint: inputMint, // Pass as string to support NATIVE_XNT_MARKER
        outputMint: outputMint, // Pass as string to support NATIVE_XNT_MARKER
        amountIn: new BN(amountInBN.toFixed(0)),
        minAmountOut: new BN(minAmountOutBN.toFixed(0)),
        priorityFeeInLamports,
        onSuccess: async (signature) => {
          // Optimistic update: Show expected result immediately
          const optimisticOutput = swapQuote?.outputAmount || parseFloat(outputAmount);
          
          showSuccess(
            'Swap Successful!',
            `Swapped ${inputAmount} ${inputTokenSymbol} for ~${optimisticOutput.toFixed(6)} ${outputTokenSymbol}`,
            signature
          );
          
          // Clear input amounts immediately
          setInputAmount('');
          setOutputAmount('');
          
          // Refresh balances (this will update wrappedXNTBalance in store, which syncs to local state)
          await loadBalances(connection, publicKey);
          
          // Refresh pool data after a delay to allow transaction to propagate
          // Don't refresh immediately to avoid interrupting user if they want to swap again
          setTimeout(() => {
            if (!isInputFocusedRef.current) { // Only refresh if user is not typing
              refreshPool();
            }
          }, 3000);
        },
        onError: (error) => {
          let errorMessage = 'Swap failed. Please try again.';
          
          if (error.message?.includes('insufficient') || error.message?.includes('Insufficient')) {
            errorMessage = 'Insufficient balance. Please check your wallet.';
          } else if (error.message?.includes('Plugin Closed') || error.message?.includes('User rejected')) {
            errorMessage = 'Transaction rejected by wallet.';
          } else if (error.message?.includes('Transaction failed')) {
            errorMessage = `Transaction failed: ${error.message}`;
          } else if (error.message?.includes('Confirmation timeout')) {
            errorMessage = 'Transaction sent but confirmation timed out. Check explorer to verify status.';
          } else if (error.message) {
            errorMessage = error.message;
          }
          
          showError('Swap Failed', errorMessage);
        },
        onFinally: () => {
          setIsSwapping(false);
        },
      });
    } catch (error: any) {
      console.error('❌ Swap error:', error);
      showError('Swap Failed', error.message || 'Swap failed. Please try again.');
      setIsSwapping(false);
    }
  };

  const handleUnwrap = async () => {
    if (!connected || !publicKey || !signTransaction) {
      showError('Wallet Not Connected', 'Please connect your wallet first');
      return;
    }

    if (wrappedXNTBalance === 0) {
      showError('No Wrapped XNT', 'You don\'t have any wrapped XNT to unwrap');
      return;
    }

    setIsUnwrapping(true);
    showInfo('Unwrapping XNT', 'Converting wrapped XNT back to native XNT...');

    try {
      await unWrapXNTAct({
        connection,
        owner: publicKey,
        signTransaction,
        onSuccess: async (signature) => {
          showSuccess('XNT Unwrapped!', `Successfully converted ${wrappedXNTBalance.toFixed(6)} wrapped XNT to native XNT`);
          
          // Wait a moment for transaction to confirm, then refresh balances
          // This ensures the wrapped account closure is reflected
          setTimeout(async () => {
            await loadBalances(connection, publicKey);
          }, 2000);
        },
        onError: (error) => {
          showError('Unwrap Failed', error.message || 'Failed to unwrap XNT');
        },
        onFinally: () => {
          setIsUnwrapping(false);
        },
      });
    } catch (error: any) {
      console.error('❌ Unwrap error:', error);
      showError('Unwrap Failed', error.message || 'Failed to unwrap XNT');
      setIsUnwrapping(false);
    }
  };

  return (
    <div className="bg-[#1a1b23] rounded-xl sm:rounded-2xl border border-[#2c2d3a] shadow-lg">
      {/* Header */}
      <div className="p-4 sm:p-6 pb-3 sm:pb-4 border-b border-[#2c2d3a]">
        <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5 sm:w-6 sm:h-6 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
          Swap
        </h2>
      </div>

      {/* Token Inputs - Mobile optimized spacing */}
      <div className="p-3 sm:p-6 space-y-2">
        {/* From Token */}
        <TokenInput
          label="From"
          mint={inputMint}
          amount={inputAmount}
          onAmountChange={(val) => {
            setInputAmount(val);
            setSwapType('BaseIn');
            isInputFocusedRef.current = true; // Mark as focused - using ref to avoid re-render
            debouncedInputChange(val, true, poolInfo, inputMint, outputMint);
            // Clear focus flag after debounce completes + buffer
            setTimeout(() => { isInputFocusedRef.current = false; }, 1000);
          }}
          readonly={isComputing && swapType === 'BaseIn'}
          onMintChange={onInputMintChange}
          excludeToken={outputMint}
          wrappedXNTBalance={inputMint === 'So11111111111111111111111111111111111111112' || inputMint === XNT_TOKEN_INFO.address ? wrappedXNTBalance : 0}
        />

        {/* Swap Direction Button - Raydium's exact design */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={handleSwapTokens}
            className="w-10 h-10 bg-[#0d0e14] hover:bg-[#1a1b23] border-2 border-bg-dark rounded-xl flex items-center justify-center transition-all hover:rotate-180 duration-300"
          >
            <svg className="w-5 h-5 text-[#8e92bc]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* To Token */}
        <TokenInput
          label="To"
          mint={outputMint}
          amount={outputAmount}
          readonly={isComputing && swapType === 'BaseOut'} // Allow editing output to calculate input (reverse quote)
          onAmountChange={(val) => {
            setOutputAmount(val);
            setSwapType('BaseOut');
            isInputFocusedRef.current = true; // Mark as focused - using ref to avoid re-render
            debouncedInputChange(val, false, poolInfo, inputMint, outputMint); // false = BaseOut (calculate input from output)
            // Clear focus flag after debounce completes + buffer
            setTimeout(() => { isInputFocusedRef.current = false; }, 1000);
          }}
          onMintChange={handleOutputMintChange}
          excludeToken={inputMint}
          wrappedXNTBalance={outputMint === 'So11111111111111111111111111111111111111112' || outputMint === XNT_TOKEN_INFO.address ? wrappedXNTBalance : 0}
        />
      </div>

      {/* Pool Loading Indicator */}
      {poolLoading && (
        <div className="px-3 sm:px-6 pb-2">
          <div className="flex items-center gap-2 text-xs text-[#5a5d7a]">
            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="hidden sm:inline">Updating pool reserves...</span>
            <span className="sm:hidden">Updating...</span>
          </div>
        </div>
      )}

      {/* Swap Info - Mobile optimized */}
      {inputAmount && outputAmount && (
        <div className="px-3 sm:px-6 pb-3 sm:pb-4">
          <SwapInfoBoard
            inputMint={inputMint}
            outputMint={outputMint}
            inputAmount={inputAmount}
            outputAmount={outputAmount}
            priceImpact={priceImpact}
            minReceived={minReceived}
            fee={swapQuote?.fee}
            feePercent={poolInfo ? (parseFloat(poolInfo.feeNumerator) / parseFloat(poolInfo.feeDenominator)) * 100 : 0.3}
            isComputing={isComputing}
            onRefresh={handleRefresh}
            lastQuoteTime={lastQuoteTime}
            priceChange={previousPrice && poolInfo?.price ? ((poolInfo.price - previousPrice) / previousPrice) * 100 : null}
          />
        </div>
      )}

      {/* Wrapped XNT Notice */}
      {connected && wrappedXNTBalance > 0 && (
        <div className="px-3 sm:px-6 pb-2">
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                  Wrapped XNT Found
                </p>
                <p className="text-xs text-yellow-500/80 mt-1">
                  You have <strong>{wrappedXNTBalance.toFixed(6)} wrapped XNT</strong>. Unwrap to convert back to native XNT.
                </p>
              </div>
              <button
                onClick={handleUnwrap}
                disabled={isUnwrapping}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap self-start sm:self-auto"
              >
                {isUnwrapping ? 'Unwrapping...' : 'Unwrap'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Swap Button - Mobile optimized */}
      <div className="p-3 sm:p-6 pt-2">
        {!connected ? (
          <button className="w-full py-3.5 sm:py-4 bg-[#5A8FFF] text-white font-semibold rounded-xl hover:opacity-90 transition-opacity text-base sm:text-lg">
            Connect Wallet
          </button>
        ) : !inputAmount || parseFloat(inputAmount) === 0 ? (
          <button 
            disabled 
            className="w-full py-3.5 sm:py-4 bg-[#252730] text-[#5a5d7a] font-semibold rounded-xl cursor-not-allowed text-base sm:text-lg"
          >
            Enter an amount
          </button>
        ) : (
          <button
            onClick={handleSwap}
            disabled={isSwapping}
            className="w-full py-3.5 sm:py-4 bg-[#5A8FFF] text-white font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-base sm:text-lg"
          >
            {isSwapping ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="hidden sm:inline">Swapping...</span>
                <span className="sm:hidden">Swapping...</span>
              </span>
            ) : (
              'Swap'
            )}
          </button>
        )}
      </div>

      {/* Toast Notifications */}
      <ToastContainer>
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            type={toast.type}
            title={toast.title}
            message={toast.message}
            txSignature={toast.txSignature}
            duration={toast.duration}
            onClose={() => hideToast(toast.id)}
          />
        ))}
      </ToastContainer>
    </div>
  );
}

