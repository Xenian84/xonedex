/**
 * Unified Liquidity Builder
 * 
 * Automatically detects if a pool is native or regular and builds the appropriate transaction
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { buildAddLiquidityTransaction, buildRemoveLiquidityTransaction } from './v2AmmLiquidity';
import { buildAddNativeLiquidityTransaction, buildRemoveNativeLiquidityTransaction, calculateOptimalLiquidityAmounts } from './nativeLiquidity';
import { derivePoolState, isNativePool } from './nativePool';
import { isNativeXNT, NATIVE_XNT_MARKER, WRAPPED_XNT_MINT_TESTNET } from '../config/x1-native';
import { useNetworkStore } from '../store/useNetworkStore';

// Check if this is an XNT mint (native token)
function isXNTMint(mint: PublicKey | string): boolean {
  const mintStr = typeof mint === 'string' ? mint : mint.toString();
  return isNativeXNT(mintStr);
}

/**
 * Build add liquidity transaction - auto-detects native vs regular pool
 * Accepts either strings OR PublicKeys to handle native XNT marker
 */
export async function buildUnifiedAddLiquidityTransaction(
  connection: Connection,
  owner: PublicKey,
  mint0: string | PublicKey,
  mint1: string | PublicKey,
  amount0: BN,
  amount1: BN,
  slippageBps: number
): Promise<Transaction | null> {
  console.log('═══════════════════════════════════════════════════');
  console.log('🚀 UNIFIED ADD LIQUIDITY - NEW CODE IS RUNNING!');
  console.log('═══════════════════════════════════════════════════');
  
  try {
    // Convert to strings for easier handling
    const mint0Str = typeof mint0 === 'string' ? mint0 : mint0.toString();
    const mint1Str = typeof mint1 === 'string' ? mint1 : mint1.toString();
    
    console.log('🔍 buildUnifiedAddLiquidityTransaction called');
    console.log('   mint0:', mint0Str);
    console.log('   mint1:', mint1Str);
    
    // Check if this is a potential native pool (one side is XNT)
    const isMint0XNT = isXNTMint(mint0Str);
    const isMint1XNT = isXNTMint(mint1Str);
    const isXNTPool = isMint0XNT || isMint1XNT;
    
    console.log('   isMint0XNT:', isMint0XNT);
    console.log('   isMint1XNT:', isMint1XNT);
    console.log('   isXNTPool:', isXNTPool);
    
    if (isXNTPool) {
      // Determine the token mint (non-XNT side) and amounts
      const tokenMintStr = isMint0XNT ? mint1Str : mint0Str;
      
      // Validate tokenMintStr is NOT NATIVE_XNT_MARKER
      if (isXNTMint(tokenMintStr)) {
        throw new Error('Both tokens cannot be native XNT');
      }
      
      let tokenMint: PublicKey;
      try {
        tokenMint = new PublicKey(tokenMintStr);
      } catch (e) {
        console.error('❌ Invalid token mint address:', tokenMintStr);
        throw new Error(`Invalid token mint address: ${tokenMintStr}. Error: ${e}`);
      }
      
      const xntAmount = isMint0XNT ? BigInt(amount0.toString()) : BigInt(amount1.toString());
      const tokenAmount = isMint0XNT ? BigInt(amount1.toString()) : BigInt(amount0.toString());
      
      console.log('   tokenMint:', tokenMint.toString());
      console.log('   Checking for native pool...');
      
      // Get dynamic program ID from network store
      const networkConfig = useNetworkStore.getState().config;
      const programId = new PublicKey(networkConfig.ammProgramId);
      
      // Check if native pool exists
      const [poolState] = derivePoolState(tokenMint, programId);
      console.log('   poolState:', poolState.toString());
      
      const isNative = await isNativePool(connection, poolState);
      console.log('   isNative:', isNative);
      
      // ALWAYS use native pool builder for XNT pairs
      // It will automatically initialize the pool if it doesn't exist
      console.log('🔵 Using NATIVE XNT pool for liquidity' + (isNative ? '' : ' (will initialize pool)'));
      console.log('   xntAmount:', xntAmount.toString());
      console.log('   tokenAmount:', tokenAmount.toString());
      
      // Build native add liquidity transaction
      // This will automatically initialize the pool if it doesn't exist
      return await buildAddNativeLiquidityTransaction(
        connection,
        programId,
        owner,
        tokenMint,
        xntAmount,
        tokenAmount,
        slippageBps
      );
    }
    
    // Fall back to regular V2 AMM liquidity
    console.log('🔴 Using REGULAR pool for liquidity');
    
    // Convert strings to PublicKeys for regular pool
    const mint0PK = typeof mint0 === 'string' ? new PublicKey(mint0) : mint0;
    const mint1PK = typeof mint1 === 'string' ? new PublicKey(mint1) : mint1;
    
    return await buildAddLiquidityTransaction(
      connection,
      owner,
      mint0PK,
      mint1PK,
      amount0,
      amount1,
      slippageBps
    );
  } catch (error) {
    console.error('❌ Error building unified add liquidity transaction:', error);
    
    // If the error is about non-base58 characters, provide a better error message
    if (error instanceof Error && error.message.includes('Non-base58 character')) {
      throw new Error('Cannot create liquidity pool with native XNT using regular pool logic. Please ensure native pool is properly initialized.');
    }
    
    throw error;
  }
}

/**
 * Build remove liquidity transaction - auto-detects native vs regular pool
 */
export async function buildUnifiedRemoveLiquidityTransaction(
  connection: Connection,
  owner: PublicKey,
  mint0: string | PublicKey,
  mint1: string | PublicKey,
  lpAmount: BN,
  slippageBps: number
): Promise<Transaction | null> {
  try {
    // Convert to strings for easier handling
    const mint0Str = typeof mint0 === 'string' ? mint0 : mint0.toString();
    const mint1Str = typeof mint1 === 'string' ? mint1 : mint1.toString();
    
    console.log('🔍 buildUnifiedRemoveLiquidityTransaction called');
    console.log('  mint0:', mint0Str);
    console.log('  mint1:', mint1Str);
    console.log('  isXNTMint(mint0):', isXNTMint(mint0Str));
    console.log('  isXNTMint(mint1):', isXNTMint(mint1Str));
    
    // Check if this is a potential native pool
    const isXNTPool = isXNTMint(mint0Str) || isXNTMint(mint1Str);
    
    if (isXNTPool) {
      const tokenMintStr = isXNTMint(mint0Str) ? mint1Str : mint0Str;
      
      console.log('  tokenMintStr (non-XNT token):', tokenMintStr);
      
      // Validate that tokenMintStr is NOT NATIVE_XNT_MARKER (should be the other token)
      if (isXNTMint(tokenMintStr)) {
        throw new Error('Both tokens cannot be native XNT');
      }
      
      // Validate it's a valid base58 address
      let tokenMint: PublicKey;
      try {
        tokenMint = new PublicKey(tokenMintStr);
      } catch (e) {
        console.error('❌ Invalid token mint address:', tokenMintStr);
        throw new Error(`Invalid token mint address: ${tokenMintStr}. Error: ${e}`);
      }
      
      // Get dynamic program ID from network store
      const networkConfig = useNetworkStore.getState().config;
      const programId = new PublicKey(networkConfig.ammProgramId);
      
      // Check if native pool exists
      const [poolState] = derivePoolState(tokenMint, programId);
      const isNative = await isNativePool(connection, poolState);
      
      if (isNative) {
        console.log('🔵 Using NATIVE XNT pool for remove liquidity');
        
        // Build native remove liquidity transaction
        return await buildRemoveNativeLiquidityTransaction(
          connection,
          owner,
          tokenMintStr, // This is the non-XNT token (JACK)
          BigInt(lpAmount.toString()),
          programId
        );
      }
    }
    
    // Fall back to regular V2 AMM liquidity
    console.log('🔴 Using REGULAR pool for remove liquidity');
    
    // For regular pools, convert NATIVE_XNT_MARKER to wrapped XNT mint
    // Old pools use wrapped XNT (wXNT) instead of native XNT
    let mint0PK: PublicKey;
    let mint1PK: PublicKey;
    
    try {
      // Convert mint0 - if it's NATIVE_XNT_MARKER, use wrapped XNT mint for regular pools
      if (typeof mint0 === 'string' && isXNTMint(mint0)) {
        // Use wrapped XNT mint for regular pools
        mint0PK = new PublicKey(WRAPPED_XNT_MINT_TESTNET);
        console.log('  Converted mint0 from NATIVE_XNT_MARKER to wrapped XNT:', mint0PK.toString());
      } else {
        mint0PK = typeof mint0 === 'string' ? new PublicKey(mint0) : mint0;
      }
      
      // Convert mint1 - if it's NATIVE_XNT_MARKER, use wrapped XNT mint for regular pools
      if (typeof mint1 === 'string' && isXNTMint(mint1)) {
        // Use wrapped XNT mint for regular pools
        mint1PK = new PublicKey(WRAPPED_XNT_MINT_TESTNET);
        console.log('  Converted mint1 from NATIVE_XNT_MARKER to wrapped XNT:', mint1PK.toString());
      } else {
        mint1PK = typeof mint1 === 'string' ? new PublicKey(mint1) : mint1;
      }
    } catch (e) {
      console.error('❌ Error converting mints to PublicKey:', e);
      throw new Error(`Invalid mint address. Error: ${e}`);
    }
    
    return await buildRemoveLiquidityTransaction(
      connection,
      owner,
      mint0PK,
      mint1PK,
      lpAmount,
      slippageBps
    );
  } catch (error) {
    console.error('Error building unified remove liquidity transaction:', error);
    throw error;
  }
}

/**
 * Calculate optimal liquidity amounts - auto-detects native vs regular pool
 */
export async function calculateUnifiedLiquidityAmounts(
  connection: Connection,
  mint0: PublicKey,
  mint1: PublicKey,
  amount0: bigint | null,
  amount1: bigint | null
): Promise<{
  amount0: bigint;
  amount1: bigint;
  lpAmount: bigint;
  shareOfPool: number;
  isNativePool: boolean;
} | null> {
  try {
    // Check if this is a potential native pool
    const isXNTPool = isXNTMint(mint0) || isXNTMint(mint1);
    
    if (isXNTPool) {
      const tokenMint = isXNTMint(mint0) ? mint1 : mint0;
      const xntAmount = isXNTMint(mint0) ? amount0 : amount1;
      const tokenAmount = isXNTMint(mint0) ? amount1 : amount0;
      
      // Get dynamic program ID from network store
      const networkConfig = useNetworkStore.getState().config;
      const programId = new PublicKey(networkConfig.ammProgramId);
      
      // Check if native pool exists
      const [poolState] = derivePoolState(tokenMint, programId);
      const isNative = await isNativePool(connection, poolState);
      
      if (isNative) {
        const result = await calculateOptimalLiquidityAmounts(
          connection,
          programId,
          tokenMint,
          xntAmount,
          tokenAmount
        );
        
        if (result) {
          // Map back to mint0/mint1 order
          const finalAmount0 = isXNTMint(mint0) ? result.xntAmount : result.tokenAmount;
          const finalAmount1 = isXNTMint(mint0) ? result.tokenAmount : result.xntAmount;
          
          return {
            amount0: finalAmount0,
            amount1: finalAmount1,
            lpAmount: result.lpAmount,
            shareOfPool: result.shareOfPool,
            isNativePool: true,
          };
        }
      }
    }
    
    // For regular pools, we'd need to implement the calculation logic
    // For now, return null to indicate we should use existing flow
    return null;
  } catch (error) {
    console.error('Error calculating unified liquidity amounts:', error);
    return null;
  }
}

