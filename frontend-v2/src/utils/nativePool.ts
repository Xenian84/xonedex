/**
 * Native XNT Pool Utilities
 * 
 * This module provides utilities for working with native XNT pools
 * where XNT is held directly as lamports (not as wrapped SPL token)
 */

import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Pool State structure (must match Rust struct)
 */
export interface PoolState {
  totalAmountMinted: bigint;
  feeNumerator: bigint;
  feeDenominator: bigint;
  protocolTreasury: PublicKey;
  protocolFeeBps: number;
  isNativePool: boolean;
  nativeMintIndex: number;  // 0 if token0 is native, 1 if token1 is native
  nativeReserve: bigint;    // Actual tradeable native XNT in the pool PDA
  rentReserve: bigint;      // Lamports reserved for rent exemption
}

/**
 * Deserialize PoolState from account data
 */
export function deserializePoolState(data: Buffer): PoolState {
  if (data.length < 8) {
    throw new Error('Invalid pool state data: too short');
  }
  
  // Skip 8-byte discriminator
  let offset = 8;
  
  // Read fields (must match Rust struct order!)
  const totalAmountMinted = data.readBigUInt64LE(offset); offset += 8;
  const feeNumerator = data.readBigUInt64LE(offset); offset += 8;
  const feeDenominator = data.readBigUInt64LE(offset); offset += 8;
  
  const protocolTreasury = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const protocolFeeBps = data.readUInt16LE(offset); offset += 2;
  
  // New fields for native pools
  const isNativePool = data.readUInt8(offset) !== 0; offset += 1;
  const nativeMintIndex = data.readUInt8(offset); offset += 1;
  const nativeReserve = data.readBigUInt64LE(offset); offset += 8;
  
  // Read rent_reserve if available (may not exist in older pool versions)
  let rentReserve = BigInt(0);
  if (data.length >= offset + 8) {
    rentReserve = data.readBigUInt64LE(offset);
    offset += 8;
  }
  
  return {
    totalAmountMinted,
    feeNumerator,
    feeDenominator,
    protocolTreasury,
    protocolFeeBps,
    isNativePool,
    nativeMintIndex,
    nativeReserve,
    rentReserve,
  };
}

/**
 * Check if a pool is a native XNT pool
 */
export async function isNativePool(
  connection: Connection,
  poolStateAddress: PublicKey
): Promise<boolean> {
  try {
    console.log('   🔍 isNativePool - fetching account:', poolStateAddress.toString());
    const accountInfo = await connection.getAccountInfo(poolStateAddress);
    if (!accountInfo) {
      console.log('   ❌ isNativePool - account not found');
      return false;
    }
    
    console.log('   ✅ isNativePool - account found, data length:', accountInfo.data.length);
    const poolState = deserializePoolState(accountInfo.data);
    console.log('   📊 isNativePool - poolState.isNativePool:', poolState.isNativePool);
    console.log('   📊 isNativePool - poolState.nativeMintIndex:', poolState.nativeMintIndex);
    console.log('   📊 isNativePool - poolState.nativeReserve:', poolState.nativeReserve.toString());
    return poolState.isNativePool;
  } catch (error) {
    console.error('❌ Error checking if pool is native:', error);
    return false;
  }
}

/**
 * Get pool state with native pool information
 */
export async function getPoolState(
  connection: Connection,
  poolStateAddress: PublicKey
): Promise<PoolState | null> {
  try {
    const accountInfo = await connection.getAccountInfo(poolStateAddress);
    if (!accountInfo) {
      return null;
    }
    
    return deserializePoolState(accountInfo.data);
  } catch (error) {
    console.error('Error getting pool state:', error);
    return null;
  }
}

/**
 * Derive pool PDA that holds native XNT
 */
export function derivePoolPda(
  poolStateAddress: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool_pda'), poolStateAddress.toBuffer()],
    programId
  );
}

/**
 * Derive pool state PDA from token mint
 */
export function derivePoolState(
  tokenMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), tokenMint.toBuffer()],
    programId
  );
}

/**
 * Derive token vault PDA
 */
export function deriveTokenVault(
  poolStateAddress: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolStateAddress.toBuffer()],
    programId
  );
}

/**
 * Derive LP mint PDA
 */
export function deriveLpMint(
  poolStateAddress: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_mint'), poolStateAddress.toBuffer()],
    programId
  );
}

/**
 * Derive pool authority PDA
 */
export function derivePoolAuthority(
  poolStateAddress: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('authority'), poolStateAddress.toBuffer()],
    programId
  );
}

/**
 * Calculate swap output for native pool
 * Using constant product formula: x * y = k
 */
export function calculateNativeSwapOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeNumerator: bigint,
  feeDenominator: bigint
): { amountOut: bigint; fee: bigint } {
  // Calculate fee
  const fee = (amountIn * feeNumerator) / feeDenominator;
  const amountInAfterFee = amountIn - fee;
  
  // Constant product formula: (x + Δx) * (y - Δy) = x * y
  // Solving for Δy: Δy = y * Δx / (x + Δx)
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  
  return { amountOut, fee };
}

/**
 * Calculate required input for desired output (reverse quote)
 */
export function calculateNativeSwapInput(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeNumerator: bigint,
  feeDenominator: bigint
): { amountIn: bigint; fee: bigint } {
  // Reverse constant product formula
  // (x + Δx) * (y - Δy) = x * y
  // Δx = (x * Δy) / (y - Δy)
  const amountInBeforeFee = (reserveIn * amountOut) / (reserveOut - amountOut);
  
  // Add fee: amountIn = amountInBeforeFee / (1 - feeRate)
  const amountIn = (amountInBeforeFee * feeDenominator) / (feeDenominator - feeNumerator);
  const fee = amountIn - amountInBeforeFee;
  
  return { amountIn, fee };
}

/**
 * Get native pool reserves
 */
export async function getNativePoolReserves(
  connection: Connection,
  poolStateAddress: PublicKey,
  poolPdaAddress: PublicKey,
  tokenVaultAddress: PublicKey
): Promise<{ nativeReserve: bigint; tokenReserve: bigint } | null> {
  try {
    const [poolStateInfo, poolPdaInfo, tokenVaultInfo] = await Promise.all([
      connection.getAccountInfo(poolStateAddress),
      connection.getAccountInfo(poolPdaAddress),
      connection.getAccountInfo(tokenVaultAddress),
    ]);
    
    if (!poolStateInfo || !poolPdaInfo || !tokenVaultInfo) {
      return null;
    }
    
    // Get native reserve from pool state
    const poolState = deserializePoolState(poolStateInfo.data);
    
    // Get token reserve from vault (offset 64 for amount in TokenAccount)
    const tokenReserve = tokenVaultInfo.data.readBigUInt64LE(64);
    
    return {
      nativeReserve: poolState.nativeReserve,
      tokenReserve,
    };
  } catch (error) {
    console.error('Error getting native pool reserves:', error);
    return null;
  }
}

