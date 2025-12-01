/**
 * Unified Swap Builder
 * 
 * Automatically detects if a pool is native or regular and builds the appropriate transaction
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { buildV2AmmSwapTransaction } from './v2AmmSwap';
import { buildNativeSwapTransaction, getNativeSwapQuote } from './nativeSwap';
import { derivePoolState, isNativePool } from './nativePool';
import { isNativeXNT, NATIVE_XNT_MARKER } from '../config/x1-native';
import { useNetworkStore } from '../store/useNetworkStore';

// Check if this is an XNT swap (native token)
function isXNTMint(mint: PublicKey | string): boolean {
  const mintStr = typeof mint === 'string' ? mint : mint.toString();
  return isNativeXNT(mintStr);
}

/**
 * Build swap transaction - auto-detects native vs regular pool
 * Accepts string mints (including NATIVE_XNT_MARKER) or PublicKeys
 */
export async function buildUnifiedSwapTransaction(
  connection: Connection,
  owner: PublicKey,
  inputMint: PublicKey | string,
  outputMint: PublicKey | string,
  amountIn: BN,
  minAmountOut: BN,
  slippageBps: number
): Promise<Transaction | null> {
  try {
    // Convert to strings for easier handling
    const inputMintStr = typeof inputMint === 'string' ? inputMint : inputMint.toString();
    const outputMintStr = typeof outputMint === 'string' ? outputMint : outputMint.toString();
    
    console.log('🔍 buildUnifiedSwapTransaction called');
    console.log('  inputMint:', inputMintStr);
    console.log('  outputMint:', outputMintStr);
    
    // Check if this is a potential native pool (one side is XNT)
    const isXNTSwap = isXNTMint(inputMintStr) || isXNTMint(outputMintStr);
    
    if (isXNTSwap) {
      // Determine the token mint (non-XNT side)
      const tokenMintStr = isXNTMint(inputMintStr) ? outputMintStr : inputMintStr;
      const isXntToToken = isXNTMint(inputMintStr);
      
      console.log('  tokenMintStr (non-XNT):', tokenMintStr);
      console.log('  isXntToToken:', isXntToToken);
      
      // Validate tokenMintStr is NOT NATIVE_XNT_MARKER
      if (isXNTMint(tokenMintStr)) {
        throw new Error('Both tokens cannot be native XNT');
      }
      
      // Convert to PublicKey for pool state derivation
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
      
      console.log('  isNative:', isNative);
      
      if (isNative) {
        console.log('🔵 Using NATIVE XNT pool for swap');
        
        // Build native swap transaction
        return await buildNativeSwapTransaction(
          connection,
          programId,
          owner,
          tokenMint,
          BigInt(amountIn.toString()),
          BigInt(minAmountOut.toString()),
          isXntToToken,
          slippageBps
        );
      } else {
        console.log('⚠️  XNT pool exists but is NOT native - using regular swap');
      }
    }
    
    // Fall back to regular V2 AMM swap
    console.log('🔴 Using REGULAR pool for swap');
    
    // Convert strings to PublicKeys for regular pool (but validate first)
    let inputMintPK: PublicKey;
    let outputMintPK: PublicKey;
    
    try {
      inputMintPK = typeof inputMint === 'string' ? new PublicKey(inputMint) : inputMint;
      outputMintPK = typeof outputMint === 'string' ? new PublicKey(outputMint) : outputMint;
    } catch (e) {
      throw new Error(`Invalid mint address. Cannot create regular swap with native XNT marker. Error: ${e}`);
    }
    
    return await buildV2AmmSwapTransaction(
      connection,
      owner,
      inputMintPK,
      outputMintPK,
      amountIn,
      minAmountOut,
      slippageBps
    );
  } catch (error) {
    console.error('Error building unified swap transaction:', error);
    throw error;
  }
}

/**
 * Get swap quote - auto-detects native vs regular pool
 */
export async function getUnifiedSwapQuote(
  connection: Connection,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: bigint,
  isExactIn: boolean = true
): Promise<{
  amountOut: bigint;
  fee: bigint;
  priceImpact: number;
  isNativePool: boolean;
} | null> {
  try {
    // Check if this is a potential native pool
    const isXNTSwap = isXNTMint(inputMint) || isXNTMint(outputMint);
    
    if (isXNTSwap) {
      const tokenMint = isXNTMint(inputMint) ? outputMint : inputMint;
      const isXntToToken = isXNTMint(inputMint);
      
      // Get dynamic program ID from network store
      const networkConfig = useNetworkStore.getState().config;
      const programId = new PublicKey(networkConfig.ammProgramId);
      
      // Check if native pool exists
      const [poolState] = derivePoolState(tokenMint, programId);
      const isNative = await isNativePool(connection, poolState);
      
      if (isNative) {
        const quote = await getNativeSwapQuote(
          connection,
          programId,
          tokenMint,
          amountIn,
          isXntToToken
        );
        
        if (quote) {
          return {
            amountOut: quote.amountOut,
            fee: quote.fee,
            priceImpact: quote.priceImpact,
            isNativePool: true,
          };
        }
      }
    }
    
    // For regular pools, we'd need to implement the quote logic
    // For now, return null to indicate we should use existing flow
    return null;
  } catch (error) {
    console.error('Error getting unified swap quote:', error);
    return null;
  }
}

