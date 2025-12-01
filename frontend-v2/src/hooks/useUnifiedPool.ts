/**
 * Unified Pool Hook
 * 
 * Auto-detects native vs regular pools and provides unified interface
 */

import { useState, useEffect, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { useV2AmmPool } from './useV2AmmPool';
import { derivePoolState, getPoolState, getNativePoolReserves, derivePoolPda, deriveTokenVault } from '../utils/nativePool';
import { isNativeXNT, NATIVE_XNT_MARKER } from '../config/x1-native';
import { useNetworkStore } from '../store/useNetworkStore';

export interface UnifiedPoolInfo {
  mint0: string;
  mint1: string;
  reserve0: number;
  reserve1: number;
  price: number;
  lpSupply?: number;
  feeNumerator: string;
  feeDenominator: string;
  isNativePool: boolean;
  poolState?: string;
}

// Check if this is an XNT mint
function isXNTMint(mint: string): boolean {
  return isNativeXNT(mint);
}

export function useUnifiedPool(mint0: string, mint1: string, connection?: Connection) {
  const [poolInfo, setPoolInfo] = useState<UnifiedPoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasPool, setHasPool] = useState(false);
  
  // Use regular pool hook as fallback
  const regularPool = useV2AmmPool(mint0, mint1);
  
  const fetchNativePool = useCallback(async (conn: Connection, tokenMint: string, isToken0: boolean) => {
    try {
      // Get dynamic program ID from network store
      const networkConfig = useNetworkStore.getState().config;
      const programId = new PublicKey(networkConfig.ammProgramId);
      
      const [poolState] = derivePoolState(new PublicKey(tokenMint), programId);
      const poolStateData = await getPoolState(conn, poolState);
      
      if (!poolStateData || !poolStateData.isNativePool) {
        return null;
      }
      
      const [poolPda] = derivePoolPda(poolState, programId);
      const [tokenVault] = deriveTokenVault(poolState, programId);
      
      const reserves = await getNativePoolReserves(conn, poolState, poolPda, tokenVault);
      
      if (!reserves) {
        return null;
      }
      
      // Convert reserves to numbers (9 decimals)
      const nativeReserve = Number(reserves.nativeReserve) / 1e9;
      const tokenReserve = Number(reserves.tokenReserve) / 1e9;
      
      // Calculate price: XNT per token
      const price = tokenReserve > 0 ? nativeReserve / tokenReserve : 0;
      
      const lpSupply = Number(poolStateData.totalAmountMinted) / 1e9;
      
      // Build unified pool info
      const nativePoolInfo: UnifiedPoolInfo = {
        mint0: isToken0 ? tokenMint : mint0,
        mint1: isToken0 ? mint1 : tokenMint,
        reserve0: isToken0 ? tokenReserve : nativeReserve,
        reserve1: isToken0 ? nativeReserve : tokenReserve,
        price,
        lpSupply,
        feeNumerator: poolStateData.feeNumerator.toString(),
        feeDenominator: poolStateData.feeDenominator.toString(),
        isNativePool: true,
        poolState: poolState.toString(),
      };
      
      return nativePoolInfo;
    } catch (error) {
      console.error('Error fetching native pool:', error);
      return null;
    }
  }, []);
  
  const refresh = useCallback(async (conn: Connection) => {
    if (!mint0 || !mint1) {
      setPoolInfo(null);
      setHasPool(false);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Check if this could be a native pool
      const isXNTPool = isXNTMint(mint0) || isXNTMint(mint1);
      
      if (isXNTPool) {
        // Determine which is the token mint
        const tokenMint = isXNTMint(mint0) ? mint1 : mint0;
        const isToken0 = isXNTMint(mint1); // Token is mint0 if XNT is mint1
        
        // Try to fetch native pool
        const nativePool = await fetchNativePool(conn, tokenMint, isToken0);
        
        if (nativePool) {
          console.log('🔵 Native pool detected:', nativePool);
          setPoolInfo(nativePool);
          setHasPool(true);
          setIsLoading(false);
          return;
        }
      }
      
      // Fallback to regular pool
      if (regularPool.poolInfo) {
        console.log('🔴 Regular pool detected');
        const regularPoolInfo: UnifiedPoolInfo = {
          mint0: regularPool.poolInfo.mint0,
          mint1: regularPool.poolInfo.mint1,
          reserve0: parseFloat(regularPool.poolInfo.reserve0),
          reserve1: parseFloat(regularPool.poolInfo.reserve1),
          price: regularPool.poolInfo.price,
          lpSupply: 0,  // Regular pool doesn't have this
          feeNumerator: regularPool.poolInfo.feeNumerator,
          feeDenominator: regularPool.poolInfo.feeDenominator,
          isNativePool: false,
        };
        setPoolInfo(regularPoolInfo);
        setHasPool(true);
      } else {
        setPoolInfo(null);
        setHasPool(false);
      }
    } catch (error) {
      console.error('Error in useUnifiedPool:', error);
      setPoolInfo(null);
      setHasPool(false);
    } finally {
      setIsLoading(false);
    }
  }, [mint0, mint1, fetchNativePool, regularPool.poolInfo]);
  
  useEffect(() => {
    if (connection && mint0 && mint1) {
      refresh(connection);
    }
  }, [connection, mint0, mint1, refresh]);
  
  return {
    poolInfo,
    hasPool,
    isLoading: isLoading || regularPool.isLoading,
    refresh: connection ? () => refresh(connection) : regularPool.refresh,
  };
}

/**
 * Calculate unified swap output (works for both native and regular pools)
 */
export function calculateUnifiedSwapOutput(
  inputAmount: number,
  poolInfo: UnifiedPoolInfo | null,
  isInputMint0: boolean,
  inputDecimals: number,
  outputDecimals: number
): {
  outputAmount: number;
  priceImpact: number;
  fee: number;
  minimumReceived: number;
} | null {
  if (!poolInfo || inputAmount <= 0) {
    return null;
  }
  
  try {
    const { reserve0, reserve1 } = poolInfo;
    const feeNumerator = parseFloat(poolInfo.feeNumerator);
    const feeDenominator = parseFloat(poolInfo.feeDenominator);
    
    // Determine input/output reserves based on direction
    const reserveIn = isInputMint0 ? reserve0 : reserve1;
    const reserveOut = isInputMint0 ? reserve1 : reserve0;
    
    if (reserveIn <= 0 || reserveOut <= 0) {
      return null;
    }
    
    // Calculate fee
    const feeRate = feeNumerator / feeDenominator;
    const fee = inputAmount * feeRate;
    const amountInAfterFee = inputAmount - fee;
    
    // Constant product formula: (x + Δx) * (y - Δy) = x * y
    // Solving for Δy: Δy = y * Δx / (x + Δx)
    const outputAmount = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    
    // Calculate price impact
    const priceImpact = (inputAmount / reserveIn) * 100;
    
    // Minimum received with 0.5% slippage default
    const minimumReceived = outputAmount * 0.995;
    
    return {
      outputAmount,
      priceImpact,
      fee,
      minimumReceived,
    };
  } catch (error) {
    console.error('Error calculating swap output:', error);
    return null;
  }
}

