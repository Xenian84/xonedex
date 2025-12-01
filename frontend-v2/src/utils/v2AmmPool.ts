/**
 * Dynamic V2 AMM Pool Utilities
 * Derives pool addresses dynamically from mint pairs - no hardcoding!
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Buffer } from 'buffer';
import { getAmmProgramId } from './v2AmmSwap';

/**
 * Derive pool state PDA from two mints
 * This is deterministic - same mints always produce same pool address
 */
export function derivePoolState(mint0: PublicKey, mint1: PublicKey): [PublicKey, number] {
  // Sort mints to ensure consistent pool address (smaller address first)
  const [mintA, mintB] = mint0.toBuffer().compare(mint1.toBuffer()) < 0 
    ? [mint0, mint1] 
    : [mint1, mint0];
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool_state'), mintA.toBuffer(), mintB.toBuffer()],
    getAmmProgramId()
  );
}

/**
 * Derive pool authority PDA from pool state
 */
export function derivePoolAuthority(poolState: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('authority'), poolState.toBuffer()],
    getAmmProgramId()
  );
}

/**
 * Derive vault addresses from pool state
 */
export function derivePoolVaults(poolState: PublicKey): {
  vault0: PublicKey;
  vault1: PublicKey;
  poolMint: PublicKey;
  observationState: PublicKey;
} {
  const [vault0] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault0'), poolState.toBuffer()],
    getAmmProgramId()
  );
  
  const [vault1] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault1'), poolState.toBuffer()],
    getAmmProgramId()
  );
  
  const [poolMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_mint'), poolState.toBuffer()],
    getAmmProgramId()
  );
  
  const [observationState] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), poolState.toBuffer()],
    getAmmProgramId()
  );
  
  return { vault0, vault1, poolMint, observationState };
}

/**
 * Check if a pool exists on-chain
 */
export async function poolExists(
  connection: Connection,
  poolState: PublicKey
): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(poolState);
    return accountInfo !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Get pool info dynamically from mint pair
 * Returns null if pool doesn't exist
 */
export async function getPoolInfo(
  connection: Connection,
  mint0: PublicKey,
  mint1: PublicKey
): Promise<{
  poolState: PublicKey;
  poolAuthority: PublicKey;
  vault0: PublicKey;
  vault1: PublicKey;
  poolMint: PublicKey;
  observationState: PublicKey;
  exists: boolean;
} | null> {
  const [poolState] = derivePoolState(mint0, mint1);
  const [poolAuthority] = derivePoolAuthority(poolState);
  const { vault0, vault1, poolMint, observationState } = derivePoolVaults(poolState);
  
  const exists = await poolExists(connection, poolState);
  
  return {
    poolState,
    poolAuthority,
    vault0,
    vault1,
    poolMint,
    observationState,
    exists,
  };
}

/**
 * Determine which vault corresponds to which mint
 * IMPORTANT: Pool state is always derived with sorted mints (smaller address first)
 * vault0 always holds the mint with the smaller address
 * vault1 always holds the mint with the larger address
 */
export function getVaultsForMints(
  mint0: PublicKey,
  mint1: PublicKey,
  poolState: PublicKey
): {
  vault0: PublicKey;
  vault1: PublicKey;
  mint0Vault: PublicKey; // Vault that holds mint0 (the first parameter)
  mint1Vault: PublicKey; // Vault that holds mint1 (the second parameter)
} {
  const { vault0, vault1 } = derivePoolVaults(poolState);
  
  // Pool state is ALWAYS derived with sorted mints (smaller address first)
  // So vault0 always holds the mint with the smaller address
  // And vault1 always holds the mint with the larger address
  
  // Sort the mints to determine which vault holds which
  const [mintA, mintB] = mint0.toBuffer().compare(mint1.toBuffer()) < 0 
    ? [mint0, mint1] 
    : [mint1, mint0];
  
  // vault0 always holds mintA (smaller address)
  // vault1 always holds mintB (larger address)
  
  // Now map mint0 and mint1 (the parameters) to their respective vaults
  // mint0Vault = vault that holds mint0 (the first parameter)
  // mint1Vault = vault that holds mint1 (the second parameter)
  const mint0Vault = mint0.equals(mintA) ? vault0 : vault1;
  const mint1Vault = mint1.equals(mintA) ? vault0 : vault1;
  
  return {
    vault0,
    vault1,
    mint0Vault,
    mint1Vault,
  };
}

/**
 * Get source and destination vaults for a swap
 * 
 * IMPORTANT: 
 * - vault_src must have the same mint as user_src (inputMint)
 * - vault_dst must have the same mint as user_dst (outputMint)
 * 
 * Pool structure (based on original initialization scripts):
 * - Pool state is derived with mints sorted by address (smaller first)
 * - vault0 always holds the mint with the smaller address (mint0)
 * - vault1 always holds the mint with the larger address (mint1)
 * 
 * This matches the original init-pool scripts which sort mints before initialization.
 */
export function getSwapVaults(
  inputMint: PublicKey,
  outputMint: PublicKey,
  poolState: PublicKey
): {
  vaultSrc: PublicKey;
  vaultDst: PublicKey;
} {
  // Get the actual vault addresses (vault0 and vault1 are always in sorted order)
  const { vault0, vault1 } = derivePoolVaults(poolState);
  
  // Determine sorted mint order (matches how pool was initialized in original scripts)
  // Original scripts sort mints before deriving pool state, so:
  // - mint0 = smaller address (goes to vault0)
  // - mint1 = larger address (goes to vault1)
  const inputIsSmaller = inputMint.toBuffer().compare(outputMint.toBuffer()) < 0;
  const mint0 = inputIsSmaller ? inputMint : outputMint; // Smaller address -> vault0
  const mint1 = inputIsSmaller ? outputMint : inputMint; // Larger address -> vault1
  
  // Map inputMint and outputMint to their respective vaults
  // vaultSrc = vault that holds inputMint
  // vaultDst = vault that holds outputMint
  const vaultSrc = inputMint.equals(mint0) ? vault0 : vault1;
  const vaultDst = outputMint.equals(mint0) ? vault0 : vault1;
  
  return {
    vaultSrc, // vault that holds inputMint
    vaultDst, // vault that holds outputMint
  };
}

