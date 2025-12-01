import { useState, useEffect } from 'react';
import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';
import { useTokenStore } from '../../store/useTokenStore';
import { TokenSelectModal } from '../TokenSelect/TokenSelectModal';
import { XNT_TOKEN_INFO, isNativeXNT, WRAPPED_XNT_MINT_TESTNET } from '../../config/x1-native';
import { useConnection } from '@solana/wallet-adapter-react';
import { calculateUSDValue } from '../../services/price-service';

interface TokenInputProps {
  label: string;
  mint: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  onMintChange?: (mint: string) => void;
  excludeToken?: string; // Exclude this token from selector (for the other side of swap)
  wrappedXNTBalance?: number; // Optional wrapped XNT balance to display
  readonly?: boolean; // Make input read-only (e.g., when computing)
  onFocus?: () => void; // Optional focus handler
  onBlur?: () => void; // Optional blur handler
}

export function TokenInput({ label, mint, amount, onAmountChange, onMintChange, excludeToken, wrappedXNTBalance = 0, readonly = false, onFocus, onBlur }: TokenInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [usdValue, setUsdValue] = useState<number | null>(null);
  const { connection } = useConnection();
  
  // Use real token store
  const getTokenInfo = useTokenStore(s => s.getTokenInfo);
  const getBalance = useTokenStore(s => s.getBalance);
  
  // Handle empty mint (no token selected)
  if (!mint) {
    const emptyToken = {
      symbol: 'Select token',
      name: 'Select a token',
      logoURI: '',
      decimals: 9,
      address: ''
    };
    
  return (
    <div className="bg-[#0d0e14] rounded-xl p-3 sm:p-4 border border-[#2c2d3a]">
      <div className="flex justify-between items-center mb-2 sm:mb-3 gap-2">
        <span className="text-xs sm:text-sm text-[#5a5d7a] shrink-0">{label}</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            const value = e.target.value;
            if (value === '' || /^\d*\.?\d*$/.test(value)) {
              onAmountChange(value);
            }
          }}
          disabled={true}
          className="flex-1 bg-transparent text-lg sm:text-2xl md:text-3xl font-medium text-white/50 outline-none placeholder-text-tertiary min-w-0 cursor-not-allowed"
        />
        <button
          onClick={() => setIsSelectOpen(true)}
          className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-[#1a1b23] hover:bg-[rgba(255,255,255,0.12)] rounded-xl border border-[#2c2d3a] transition-all duration-200 hover:border-[#5A8FFF] hover:border-opacity-30 min-w-[90px] sm:min-w-[120px] justify-between shrink-0"
        >
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#2c2d3a] flex items-center justify-center text-xs font-bold text-[#8e92bc] shrink-0">
                ?
              </div>
              <span className="font-semibold text-[#8e92bc] text-sm sm:text-base">Select</span>
            </div>
            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-[#8e92bc] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        <TokenSelectModal
          isOpen={isSelectOpen}
          onClose={() => setIsSelectOpen(false)}
          onSelect={(selectedToken) => {
            if (onMintChange) {
              onMintChange(selectedToken.address);
            }
          }}
          excludeToken={excludeToken}
        />
      </div>
    );
  }
  
  const tokenInfo = getTokenInfo(mint);
  const balanceInfo = getBalance(mint);
  
  // Use actual token info or fallback
  // For XNT, always show it properly even if not loaded yet
  // Legacy wrapped XNT address (testnet only)
  const NATIVE_MINT = WRAPPED_XNT_MINT_TESTNET;
  const isXNT = mint === NATIVE_MINT || mint === XNT_TOKEN_INFO.address;
  const isNativeXNT = mint === NATIVE_MINT;
  
  const token = tokenInfo || (isXNT ? {
    symbol: 'XNT',
    name: 'X1 Network Token',
    logoURI: '',
    decimals: 9,
    address: mint
  } : {
    symbol: '???',
    name: 'Select token',
    logoURI: '',
    decimals: 9,
    address: mint
  });
  
  // Use actual balance or show 0
  // For native XNT, getBalance should return native balance (not wrapped)
  let balanceNum = balanceInfo?.uiAmount || 0;
  
  // If this is native XNT and we have a wrapped balance, make sure we're showing native
  // The store should handle this, but double-check here
  if (isNativeXNT && balanceInfo) {
    // Native balance should be from getBalance() which gets native SOL balance
    balanceNum = balanceInfo.uiAmount;
  }
  
  // Format balance display - show wrapped XNT if available
  const balance = balanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const wrappedBalanceDisplay = isNativeXNT && wrappedXNTBalance > 0 
    ? ` (+ ${wrappedXNTBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} wXNT)`
    : '';

  const handleMaxClick = () => {
    // Use raw balance to avoid precision issues, then convert to UI amount
    // Subtract a tiny buffer (0.000001) to account for any rounding/transfer fees
    if (balanceInfo?.balance) {
      const rawBalance = BigInt(balanceInfo.balance);
      const decimals = balanceInfo.decimals || 9;
      const divisor = BigInt(10 ** decimals);
      const uiAmount = Number(rawBalance) / Number(divisor);
      // Subtract tiny buffer to ensure we don't exceed balance
      const safeAmount = Math.max(0, uiAmount - 0.000001);
      onAmountChange(safeAmount.toString());
    } else {
      // Fallback to UI amount if raw balance not available
      const safeAmount = Math.max(0, balanceNum - 0.000001);
      onAmountChange(safeAmount.toString());
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers and decimal point
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      onAmountChange(value);
    }
  };

  const handleHalfClick = () => {
    const half = balanceNum / 2;
    onAmountChange(half > 0 ? half.toString() : '0');
  };
  
  const handleTokenSelect = (selectedToken: TokenInfo) => {
    if (onMintChange) {
      onMintChange(selectedToken.address);
    }
  };

  // Calculate USD value - uses price service (oracle-ready!)
  useEffect(() => {
    const calculateUSD = async () => {
      if (!amount || parseFloat(amount) === 0 || !mint) {
        setUsdValue(null);
        return;
      }

      try {
        const usdAmount = await calculateUSDValue(connection, mint, parseFloat(amount));
        setUsdValue(usdAmount);
      } catch (e) {
        setUsdValue(null);
      }
    };

    calculateUSD();
  }, [amount, mint, connection]);

  return (
    <div className={`
      bg-[#0d0e14] rounded-xl p-3 sm:p-4 border border-[#2c2d3a]
      ${isFocused ? 'ring-2 ring-[#5A8FFF] ring-opacity-30' : ''}
      transition-all duration-200
    `}>
      {/* Label and Balance */}
      <div className="flex justify-between items-center mb-2 sm:mb-3 gap-2">
        <span className="text-xs sm:text-sm text-[#5a5d7a] shrink-0">{label}</span>
        <div className="flex items-center gap-1 sm:gap-2">
          <span className="text-[10px] sm:text-xs text-[#5a5d7a] hidden sm:inline">
            Balance: <span className="text-[#8e92bc]">{balance}</span>
            {wrappedBalanceDisplay && (
              <span className="text-[#5a5d7a] text-[10px]">{wrappedBalanceDisplay}</span>
            )}
          </span>
          <span className="text-[10px] text-[#5a5d7a] sm:hidden">
            <span className="text-[#8e92bc]">{balance}</span>
          </span>
          <button
            onClick={handleHalfClick}
            className="px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.12)] text-[#8e92bc] rounded transition-colors active:scale-95"
          >
            HALF
          </button>
          <button
            onClick={handleMaxClick}
            className="px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.12)] text-[#8e92bc] rounded transition-colors active:scale-95"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Amount Input and Token Selector - Mobile optimized */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Amount Input */}
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={handleAmountChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          readOnly={readonly}
          className={`
            flex-1 bg-transparent text-lg sm:text-2xl md:text-3xl font-medium text-white
            outline-none placeholder-text-tertiary min-w-0
            [-webkit-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
            ${readonly ? 'opacity-60 cursor-not-allowed' : ''}
          `}
        />

        {/* Token Selector Button - Mobile optimized */}
        <button
          onClick={() => setIsSelectOpen(true)}
          className="
            flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-[#1a1b23] hover:bg-[rgba(255,255,255,0.12)]
            rounded-xl border border-divider-bg
            transition-all duration-200 hover:border-secondary hover:border-opacity-30 active:scale-95
            min-w-[90px] sm:min-w-[120px] justify-between shrink-0
          "
        >
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            {/* Token Logo */}
            {token.logoURI ? (
              <img 
                src={token.logoURI} 
                alt={token.symbol}
                className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-bg-dark shrink-0"
              />
            ) : (
              <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-xs font-bold text-btn-solid-text shrink-0">
                {token.symbol?.charAt(0) || '?'}
              </div>
            )}
            
            {/* Token Symbol */}
            <span className="font-semibold text-white text-sm sm:text-base truncate">{token.symbol}</span>
          </div>

          {/* Dropdown Arrow */}
          <svg className="w-3 h-3 sm:w-4 sm:h-4 text-[#8e92bc] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* USD Value - XNT = $1, other tokens priced from XNT pool */}
      {usdValue !== null && usdValue > 0 && (
        <div className="mt-2 text-right">
          <span className="text-xs text-[#5a5d7a]">
            ≈ ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
      
      {/* Token Select Modal */}
      <TokenSelectModal
        isOpen={isSelectOpen}
        onClose={() => setIsSelectOpen(false)}
        onSelect={handleTokenSelect}
        excludeToken={excludeToken}
      />
    </div>
  );
}

