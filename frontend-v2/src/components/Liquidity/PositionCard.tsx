import { useEffect, useState, useRef } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { fetchV2AmmPoolState } from '../../utils/v2AmmPoolState';
import { derivePoolVaults } from '../../utils/v2AmmPool';
import { getTokenAccountBalance } from '../../utils/tokenAccount';
import { getPoolState, deriveTokenVault, derivePoolPda } from '../../utils/nativePool';
import { NATIVE_XNT_MARKER } from '../../config/x1-native';
import { useNetworkStore } from '../../store/useNetworkStore';
import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';

interface PositionCardProps {
  position: {
    mint0: string;
    mint1: string;
    lpBalance: number;
    poolMint: string;
    poolState: string;
    token0Symbol: string;
    token1Symbol: string;
  };
  token0Info?: TokenInfo;
  token1Info?: TokenInfo;
  onAddMore: () => void;
  onRemove: () => void;
  index?: number; // For staggered loading
}

export function PositionCard({ position, token0Info, token1Info, onAddMore, onRemove, index = 0 }: PositionCardProps) {
  const { connection } = useConnection();
  const [estimatedToken0, setEstimatedToken0] = useState<string>('...');
  const [estimatedToken1, setEstimatedToken1] = useState<string>('...');
  const [poolShare, setPoolShare] = useState<string>('...');
  const [feePercent, setFeePercent] = useState<string>('...');
  const [isLoading, setIsLoading] = useState(true);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  useEffect(() => {
    // Stagger the loading to avoid overwhelming the RPC
    const delay = index * 500; // 500ms delay between each position
    const timer = setTimeout(() => {
      calculateUnderlyingAmounts();
    }, delay);

    return () => clearTimeout(timer);
  }, [position.lpBalance, position.poolState, index]);

  const calculateUnderlyingAmounts = async (retryCount = 0) => {
    if (!position.lpBalance || position.lpBalance === 0) {
      setEstimatedToken0('0');
      setEstimatedToken1('0');
      setPoolShare('0');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const poolStatePubkey = new PublicKey(position.poolState);
      
      // Check if this is a native XNT pool
      const isNativeXNTPool = position.mint0 === NATIVE_XNT_MARKER || position.mint1 === NATIVE_XNT_MARKER;
      
      let vault0Balance: number;
      let vault1Balance: number;
      let totalSupply: number;
      let poolData: any;
      
      if (isNativeXNTPool) {
        console.log(`🔵 Native XNT pool detected for ${position.token0Symbol}/${position.token1Symbol}`);
        
        // Fetch native pool state
        poolData = await getPoolState(connection, poolStatePubkey);
        
        if (!poolData) {
          console.warn(`⚠️ No native pool data found for ${position.token0Symbol}/${position.token1Symbol}`);
          throw new Error('Native pool data not found');
        }
        
        // Get dynamic program ID from network store
        const networkConfig = useNetworkStore.getState().config;
        const programId = new PublicKey(networkConfig.ammProgramId);
        
        // Get native reserve and token vault balance
        const [poolPda] = derivePoolPda(poolStatePubkey, programId);
        const [tokenVault] = deriveTokenVault(poolStatePubkey, programId);
        
        const tokenVaultBalanceBigInt = await getTokenAccountBalance(connection, tokenVault);
        const nativeReserve = poolData.nativeReserve;
        
        // Determine order based on nativeMintIndex
        if (poolData.nativeMintIndex === 0) {
          // Token0 is native XNT
          vault0Balance = Number(nativeReserve);
          vault1Balance = Number(tokenVaultBalanceBigInt);
        } else {
          // Token1 is native XNT
          vault0Balance = Number(tokenVaultBalanceBigInt);
          vault1Balance = Number(nativeReserve);
        }
        
        totalSupply = Number(poolData.totalAmountMinted);
        
        console.log(`📊 ${position.token0Symbol}/${position.token1Symbol} Native Pool Data:`, {
          poolPda: poolPda.toBase58(),
          tokenVault: tokenVault.toBase58(),
          nativeReserve: Number(nativeReserve) / 1e9,
          tokenVaultBalance: Number(tokenVaultBalanceBigInt) / 1e9,
          vault0Balance: vault0Balance / 1e9,
          vault1Balance: vault1Balance / 1e9,
          totalSupply: totalSupply / 1e9,
          lpBalance: position.lpBalance,
        });
      } else {
        // Regular V2 AMM pool
        poolData = await fetchV2AmmPoolState(connection, poolStatePubkey);
        
        if (!poolData) {
          console.warn(`⚠️ No pool data found for ${position.token0Symbol}/${position.token1Symbol}`);
          throw new Error('Pool data not found');
        }

        const { vault0, vault1 } = derivePoolVaults(poolStatePubkey);
        
        // Get vault balances with timeout - using custom utility that works with Token2022
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        );
        
        const [vault0BalanceBigInt, vault1BalanceBigInt] = await Promise.race([
          Promise.all([
            getTokenAccountBalance(connection, vault0),
            getTokenAccountBalance(connection, vault1)
          ]),
          timeoutPromise
        ]) as bigint[];
        
        vault0Balance = Number(vault0BalanceBigInt);
        vault1Balance = Number(vault1BalanceBigInt);
        totalSupply = Number(poolData.totalAmountMinted);

        console.log(`📊 ${position.token0Symbol}/${position.token1Symbol} Pool Data:`, {
          vault0: vault0.toBase58(),
          vault1: vault1.toBase58(),
          vault0Balance: vault0Balance / 1e9,
          vault1Balance: vault1Balance / 1e9,
          totalSupply: totalSupply / 1e9,
          lpBalance: position.lpBalance,
        });
      }

      if (totalSupply === 0) {
        console.warn(`⚠️ Total supply is 0 for ${position.token0Symbol}/${position.token1Symbol}`);
        setEstimatedToken0('0');
        setEstimatedToken1('0');
        setPoolShare('0');
        setIsLoading(false);
        return;
      }

      // Calculate proportion
      const lpAmountRaw = position.lpBalance * 1e9;
      const proportion = lpAmountRaw / totalSupply;

      // Estimated tokens
      const est0 = (vault0Balance * proportion) / 1e9;
      const est1 = (vault1Balance * proportion) / 1e9;
      const sharePercentage = (proportion * 100).toFixed(4);

      // Calculate LP earning rate from pool state
      const lpFee = (Number(poolData.feeNumerator) / Number(poolData.feeDenominator)) * 100;
      const protocolFee = poolData.protocolFeeBps ? poolData.protocolFeeBps / 100 : 0;
      const totalFee = lpFee + protocolFee;

      console.log(`✅ ${position.token0Symbol}/${position.token1Symbol} Calculated:`, {
        est0,
        est1,
        sharePercentage,
        proportion,
        lpFee: `${lpFee}%`,
        protocolFee: `${protocolFee}%`,
        totalFee: `${totalFee}%`,
      });

      setEstimatedToken0(est0.toFixed(6));
      setEstimatedToken1(est1.toFixed(6));
      setPoolShare(sharePercentage);
      setFeePercent(lpFee.toFixed(2)); // Store LP fee (earning rate), not total fee
      setIsLoading(false);
      retryCountRef.current = 0; // Reset retry count on success
    } catch (e: any) {
      console.error(`❌ Error calculating underlying amounts for ${position.token0Symbol}/${position.token1Symbol}:`, e.message || e);
      
      // Retry logic
      if (retryCount < maxRetries) {
        const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s
        console.log(`🔄 Retrying ${position.token0Symbol}/${position.token1Symbol} in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        setTimeout(() => {
          calculateUnderlyingAmounts(retryCount + 1);
        }, retryDelay);
      } else {
        // After max retries, show dash instead of "Error"
        setEstimatedToken0('—');
        setEstimatedToken1('—');
        setPoolShare('—');
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="bg-[#0d0e14] border border-[#2c2d3a] rounded-xl p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2 shrink-0">
            {/* Token 0 Image */}
            {token0Info?.logoURI ? (
              <img 
                src={token0Info.logoURI} 
                alt={token0Info.symbol}
                className="w-10 h-10 rounded-full bg-[#1a1b23]"
                onError={(e) => {
                  // Fallback to letter avatar if image fails
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div className={`w-10 h-10 bg-gradient-to-br from-[#5A8FFF] to-[#ff4d9f] rounded-full flex items-center justify-center text-white font-semibold ${token0Info?.logoURI ? 'hidden' : ''}`}>
              {token0Info?.symbol?.charAt(0) || position.token0Symbol.charAt(0)}
            </div>
            
            {/* Token 1 Image */}
            {token1Info?.logoURI ? (
              <img 
                src={token1Info.logoURI} 
                alt={token1Info.symbol}
                className="w-10 h-10 rounded-full bg-[#1a1b23] border-2 border-[#0d0e14]"
                onError={(e) => {
                  // Fallback to letter avatar if image fails
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div className={`w-10 h-10 bg-gradient-to-br from-[#7ba8ff] to-[#22d1f8] rounded-full flex items-center justify-center text-white font-semibold border-2 border-[#0d0e14] ${token1Info?.logoURI ? 'hidden' : ''}`}>
              {token1Info?.symbol?.charAt(0) || position.token1Symbol.charAt(0)}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-white font-semibold text-sm sm:text-base">
              {position.token0Symbol} / {position.token1Symbol}
            </div>
            <div className="text-xs text-[#5a5d7a]">
              You earn <span className="text-[#00FF88]">{feePercent}%</span> • {poolShare}% of pool
            </div>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-white font-semibold text-sm sm:text-base">
            {position.lpBalance.toFixed(6)} LP
          </div>
          <div className="text-xs text-[#8e92bc] mt-1">
            {isLoading ? (
              <span className="flex items-center gap-1">
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading...
              </span>
            ) : (
              <span>
                {estimatedToken0} {position.token0Symbol} + {estimatedToken1} {position.token1Symbol}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onAddMore}
          className="flex-1 bg-[#0d0e14] text-white py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-semibold hover:bg-[#1a1b23] transition-colors border border-[#2c2d3a] active:scale-95"
        >
          Add More
        </button>
        <button
          onClick={onRemove}
          className="flex-1 bg-[#5A8FFF] text-white py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-semibold hover:opacity-90 transition-opacity active:scale-95"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

