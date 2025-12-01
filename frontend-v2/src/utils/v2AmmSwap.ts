/**
 * V2 AMM Swap utilities for XoneDEX
 * Handles transaction building and execution for Uniswap V2 style swaps
 */

import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  NATIVE_MINT,
} from '@solana/spl-token';
import { Buffer } from 'buffer';
import BN from 'bn.js';
import { sha256 } from '@noble/hashes/sha2.js';

// V2 AMM Program ID - Import from network config for dynamic switching
import { useNetworkStore } from '../store/useNetworkStore';

// Helper to get current AMM Program ID
export const getAmmProgramId = (): PublicKey => {
  const ammProgramId = useNetworkStore.getState().config.ammProgramId;
  return new PublicKey(ammProgramId);
};

// Common token mints (for reference, but pools are derived dynamically)
export const XNT_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/**
 * Check if a mint uses Token 2022 program
 */
export async function isToken2022(connection: Connection, mint: PublicKey): Promise<boolean> {
  try {
    const mintInfo = await connection.getAccountInfo(mint);
    if (!mintInfo) return false;
    return mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  } catch {
    return false;
  }
}
export const SHIBA_MINT = new PublicKey('BkDWpvd24xu8J6AsWWLDi5ArC5ekHUL4CkpfWnxkos3p');
export const XEN_MINT = new PublicKey('63SFkqc14KbNQ6iyy6CNLGmrHnaTcXBxAgy5mghzPxBg');
export const XNM_MINT = new PublicKey('7yGLoF7SH4gTT86JWPKPs8Bi6vpeLQHaUkLapUyYJf25');

// Legacy constants for backward compatibility (deprecated - use dynamic derivation instead)
/** @deprecated Use derivePoolState() instead */
export const XNT_SHIBA_POOL_STATE = new PublicKey('9d99qGPzXNU2ECQG9MujofyFvKniG1jGHBPxF9ELZaWV');
/** @deprecated Use derivePoolVaults() instead */
export const POOL_VAULT_0 = new PublicKey('GQ4oMEXNQ3LgT444kLaWZh3whpni2uRbr82U5PgmWw6A');
/** @deprecated Use derivePoolVaults() instead */
export const POOL_VAULT_1 = new PublicKey('7NpBN9y6Le47rsMeVyC2vXp6xTWKCMmWdkhqpo6hRw41');
/** @deprecated Use derivePoolState() instead */
export const XNT_XEN_POOL_STATE = new PublicKey('4CxKvy4mN9Gb6JZqKFxfTGT2QoXeBee9Kx5C1BhCMqxA');
/** @deprecated Use derivePoolVaults() instead */
export const XEN_POOL_VAULT_0 = new PublicKey('5wXyuQvjUGv3gPCchPYqpvrAcCK57CiUHXsFhbkgFczR');
/** @deprecated Use derivePoolVaults() instead */
export const XEN_POOL_VAULT_1 = new PublicKey('4NYXPUcWA74taZrSfxU5Ln5mjSHKUwP7Qk7Rb9Z2UXLE');

// Import pool utilities from dedicated modules
import {
  derivePoolState as derivePoolStateUtil,
  derivePoolAuthority as derivePoolAuthorityUtil,
  derivePoolVaults,
  poolExists,
  getPoolInfo,
  getVaultsForMints,
  getSwapVaults,
} from './v2AmmPool';

import {
  fetchV2AmmPoolState as fetchV2AmmPoolStateUtil,
  type V2AmmPoolStateData,
} from './v2AmmPoolState';

// Re-export for convenience
export {
  derivePoolStateUtil as derivePoolState,
  derivePoolAuthorityUtil as derivePoolAuthority,
  derivePoolVaults,
  poolExists,
  getPoolInfo,
  getVaultsForMints,
  getSwapVaults,
  fetchV2AmmPoolStateUtil as fetchV2AmmPoolState,
  type V2AmmPoolStateData,
};

/**
 * Calculate swap output using constant product formula (x * y = k)
 * This matches the Rust implementation exactly
 */
export function calculateSwapOutput(
  amountIn: BN,
  reserveIn: BN,
  reserveOut: BN,
  feeNumerator: BN,
  feeDenominator: BN
): BN {
  // Validate reserves are not zero
  if (reserveIn.lte(new BN(0)) || reserveOut.lte(new BN(0))) {
    console.error('Invalid reserves:', { reserveIn: reserveIn.toString(), reserveOut: reserveOut.toString() });
    return new BN(0);
  }
  
  // Validate input amount
  if (amountIn.lte(new BN(0))) {
    console.error('Invalid input amount:', amountIn.toString());
    return new BN(0);
  }
  
  // Calculate fee (matches Rust: fee_amount = amount_in * fee_numerator / fee_denominator)
  const feeAmount = amountIn.mul(feeNumerator).div(feeDenominator);
  
  // Amount after fee (matches Rust: amount_in_minus_fees = amount_in - fee_amount)
  const amountInAfterFee = amountIn.sub(feeAmount);
  
  // Constant product: k = reserveIn * reserveOut (matches Rust: invariant = src_vault * dst_vault)
  const k = reserveIn.mul(reserveOut);
  
  // New reserveIn = reserveIn + amountInAfterFee (matches Rust: new_src_vault = src_vault + amount_in_minus_fees)
  const newReserveIn = reserveIn.add(amountInAfterFee);
  
  // Validate newReserveIn is not zero (should never happen but safety check)
  if (newReserveIn.lte(new BN(0))) {
    console.error('newReserveIn is zero or negative!');
    return new BN(0);
  }
  
  // New reserveOut = k / newReserveIn (matches Rust: new_dst_vault = invariant / new_src_vault)
  const newReserveOut = k.div(newReserveIn);
  
  // Output = reserveOut - newReserveOut (matches Rust: output_amount = dst_vault - new_dst_vault)
  const amountOut = reserveOut.sub(newReserveOut);
  
  return amountOut;
}

/**
 * Build V2 AMM swap instruction
 */
export function buildV2AmmSwapInstruction(
  poolState: PublicKey,
  poolAuthority: PublicKey,
  vaultSrc: PublicKey,
  vaultDst: PublicKey,
  userSrc: PublicKey,
  userDst: PublicKey,
  owner: PublicKey,
  protocolTreasuryAta: PublicKey, // Always required (can be a dummy account if no treasury)
  amountIn: BN,
  minAmountOut: BN
): TransactionInstruction {
  // Anchor instruction discriminator: sha256("global:swap")[:8]
  // Use browser-compatible crypto from @noble/hashes
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode('global:swap'));
  const discriminator = Buffer.from(hash.slice(0, 8));

  // Encode arguments: amount_in (u64) + min_amount_out (u64)
  const amountInBuffer = Buffer.allocUnsafe(8);
  amountInBuffer.writeBigUInt64LE(BigInt(amountIn.toString()), 0);
  const minAmountOutBuffer = Buffer.allocUnsafe(8);
  minAmountOutBuffer.writeBigUInt64LE(BigInt(minAmountOut.toString()), 0);

  const data = Buffer.concat([discriminator, amountInBuffer, minAmountOutBuffer]);

  return new TransactionInstruction({
    programId: getAmmProgramId(),
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: true }, // Must be writable for PDA signing
      { pubkey: vaultSrc, isSigner: false, isWritable: true },
      { pubkey: vaultDst, isSigner: false, isWritable: true },
      { pubkey: userSrc, isSigner: false, isWritable: true },
      { pubkey: userDst, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: protocolTreasuryAta, isSigner: false, isWritable: true }, // Always writable (even if default/unused)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // Token 2022 program
    ],
    data,
  });
}

/**
 * Build complete V2 AMM swap transaction
 */
export async function buildV2AmmSwapTransaction(
  connection: Connection,
  owner: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: BN,
  minAmountOut: BN,
  slippageBps: number = 50, // 0.5% default slippage
  priorityFeeInLamports: number = 0 // Priority fee in lamports (0 = no priority)
): Promise<Transaction> {
  const transaction = new Transaction();

  // Add priority fee if specified
  if (priorityFeeInLamports > 0) {
    // Set compute unit price (priority fee per compute unit)
    // Convert XNT to micro-lamports per compute unit
    const microLamports = Math.floor(priorityFeeInLamports * 1000000 / 200000); // Assuming 200k compute units
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
    // Optionally set compute unit limit for better fee estimation
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
    );
  }

  // Derive pool state PDA (mints are sorted to match initialization)
  const [poolState] = derivePoolStateUtil(inputMint, outputMint);
  
  // Verify pool state account exists before proceeding
  const poolStateAccount = await connection.getAccountInfo(poolState);
  if (!poolStateAccount) {
    throw new Error(`Pool does not exist for ${inputMint.toString()} / ${outputMint.toString()}. Pool state: ${poolState.toString()}`);
  }
  
  // Derive pool authority
  const [poolAuthority] = derivePoolAuthorityUtil(poolState);

  // Fetch pool state to get vault addresses
  const poolStateData = await fetchV2AmmPoolStateUtil(connection, poolState);
  if (!poolStateData) {
    throw new Error(`Failed to fetch pool state data for ${poolState.toString()}. Account exists but data is invalid.`);
  }

  // Dynamically derive vault addresses from pool state
  // No hardcoding - works for any token pair!
  const { vaultSrc, vaultDst } = getSwapVaults(inputMint, outputMint, poolState);

  // Get user token accounts (with correct program ID for Token 2022)
  const inputIs2022 = await isToken2022(connection, inputMint);
  const outputIs2022 = await isToken2022(connection, outputMint);
  
  const userSrcAta = await getAssociatedTokenAddress(
    inputMint, 
    owner, 
    false, 
    inputIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  );
  const userDstAta = await getAssociatedTokenAddress(
    outputMint, 
    owner, 
    false, 
    outputIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  );

  // Check if protocol treasury is configured
  const hasTreasury = poolStateData.protocolTreasury 
      && !poolStateData.protocolTreasury.equals(PublicKey.default)
      && poolStateData.protocolFeeBps > 0;

  // Protocol fee always collected in XNT (native token)
  // Check if XNT is involved in the swap (input or output)
  const isInputXNT = inputMint.equals(NATIVE_MINT) || inputMint.equals(XNT_MINT);
  const isOutputXNT = outputMint.equals(NATIVE_MINT) || outputMint.equals(XNT_MINT);
  const hasXNT = isInputXNT || isOutputXNT;

  // Get protocol treasury ATA for XNT (or use a dummy account if no treasury or no XNT)
  let protocolTreasuryAta: PublicKey;
  if (hasTreasury && poolStateData.protocolTreasury && hasXNT) {
      // Treasury ATA is always for XNT (native token) - XNT uses standard Token program
      protocolTreasuryAta = await getAssociatedTokenAddress(
        XNT_MINT, 
        poolStateData.protocolTreasury,
        false,
        TOKEN_PROGRAM_ID // XNT always uses standard Token program
      );
      
      // Check if treasury ATA exists, create if needed
      const treasuryExists = await connection.getAccountInfo(protocolTreasuryAta).then(
          () => true,
          () => false
      );
      
      if (!treasuryExists) {
          // Create treasury ATA for XNT - user pays for creation (acceptable for protocol fees)
          // XNT always uses standard Token program
          transaction.add(
              createAssociatedTokenAccountInstruction(
                  owner,
                  protocolTreasuryAta,
                  poolStateData.protocolTreasury,
                  XNT_MINT,
                  TOKEN_PROGRAM_ID // XNT always uses standard Token program
              )
          );
      }
  } else {
      // No treasury configured or no XNT involved - use userDstAta as dummy writable account
      // The program won't use it (treasury_ata_valid will be false), but Anchor requires a writable account
      protocolTreasuryAta = userDstAta;
  }

  // Check if input is native token (XNT)
  const isInputNative = inputMint.equals(NATIVE_MINT) || inputMint.equals(XNT_MINT);

  // Check if user has ATA for source token, create if needed (with correct program ID)
  try {
    await getAccount(
      connection, 
      userSrcAta, 
      'confirmed',
      inputIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );
  } catch (e) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userSrcAta,
        owner,
        inputMint,
        inputIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      )
    );
  }

  // Check if user has ATA for destination token, create if needed (with correct program ID)
  try {
    await getAccount(
      connection, 
      userDstAta, 
      'confirmed',
      outputIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );
  } catch (e) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userDstAta,
        owner,
        outputMint,
        outputIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      )
    );
  }

  // If input is native XNT, transfer SOL to wrapped account and sync
  if (isInputNative) {
    // Transfer SOL from user's wallet to their wrapped SOL token account
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: userSrcAta,
        lamports: amountIn.toNumber(),
      })
    );

    // Sync native balance to update the wrapped SOL account balance
    transaction.add(
      createSyncNativeInstruction(userSrcAta)
    );
  }

  // Build swap instruction
  const swapIx = buildV2AmmSwapInstruction(
    poolState,
    poolAuthority,
    vaultSrc,
    vaultDst,
    userSrcAta,
    userDstAta,
    owner,
    protocolTreasuryAta,
    amountIn,
    minAmountOut
  );

  transaction.add(swapIx);

  // Get recent blockhash (required for signing)
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = owner;

  // Compile transaction to ensure proper account deduplication and ordering
  // This is important for Solana transaction validation
  transaction.compileMessage();

  return transaction;
}

/**
 * Get pool reserves (vault balances)
 */
export async function getPoolReserves(
  connection: Connection,
  vault0: PublicKey,
  vault1: PublicKey
): Promise<{ reserve0: BN; reserve1: BN } | null> {
  try {
    const [vault0Account, vault1Account] = await Promise.all([
      connection.getAccountInfo(vault0),
      connection.getAccountInfo(vault1),
    ]);

    if (!vault0Account || !vault1Account) {
      return null;
    }

    // TokenAccount structure: mint (32) + owner (32) + amount (8) + ...
    const reserve0 = new BN(vault0Account.data.slice(64, 72), 'le');
    const reserve1 = new BN(vault1Account.data.slice(64, 72), 'le');

    return { reserve0, reserve1 };
  } catch (error) {
    console.error('❌ Error fetching pool reserves:', error);
    return null;
  }
}

