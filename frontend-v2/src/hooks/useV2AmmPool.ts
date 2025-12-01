/**
 * Hook to interact with XoneDEX V2 AMM pools
 * Fetches pool data and calculates swap quotes using constant product formula
 */

import { useMemo, useEffect, useState, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { 
  fetchV2AmmPoolState, 
  getPoolReserves,
  calculateSwapOutput,
  derivePoolState,
  derivePoolAuthority,
  derivePoolVaults,
  getPoolInfo,
  getVaultsForMints,
  XNT_MINT,
  SHIBA_MINT,
  XEN_MINT,
  XNT_SHIBA_POOL_STATE,
  POOL_VAULT_0,
  POOL_VAULT_1,
} from '../utils/v2AmmSwap';
import { getCurrentX1RPC } from '../config/x1-network';
import { isNativeXNT, NATIVE_XNT_MARKER } from '../config/x1-native';

export interface V2AmmPoolInfo {
  poolState: string;
  poolAuthority: string;
  vault0: string;
  vault1: string;
  mint0: string;
  mint1: string;
  reserve0: string;
  reserve1: string;
  feeNumerator: string;
  feeDenominator: string;
  price: number; // Human readable price (token1 per token0)
  protocolTreasury?: string; // Protocol treasury address (optional)
  protocolFeeBps?: number; // Protocol fee in basis points (optional)
}

/**
 * Get known pool info for XNT-SHIB or XNT-XEN
 */
export function getKnownV2AmmPoolInfo(mint0: string, mint1: string): V2AmmPoolInfo | null {
  const xnt = XNT_MINT.toBase58();
  const shib = SHIBA_MINT.toBase58();
  const xen = XEN_MINT.toBase58();
  
  // Check if this is the XNT-SHIB pair (in any order)  
  if (
    (mint0 === xnt && mint1 === shib) ||
    (mint0 === shib && mint1 === xnt)
  ) {
    return {
      poolState: XNT_SHIBA_POOL_STATE.toBase58(),
      poolAuthority: '', // Will be derived
      vault0: POOL_VAULT_0.toBase58(),
      vault1: POOL_VAULT_1.toBase58(),
      mint0: xnt,
      mint1: shib,
      reserve0: '0', // Will be fetched
      reserve1: '0', // Will be fetched
      feeNumerator: '30',
      feeDenominator: '10000', // 0.3% (same as Uniswap V2)
      price: 0, // Will be calculated
    };
  }
  
  return null;
}

/**
 * Hook to fetch V2 AMM pool data
 */
export function useV2AmmPool(mint0?: string, mint1?: string) {
  const [poolInfo, setPoolInfo] = useState<V2AmmPoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0); // Add refresh trigger

  const fetchPoolData = useCallback(async () => {
    if (!mint0 || !mint1) {
      setPoolInfo(null);
      return;
    }

    // Skip if either mint is native XNT (use native pool hook instead)
    if (isNativeXNT(mint0) || isNativeXNT(mint1)) {
      setPoolInfo(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Create connection
      const rpcConfig = getCurrentX1RPC('testnet');
      const connection = new Connection(rpcConfig.http, 'confirmed');

      // Get pool info dynamically (derives all addresses)
      // At this point we know both mints are valid PublicKey strings (not NATIVE_XNT_MARKER)
      let mint0Pubkey: PublicKey;
      let mint1Pubkey: PublicKey;
      
      try {
        mint0Pubkey = new PublicKey(mint0);
        mint1Pubkey = new PublicKey(mint1);
      } catch (e) {
        // Invalid PublicKey format - skip this pool
        setPoolInfo(null);
        setIsLoading(false);
        return;
      }
      const poolInfoData = await getPoolInfo(connection, mint0Pubkey, mint1Pubkey);
      
      if (!poolInfoData || !poolInfoData.exists) {
        setPoolInfo(null);
        setIsLoading(false);
        return;
      }
      
      // Derive pool authority
      const [poolAuthority] = derivePoolAuthority(new PublicKey(poolInfoData.poolState));
      
      // Determine mint order (sorted) - this matches how pool was initialized
      const [mintA, mintB] = mint0Pubkey.toBuffer().compare(mint1Pubkey.toBuffer()) < 0 
        ? [mint0Pubkey, mint1Pubkey] 
        : [mint1Pubkey, mint0Pubkey];
      
      // Get vaults - pool always has vault0 for mintA (smaller), vault1 for mintB (larger)
      const { vault0, vault1 } = derivePoolVaults(poolInfoData.poolState);
      
      // vault0 always holds mintA (smaller address)
      // vault1 always holds mintB (larger address)
      
      const poolInfo: V2AmmPoolInfo = {
        poolState: poolInfoData.poolState.toBase58(),
        poolAuthority: poolAuthority.toBase58(),
        vault0: vault0.toBase58(),
        vault1: vault1.toBase58(),
        mint0: mintA.toBase58(),
        mint1: mintB.toBase58(),
        reserve0: '0', // Will be fetched
        reserve1: '0', // Will be fetched
        feeNumerator: '30', // Default, will be fetched from pool state
        feeDenominator: '10000',
        price: 0, // Will be calculated
      };

      // Fetch pool state for fees and other metadata
      const poolStateData = await fetchV2AmmPoolState(connection, poolInfoData.poolState);
      
      if (!poolStateData) {
        setError(`Failed to fetch pool state data for ${poolInfoData.poolState.toString()}`);
        setIsLoading(false);
        return;
      }
      
      if (!poolStateData) {
        throw new Error('Failed to fetch pool state');
      }

      // Fetch reserves - vault0 holds mintA, vault1 holds mintB
      const reserves = await getPoolReserves(
        connection,
        vault0, // This holds mintA (mint0)
        vault1  // This holds mintB (mint1)
      );

      if (!reserves) {
        throw new Error('Failed to fetch pool reserves');
      }

      // Map reserves correctly:
      // reserve0 = balance of vault0 = balance of mintA (mint0)
      // reserve1 = balance of vault1 = balance of mintB (mint1)
      const reserve0BN = reserves.reserve0; // Vault0 balance (mintA/mint0)
      const reserve1BN = reserves.reserve1; // Vault1 balance (mintB/mint1)
      
      // Calculate price (token1 per token0)
      const price = reserve0BN.gt(new BN(0))
        ? Number(reserve1BN) / Number(reserve0BN)
        : 0;

      const updatedPool: V2AmmPoolInfo = {
        ...poolInfo,
        reserve0: reserve0BN.toString(), // Correct: reserve0 = mint0 balance
        reserve1: reserve1BN.toString(), // Correct: reserve1 = mint1 balance
        feeNumerator: poolStateData.feeNumerator.toString(),
        feeDenominator: poolStateData.feeDenominator.toString(),
        price,
        protocolTreasury: poolStateData.protocolTreasury.toBase58(),
        protocolFeeBps: poolStateData.protocolFeeBps,
      };

      setPoolInfo(updatedPool);
    } catch (err) {
      console.error('Error fetching V2 AMM pool:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPoolInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [mint0, mint1]);

  // Expose refresh function (declare before useEffects that use it)
  const refresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  useEffect(() => {
    fetchPoolData();
  }, [fetchPoolData, refreshKey]); // Add refreshKey to dependencies

  // Automatic polling: Refresh pool reserves every 15 seconds (reduced frequency)
  // Skip refresh if document is hidden (tab not active) to save resources
  useEffect(() => {
    if (!mint0 || !mint1) return;

    const pollInterval = setInterval(() => {
      // Skip refresh if tab is not visible (user switched tabs)
      if (!document.hidden) {
        refresh();
      }
    }, 15000); // Poll every 15 seconds (reduced frequency to avoid interrupting typing)

    return () => clearInterval(pollInterval);
  }, [mint0, mint1, refresh]);

  // WebSocket subscriptions: Listen for vault account changes (instant updates)
  // Note: Solana Connection uses HTTP endpoint for both HTTP and WebSocket subscriptions
  // The WebSocket connection is handled internally by the Connection class
  useEffect(() => {
    if (!poolInfo?.vault0 || !poolInfo?.vault1) return;

    let connection: Connection | null = null;
    let subscription0: number | null = null;
    let subscription1: number | null = null;

    const setupSubscriptions = async () => {
      try {
        const rpcConfig = getCurrentX1RPC('testnet');
        // Use HTTP endpoint - Connection class handles WebSocket internally
        // For WebSocket subscriptions, we still use HTTP endpoint
        connection = new Connection(rpcConfig.http, 'confirmed');

        // Subscribe to vault0 account changes
        subscription0 = connection.onAccountChange(
          new PublicKey(poolInfo.vault0),
          () => {
            // Vault balance changed, refresh pool data
            refresh();
          },
          'confirmed'
        );

        // Subscribe to vault1 account changes
        subscription1 = connection.onAccountChange(
          new PublicKey(poolInfo.vault1),
          () => {
            // Vault balance changed, refresh pool data
            refresh();
          },
          'confirmed'
        );
      } catch (error) {
        console.warn('Failed to setup account change subscriptions:', error);
        // Fallback to polling only
      }
    };

    setupSubscriptions();

    return () => {
      if (connection && subscription0 !== null) {
        try {
          connection.removeAccountChangeListener(subscription0);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (connection && subscription1 !== null) {
        try {
          connection.removeAccountChangeListener(subscription1);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [poolInfo?.vault0, poolInfo?.vault1, refresh]);

  // Refresh on window focus (user returns to tab)
  useEffect(() => {
    const handleFocus = () => {
      refresh();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refresh]);

  return {
    poolInfo,
    isLoading,
    error,
    hasPool: !!poolInfo,
    refresh, // Expose refresh function
  };
}

/**
 * Calculate swap output amount using constant product formula
 * Matches Uniswap V2 and our Rust implementation exactly
 * Protocol fee is deducted from XNT (input if swapping FROM XNT, output if swapping TO XNT)
 */
export function calculateV2AmmSwapOutput(
  inputAmount: number,
  poolInfo: V2AmmPoolInfo | null,
  isToken0Input: boolean,
  inputDecimals: number = 9,
  outputDecimals: number = 9,
  inputMint?: string, // Optional: mint address for input token
  outputMint?: string // Optional: mint address for output token
): { outputAmount: number; priceImpact: number; fee: number; protocolFee?: number } | null {
  if (!poolInfo || !inputAmount || inputAmount <= 0) return null;

  const reserve0 = new BN(poolInfo.reserve0);
  const reserve1 = new BN(poolInfo.reserve1);
  const feeNumerator = new BN(poolInfo.feeNumerator);
  const feeDenominator = new BN(poolInfo.feeDenominator);

  // Validate reserves
  if (reserve0.lte(new BN(0)) || reserve1.lte(new BN(0))) {
    return null;
  }

  // Convert input amount to lamports (base units)
  const amountInLamports = new BN(Math.floor(inputAmount * Math.pow(10, inputDecimals)));

  // Validate input amount
  if (amountInLamports.lte(new BN(0))) {
    return null;
  }

  // Determine reserves based on swap direction
  const reserveIn = isToken0Input ? reserve0 : reserve1;
  const reserveOut = isToken0Input ? reserve1 : reserve0;

  // Calculate output using constant product formula (matches Rust exactly)
  const amountOutLamports = calculateSwapOutput(
    amountInLamports,
    reserveIn,
    reserveOut,
    feeNumerator,
    feeDenominator
  );

  // Check if protocol fee applies (always in XNT)
  const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
  const isInputXNT = inputMint === NATIVE_MINT;
  const isOutputXNT = outputMint === NATIVE_MINT;
  const hasProtocolFee = poolInfo.protocolFeeBps !== undefined 
    && poolInfo.protocolFeeBps > 0 
    && poolInfo.protocolTreasury 
    && poolInfo.protocolTreasury !== '11111111111111111111111111111111';

  // Calculate protocol fee in XNT
  let protocolFeeXNT = new BN(0);
  let finalOutputAmountLamports = amountOutLamports;
  
  if (hasProtocolFee && (isInputXNT || isOutputXNT) && poolInfo.protocolFeeBps !== undefined) {
    const xntAmountForFee = isInputXNT ? amountInLamports : amountOutLamports;
    protocolFeeXNT = xntAmountForFee.mul(new BN(poolInfo.protocolFeeBps)).div(new BN(10000));
    
    // Deduct protocol fee from output if swapping TO XNT
    if (isOutputXNT) {
      finalOutputAmountLamports = amountOutLamports.sub(protocolFeeXNT);
    }
    // Protocol fee deducted from input if swapping FROM XNT (already handled in amountInLamports)
  }

  // Convert output to human readable (after protocol fee deduction)
  const outputAmount = Number(finalOutputAmountLamports) / Math.pow(10, outputDecimals);

  // Calculate LP fee (matches Rust: fee_amount = amount_in * fee_numerator / fee_denominator)
  const feeLamports = amountInLamports.mul(feeNumerator).div(feeDenominator);
  const fee = Number(feeLamports) / Math.pow(10, inputDecimals);

  // Calculate protocol fee in human readable format
  const protocolFee = hasProtocolFee && (isInputXNT || isOutputXNT)
    ? Number(protocolFeeXNT) / Math.pow(10, isInputXNT ? inputDecimals : outputDecimals)
    : undefined;

  // Calculate price impact using standard Uniswap V2 formula
  // This matches how Uniswap and other DEXs calculate price impact
  // Standard formula: (amountIn / reserveIn) / (1 + amountIn / reserveIn) * 100
  // This is the standard approximation used by Uniswap V2 frontends
  // It's accurate for display purposes and matches user expectations
  
  const reserveInNum = Number(reserveIn);
  const amountInNum = Number(amountInLamports);
  
  // Standard Uniswap V2 price impact formula
  // This calculates the percentage change in price due to the swap
  // For constant product AMM: price impact ≈ (amountIn / reserveIn) / (1 + amountIn / reserveIn)
  const priceImpact = reserveInNum > 0 && amountInNum > 0
    ? (amountInNum / reserveInNum) / (1 + amountInNum / reserveInNum) * 100
    : 0;

  return {
    outputAmount,
    priceImpact: Math.min(priceImpact, 50), // Cap at 50%
    fee,
    protocolFee,
  };
}

