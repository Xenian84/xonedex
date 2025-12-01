import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { buildUnifiedRemoveLiquidityTransaction } from '../../utils/unifiedLiquidity';
import { derivePoolVaults } from '../../utils/v2AmmPool';
import { fetchV2AmmPoolState } from '../../utils/v2AmmPoolState';
import { getTokenAccountBalance } from '../../utils/tokenAccount';
import { isNativePool, derivePoolPda, deriveTokenVault, getPoolState } from '../../utils/nativePool';
import { isNativeXNT, NATIVE_XNT_MARKER } from '../../config/x1-native';
import { useNetworkStore } from '../../store/useNetworkStore';
import BN from 'bn.js';
import { useTokenStore } from '../../store/useTokenStore';
import { useSettingsStore } from '../../store/useSettingsStore';

interface RemoveLiquidityModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolMint: string;
  poolState: string;
  mint0: string;
  mint1: string;
  token0Symbol: string;
  token1Symbol: string;
  onSuccess: (signature: string) => void;
  onError: (error: string) => void;
}

export function RemoveLiquidityModal({
  isOpen,
  onClose,
  poolMint,
  poolState,
  mint0,
  mint1,
  token0Symbol,
  token1Symbol,
  onSuccess,
  onError,
}: RemoveLiquidityModalProps) {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [lpAmount, setLpAmount] = useState<string>('');
  const [lpBalance, setLpBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [estimatedToken0, setEstimatedToken0] = useState<string>('0');
  const [estimatedToken1, setEstimatedToken1] = useState<string>('0');
  const [feeDisplay, setFeeDisplay] = useState<string>('...');
  const loadBalances = useTokenStore(s => s.loadBalances);
  const getComputedPriorityFee = useSettingsStore(s => s.getComputedPriorityFee);

  // Load LP balance when modal opens
  useEffect(() => {
    if (isOpen && publicKey && poolMint) {
      loadLPBalance();
    }
  }, [isOpen, publicKey, poolMint]);

  const loadLPBalance = async () => {
    if (!publicKey || !poolMint) return;
    
    try {
      const poolMintPubkey = new PublicKey(poolMint);
      const userPoolAta = await getAssociatedTokenAddress(poolMintPubkey, publicKey);
      const lpBalanceBigInt = await getTokenAccountBalance(connection, userPoolAta);
      const lpBalanceUi = Number(lpBalanceBigInt) / 1e9;
      setLpBalance(lpBalanceUi);
    } catch (e) {
      console.error('Error loading LP balance:', e);
      setLpBalance(0);
    }
  };

  const calculateEstimatedTokens = useCallback(async () => {
    if (!lpAmount || !poolState || parseFloat(lpAmount) <= 0) {
      setEstimatedToken0('0');
      setEstimatedToken1('0');
      return;
    }

    try {
      const poolStatePubkey = new PublicKey(poolState);
      
      // Check if this is a native pool
      const isNative = await isNativePool(connection, poolStatePubkey);
      
      let vault0Balance: number;
      let vault1Balance: number;
      let poolData: any;
      
      if (isNative) {
        console.log('🔵 Using native pool logic for estimates');
        
        // Get native pool data
        const nativePoolData = await getPoolState(connection, poolStatePubkey);
        if (!nativePoolData) {
          console.log('⚠️ No native pool data found');
          return;
        }
        
        poolData = nativePoolData;
        
        // Get dynamic program ID from network store
        const networkConfig = useNetworkStore.getState().config;
        const programId = new PublicKey(networkConfig.ammProgramId);
        
        // For native pools, get reserves differently
        const [poolPda] = derivePoolPda(poolStatePubkey, programId);
        const [tokenVault] = deriveTokenVault(poolStatePubkey, programId);
        
        // Get native XNT reserve (from pool PDA lamports minus rent)
        const poolPdaBalance = await connection.getBalance(poolPda);
        const rentMinimum = await connection.getMinimumBalanceForRentExemption(80); // Pool state size
        const nativeXntReserve = poolPdaBalance - rentMinimum;
        
        // Get token vault balance
        const tokenVaultBalanceBigInt = await getTokenAccountBalance(connection, tokenVault);
        const tokenVaultBalance = Number(tokenVaultBalanceBigInt);
        
        // Determine which is which based on native_mint_index
        if (nativePoolData.nativeMintIndex === 0) {
          vault0Balance = nativeXntReserve;
          vault1Balance = tokenVaultBalance;
        } else {
          vault0Balance = tokenVaultBalance;
          vault1Balance = nativeXntReserve;
        }
        
        console.log('📊 Native Pool Data:', {
          nativeReserve: nativeXntReserve / 1e9,
          tokenVaultBalance: tokenVaultBalance / 1e9,
          vault0Balance: vault0Balance / 1e9,
          vault1Balance: vault1Balance / 1e9,
          nativeMintIndex: nativePoolData.nativeMintIndex,
        });
      } else {
        console.log('🔴 Using regular pool logic for estimates');
        
        // Regular pool logic
        poolData = await fetchV2AmmPoolState(connection, poolStatePubkey);
        if (!poolData) {
          console.log('⚠️ No pool data found');
          return;
        }

        const { vault0, vault1 } = derivePoolVaults(poolStatePubkey);
        
        // Get vault balances - works with both Token and Token2022
        const [vault0BalanceBigInt, vault1BalanceBigInt] = await Promise.all([
          getTokenAccountBalance(connection, vault0),
          getTokenAccountBalance(connection, vault1)
        ]);
        
        vault0Balance = Number(vault0BalanceBigInt);
        vault1Balance = Number(vault1BalanceBigInt);
      }
      
      const totalSupply = Number(poolData.totalAmountMinted);

      console.log('📊 Pool Data:', {
        vault0Balance: vault0Balance / 1e9,
        vault1Balance: vault1Balance / 1e9,
        totalSupply: totalSupply / 1e9,
        lpAmount,
      });

      if (totalSupply === 0) {
        console.log('⚠️ Total supply is 0');
        return;
      }

      // Calculate proportion
      const lpAmountRaw = parseFloat(lpAmount) * 1e9;
      const proportion = lpAmountRaw / totalSupply;

      // Estimated tokens
      const est0 = (vault0Balance * proportion) / 1e9;
      const est1 = (vault1Balance * proportion) / 1e9;

      console.log('💰 Estimated returns:', { est0, est1, proportion });

      setEstimatedToken0(est0.toFixed(6));
      setEstimatedToken1(est1.toFixed(6));
      
      // Calculate LP earning rate from pool state
      const lpFee = (Number(poolData.feeNumerator) / Number(poolData.feeDenominator)) * 100;
      setFeeDisplay(lpFee.toFixed(2)); // Show LP earning rate, not total fee
    } catch (e) {
      console.error('❌ Error calculating estimates:', e);
      setEstimatedToken0('0');
      setEstimatedToken1('0');
      setFeeDisplay('0.3'); // Default LP earning rate
    }
  }, [lpAmount, poolState, connection]);

  // Calculate estimated tokens when LP amount changes
  useEffect(() => {
    if (lpAmount && poolState) {
      calculateEstimatedTokens();
    } else {
      setEstimatedToken0('0');
      setEstimatedToken1('0');
    }
  }, [lpAmount, poolState, calculateEstimatedTokens]);

  const handleMaxClick = () => {
    setLpAmount(lpBalance.toString());
  };

  const handleRemoveLiquidity = async () => {
    if (!publicKey || !lpAmount) {
      onError('Please fill in all fields');
      return;
    }

    setIsLoading(true);

    try {
      if (!signTransaction || !sendTransaction) {
        throw new Error('Wallet not connected');
      }
      
      // Convert LP amount to raw amount
      const [intLp, decLp = ''] = lpAmount.split('.');
      const paddedDecLp = (decLp + '0'.repeat(9)).slice(0, 9);
      const rawLpAmountStr = intLp + paddedDecLp;
      const lpAmountBN = new BN(rawLpAmountStr);
      
      // Get priority fee in lamports
      const priorityFeeXNT = getComputedPriorityFee();
      const priorityFeeInLamports = Math.floor(priorityFeeXNT * 1e9);

      // Use unified remove liquidity (supports both native and regular pools)
      const transaction = await buildUnifiedRemoveLiquidityTransaction(
        connection,
        publicKey,
        mint0, // Pass as string to support NATIVE_XNT_MARKER
        mint1, // Pass as string to support NATIVE_XNT_MARKER
        lpAmountBN,
        50 // 0.5% slippage tolerance
      );

      if (!transaction) {
        throw new Error('Failed to build remove liquidity transaction');
      }

      // Sign transaction
      const signedTx = await signTransaction(transaction);
      console.log('✅ Transaction signed successfully');

      // Send transaction (skip preflight for Backpack/X1 compatibility)
      const rawTransaction = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true, // Required for Backpack wallet on X1
        maxRetries: 3,
      });

      console.log('📤 Transaction sent:', signature);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log('✅ Liquidity removed successfully!');
      
      onSuccess(signature);
      
      // Refresh balances
      setTimeout(async () => {
        await loadBalances(connection, publicKey);
      }, 2000);

      // Close modal and reset
      setLpAmount('');
      onClose();
    } catch (err: any) {
      console.error('❌ Error removing liquidity:', err);
      onError(err.message || 'Failed to remove liquidity');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div 
          className="bg-[#1a1b23] rounded-2xl border border-[#2c2d3a] max-w-md w-full shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[#2c2d3a]">
            <h2 className="text-xl font-semibold text-white">Remove Liquidity</h2>
            <button
              onClick={onClose}
              className="text-[#8e92bc] hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Pool Info */}
            <div className="flex items-center gap-2 text-white font-semibold">
              <span>{token0Symbol} / {token1Symbol}</span>
              <span className="text-xs bg-[#0d0e14] px-2 py-1 rounded text-[#00FF88]">You earned {feeDisplay}%</span>
            </div>

            {/* LP Amount Input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-[#5a5d7a]">LP Tokens to Remove</label>
                <span className="text-xs text-[#8e92bc]">
                  Balance: {lpBalance.toFixed(6)}
                </span>
              </div>
              <div className="bg-[#0d0e14] rounded-xl p-4 border border-[#2c2d3a] relative">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={lpAmount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setLpAmount(value);
                    }
                  }}
                  className="w-full bg-transparent text-2xl font-medium text-white outline-none placeholder-[#5a5d7a] pr-20"
                />
                <button
                  onClick={handleMaxClick}
                  disabled={lpBalance === 0}
                  className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1.5 text-sm bg-[#5A8FFF]/10 hover:bg-[#5A8FFF]/20 text-[#5A8FFF] rounded-lg border border-[#5A8FFF]/30 hover:border-[#5A8FFF]/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Estimated Tokens */}
            <div className="bg-[#0d0e14] rounded-xl p-4 border border-[#2c2d3a]">
              <div className="text-sm text-[#5a5d7a] mb-3">You will receive:</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">{token0Symbol}</span>
                  <span className="text-lg text-white font-mono font-semibold">
                    {parseFloat(estimatedToken0) > 0 ? estimatedToken0 : '0'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">{token1Symbol}</span>
                  <span className="text-lg text-white font-mono font-semibold">
                    {parseFloat(estimatedToken1) > 0 ? estimatedToken1 : '0'}
                  </span>
                </div>
              </div>
            </div>

            {/* Info Box */}
            {parseFloat(lpAmount) > 0 && parseFloat(estimatedToken0) > 0 && (
              <div className="bg-[#0d0e14] rounded-xl p-4 border border-[#2c2d3a]">
                <div className="flex gap-2 text-xs text-[#8e92bc]">
                  <svg className="w-4 h-4 text-[#22D1F8] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    Removing liquidity will burn your LP tokens and return the underlying {token0Symbol} and {token1Symbol} tokens to your wallet.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 p-6 border-t border-[#2c2d3a]">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 bg-[#0d0e14] text-white py-3 rounded-xl font-semibold hover:bg-[#1a1b23] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleRemoveLiquidity}
              disabled={isLoading || !lpAmount || parseFloat(lpAmount) <= 0 || parseFloat(lpAmount) > lpBalance}
              className="flex-1 bg-[#5A8FFF] text-white py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Removing...' : 'Remove Liquidity'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

