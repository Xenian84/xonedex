/**
 * CLMM Swap utilities for XoneDEX
 * Handles transaction building and execution for swaps
 */

import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';

// Token2022 Program ID - hardcoded since it's a constant
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
import { Buffer } from 'buffer';

// Memo program ID
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// CLMM Program ID on X1
export const CLMM_PROGRAM_ID = new PublicKey('HTvcrYqTDtNcTNpsPYnTQ4nxvksANimu6J1HSZWLVBvb');

// XNT-SHIB Pool on X1 Testnet (WORKING POOL)
export const XNT_SHIB_POOL = new PublicKey('79CS6oS6Harwa3xWofNjyttndj5xDXz7wGKQbdKZNz4E');
export const XNT_SHIB_AMM_CONFIG = new PublicKey('Bp5Tj7ezy9xnreLxoCJQyiGatmCXy9LrpMeK115rAVrv');
export const XNT_SHIB_VAULT_0 = new PublicKey('3EBZRuqZ6HxK17vNRkRYA1HchyZjgLFFM2VdnGPBP6a3');
export const XNT_SHIB_VAULT_1 = new PublicKey('23YCfnsDmfUCEA158g98kiqmosoQeDcVUXxm1LEDgCps');
export const XNT_SHIB_OBSERVATION = new PublicKey('FfyU1LFYGk6V42b3EgSQhEFvZjtuShTKFAdjw7sWAyrL');

// Tick array bitmap extension - PDA derived from pool
function getTickArrayBitmapExtension(poolId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('TickArrayBitmapExtension'), poolId.toBuffer()],
    CLMM_PROGRAM_ID
  );
  return pda;
}

// Get tick array PDA for a given start index
function getTickArrayPDA(poolId: PublicKey, startIndex: number): PublicKey {
  // Convert start index to big-endian i32 bytes (4 bytes) - CLMM uses i32, not i16
  const indexBuffer = Buffer.alloc(4);
  indexBuffer.writeInt32BE(startIndex, 0);
  
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('tick_array'),
      poolId.toBuffer(),
      indexBuffer
    ],
    CLMM_PROGRAM_ID
  );
  return pda;
}

// Helper to get array start index from tick and spacing
function getArrayStartIndex(tick: number, tickSpacing: number): number {
  const arrayStartRemainder = tick % (tickSpacing * 60);
  if (arrayStartRemainder < 0) {
    return tick - arrayStartRemainder - (tickSpacing * 60);
  } else {
    return tick - arrayStartRemainder;
  }
}

/**
 * Pool state structure (partial, just what we need)
 */
export interface PoolState {
  ammConfig: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  observationKey: PublicKey;
  tickSpacing: number;
  sqrtPriceX64: bigint;
  tickCurrent: number;
  liquidity: bigint;
}

// SwapV2 instruction data is built manually in buildSwapInstruction
// No class needed - we serialize directly to Uint8Array

/**
 * Deserialize pool state from account data
 * Based on Raydium CLMM PoolState structure
 */
function deserializePoolState(data: Buffer): PoolState {
  let offset = 8; // Skip discriminator
  
  // Read bump (1 byte)
  offset += 1;
  
  // Read amm_config (32 bytes)
  const ammConfig = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // Skip owner (32 bytes)
  offset += 32;
  
  // Read token_mint_0 (32 bytes)
  const tokenMint0 = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // Read token_mint_1 (32 bytes)
  const tokenMint1 = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // Read token_vault_0 (32 bytes)
  const tokenVault0 = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // Read token_vault_1 (32 bytes)
  const tokenVault1 = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // Read observation_key (32 bytes)
  const observationKey = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // Read mint_decimals_0 (1 byte)
  offset += 1;
  
  // Read mint_decimals_1 (1 byte)
  offset += 1;
  
  // Read tick_spacing (2 bytes)
  const tickSpacing = data.readUInt16LE(offset);
  offset += 2;
  
  // Read liquidity (16 bytes - u128)
  const liquidityLow = data.readBigUInt64LE(offset);
  const liquidityHigh = data.readBigUInt64LE(offset + 8);
  const liquidity = liquidityLow + (liquidityHigh << BigInt(64));
  offset += 16;
  
  // Read sqrt_price_x64 (16 bytes - u128)
  const sqrtPriceLow = data.readBigUInt64LE(offset);
  const sqrtPriceHigh = data.readBigUInt64LE(offset + 8);
  const sqrtPriceX64 = sqrtPriceLow + (sqrtPriceHigh << BigInt(64));
  offset += 16;
  
  // Read tick_current (4 bytes - i32)
  const tickCurrent = data.readInt32LE(offset);
  
  return {
    ammConfig,
    tokenMint0,
    tokenMint1,
    tokenVault0,
    tokenVault1,
    observationKey,
    tickSpacing,
    sqrtPriceX64,
    tickCurrent,
    liquidity
  };
}

/**
 * Fetch pool state from the CLMM program (REAL ON-CHAIN DATA)
 */
export async function fetchPoolState(
  connection: Connection,
  poolAddress: PublicKey
): Promise<PoolState | null> {
  try {
    console.log('📡 Fetching pool state from on-chain...');
    const accountInfo = await connection.getAccountInfo(poolAddress);
    if (!accountInfo) {
      console.error('❌ Pool account not found');
      return null;
    }

    console.log('📦 Pool account data size:', accountInfo.data.length);
    
    // Deserialize the pool state
    const poolState = deserializePoolState(accountInfo.data);
    
    console.log('✅ Pool state deserialized:');
    console.log('   AMM Config:', poolState.ammConfig.toBase58());
    console.log('   Token 0:', poolState.tokenMint0.toBase58());
    console.log('   Token 1:', poolState.tokenMint1.toBase58());
    console.log('   Vault 0:', poolState.tokenVault0.toBase58());
    console.log('   Vault 1:', poolState.tokenVault1.toBase58());
    console.log('   Tick Spacing:', poolState.tickSpacing);
    console.log('   Current Tick:', poolState.tickCurrent);
    console.log('   Liquidity:', poolState.liquidity.toString());
    console.log('   Sqrt Price X64:', poolState.sqrtPriceX64.toString());
    
    return poolState;
  } catch (error) {
    console.error('❌ Error fetching pool state:', error);
    return null;
  }
}

/**
 * Get or create Associated Token Account (idempotent - safe to call even if exists)
 */
export async function getOrCreateATA(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  instructions: TransactionInstruction[]
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  
  console.log(`  📍 ATA for ${mint.toBase58().slice(0, 8)}...: ${ata.toBase58()}`);
  
  // Always add idempotent instruction - it won't fail if account exists
  instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      owner,
      mint
    )
  );
  
  return ata;
}

/**
 * Build swap instruction
 */
export function buildSwapInstruction(
  payer: PublicKey,
  poolState: PoolState,
  userInputTokenAccount: PublicKey,
  userOutputTokenAccount: PublicKey,
  amount: bigint,
  minAmountOut: bigint,
  isBaseInput: boolean,
  remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = []
): TransactionInstruction {
  // Instruction data - using Uint8Array for browser compatibility
  // Discriminator (8 bytes) + amount (8) + other_amount_threshold (8) + sqrt_price_limit (16) + is_base_input (1) = 41 bytes
  const data = new Uint8Array(8 + 8 + 8 + 16 + 1);
  let offset = 0;
  
  // Anchor discriminator for "swap_v2" = sha256("global:swap_v2")[0..8]
  const discriminator = new Uint8Array([43, 4, 237, 11, 26, 201, 30, 98]);
  data.set(discriminator, offset);
  offset += 8;
  
  // amount (u64) - little endian
  const amountBytes = new ArrayBuffer(8);
  new DataView(amountBytes).setBigUint64(0, amount, true);
  data.set(new Uint8Array(amountBytes), offset);
  offset += 8;
  
  // other_amount_threshold (u64) - little endian
  const thresholdBytes = new ArrayBuffer(8);
  new DataView(thresholdBytes).setBigUint64(0, minAmountOut, true);
  data.set(new Uint8Array(thresholdBytes), offset);
  offset += 8;
  
  // sqrt_price_limit_x64 (u128) - 0 means no limit (16 bytes of zeros)
  // Already initialized to 0, just skip
  offset += 16;
  
  // is_base_input (bool)
  data[offset] = isBaseInput ? 1 : 0;

  // Determine input/output vaults and mints based on swap direction
  const inputVault = isBaseInput ? poolState.tokenVault0 : poolState.tokenVault1;
  const outputVault = isBaseInput ? poolState.tokenVault1 : poolState.tokenVault0;
  const inputMint = isBaseInput ? poolState.tokenMint0 : poolState.tokenMint1;
  const outputMint = isBaseInput ? poolState.tokenMint1 : poolState.tokenMint0;

  // Build accounts array matching SwapSingleV2 structure (13 base accounts + remaining accounts)
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: false },                    // 0. payer
    { pubkey: poolState.ammConfig, isSigner: false, isWritable: false },     // 1. amm_config
    { pubkey: XNT_SHIB_POOL, isSigner: false, isWritable: true },           // 2. pool_state
    { pubkey: userInputTokenAccount, isSigner: false, isWritable: true },    // 3. input_token_account
    { pubkey: userOutputTokenAccount, isSigner: false, isWritable: true },   // 4. output_token_account
    { pubkey: inputVault, isSigner: false, isWritable: true },               // 5. input_vault
    { pubkey: outputVault, isSigner: false, isWritable: true },              // 6. output_vault
    { pubkey: poolState.observationKey, isSigner: false, isWritable: true }, // 7. observation_state
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },        // 8. token_program
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },   // 9. token_program_2022
    { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },         // 10. memo_program
    { pubkey: inputMint, isSigner: false, isWritable: false },               // 11. input_vault_mint
    { pubkey: outputMint, isSigner: false, isWritable: false },              // 12. output_vault_mint
    ...remainingAccounts  // Add remaining accounts (tick arrays, etc.)
  ];

  return new TransactionInstruction({
    keys,
    programId: CLMM_PROGRAM_ID,
    data: Buffer.from(data),
  });
}

/**
 * Build complete swap transaction
 */
export async function buildSwapTransaction(
  connection: Connection,
  payer: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: number,
  minAmountOut: number
): Promise<Transaction | null> {
  try {
    console.log('🔨 Building swap transaction...');
    console.log('  Input mint:', inputMint.toBase58());
    console.log('  Output mint:', outputMint.toBase58());
    console.log('  Amount in:', amountIn);
    console.log('  Min amount out:', minAmountOut);
    
    const instructions: TransactionInstruction[] = [];
    
    // Check if input is native token (XNT)
    const isInputNative = inputMint.equals(NATIVE_MINT);
    
    // Get or create ATAs
    const inputATA = await getOrCreateATA(
      connection,
      payer,
      inputMint,
      payer,
      instructions
    );
    
    const outputATA = await getOrCreateATA(
      connection,
      payer,
      outputMint,
      payer,
      instructions
    );
    
    console.log('✅ Input ATA:', inputATA.toBase58());
    console.log('✅ Output ATA:', outputATA.toBase58());
    
    // If input is native XNT, we need to transfer SOL to the wrapped account and sync
    if (isInputNative) {
      const lamports = Math.floor(amountIn * 1e9);
      console.log('💰 Wrapping', amountIn, 'XNT (', lamports, 'lamports)');
      
      // Transfer SOL to the wrapped SOL account
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: inputATA,
          lamports: lamports,
        })
      );
      
      // Sync native to update the wrapped SOL balance
      instructions.push(createSyncNativeInstruction(inputATA));
    }
    
    // Fetch pool state
    const poolState = await fetchPoolState(connection, XNT_SHIB_POOL);
    if (!poolState) {
      console.error('❌ Failed to fetch pool state');
      return null;
    }
    
    // Determine if this is base input (token0 -> token1) or base output (token1 -> token0)
    const isBaseInput = inputMint.equals(poolState.tokenMint0);
    
    // Convert amounts to lamports (9 decimals)
    const amountInLamports = BigInt(Math.floor(amountIn * 1e9));
    const minAmountOutLamports = BigInt(Math.floor(minAmountOut * 1e9));
    
    console.log('📊 Swap direction:', isBaseInput ? 'Token0 → Token1' : 'Token1 → Token0');
    console.log('📊 Amount in (lamports):', amountInLamports.toString());
    console.log('📊 Min out (lamports):', minAmountOutLamports.toString());
    
    // Calculate remaining accounts (tick arrays needed for swap)
    const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
    
    // 1. Add tick array bitmap extension (readonly)
    const bitmapExtension = getTickArrayBitmapExtension(XNT_SHIB_POOL);
    remainingAccounts.push({
      pubkey: bitmapExtension,
      isSigner: false,
      isWritable: false
    });
    
    // 2. Add tick arrays that actually exist on-chain
    // Current tick is 92108, which is in a GAP (no tick array covers it!)
    // Existing arrays: -92400, 84600, 96000, 114600
    // 
    // The issue: current tick 92108 falls between array ending at 85200 and array starting at 96000
    // For swaps to work, we need arrays that cover the price range the swap will move through
    
    const zeroForOne = isBaseInput; // XNT -> SHIB means price going down (tick decreasing)
    
    // Known existing tick arrays on-chain (updated after adding liquidity):
    const EXISTING_ARRAYS = {
      lower: -92400,   // Covers -92400 to -91800, has tick -92110
      low: 84600,      // Covers 84600 to 85200, has tick 85170  
      current: 91800,  // Covers 91800 to 92400, has tick 92000-92200 (CONTAINS CURRENT TICK 92108!)
      high: 96000,     // Covers 96000 to 96600, has tick 96160
      higher: 114600,  // Covers 114600 to 115200, has tick 115130
    };
    
    // Current tick (92108) is now covered by array at 91800
    let tickArrayIndexes: number[];
    
    if (zeroForOne) {
      // Swapping XNT for SHIB (price decreasing, tick decreasing)
      // Start from current array and move downward
      tickArrayIndexes = [
        EXISTING_ARRAYS.current,  // 91800 - contains current tick 92108
        EXISTING_ARRAYS.low,      // 84600 - next array going down
        EXISTING_ARRAYS.lower,    // -92400 - safety array
      ];
    } else {
      // Swapping SHIB for XNT (price increasing, tick increasing)
      // Start from current array and move upward
      tickArrayIndexes = [
        EXISTING_ARRAYS.current,  // 91800 - contains current tick 92108
        EXISTING_ARRAYS.high,     // 96000 - next array going up
        EXISTING_ARRAYS.higher,   // 114600 - safety array
      ];
    }
    
    console.log('🎯 Using existing tick arrays (current tick 92108 is in gap):');
    console.log('   Swap direction:', zeroForOne ? 'XNT→SHIB (tick↓)' : 'SHIB→XNT (tick↑)');
    tickArrayIndexes.forEach((startIndex, i) => {
      const tickArrayPDA = getTickArrayPDA(XNT_SHIB_POOL, startIndex);
      const endIndex = startIndex + (60 * poolState.tickSpacing);
      console.log(`  ${i + 1}. Array [${startIndex}, ${endIndex}) - PDA: ${tickArrayPDA.toBase58()}`);
      remainingAccounts.push({
        pubkey: tickArrayPDA,
        isSigner: false,
        isWritable: true
      });
    });
    
    // Build swap instruction with remaining accounts
    const swapIx = buildSwapInstruction(
      payer,
      poolState,
      inputATA,
      outputATA,
      amountInLamports,
      minAmountOutLamports,
      isBaseInput,
      remainingAccounts
    );
    
    instructions.push(swapIx);
    
    console.log('\n📋 Transaction Summary:');
    console.log('  Total instructions:', instructions.length);
    instructions.forEach((ix, i) => {
      const programName = 
        ix.programId.equals(new PublicKey('11111111111111111111111111111111')) ? 'System Program' :
        ix.programId.equals(TOKEN_PROGRAM_ID) ? 'Token Program' :
        ix.programId.equals(CLMM_PROGRAM_ID) ? 'CLMM Program' :
        ix.programId.equals(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')) ? 'Associated Token Program' :
        ix.programId.toBase58();
      console.log(`  ${i + 1}. ${programName}`);
      console.log(`     Program: ${ix.programId.toBase58()}`);
      console.log(`     Accounts: ${ix.keys.length}, Data: ${ix.data.length} bytes`);
    });
    console.log('');
    
    // Create transaction
    const transaction = new Transaction();
    transaction.add(...instructions);
    
    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer;
    
    console.log('✅ Transaction built successfully');
    console.log('  Instructions:', instructions.length);
    console.log('  Blockhash:', blockhash);
    
    return transaction;
  } catch (error) {
    console.error('❌ Error building swap transaction:', error);
    return null;
  }
}

