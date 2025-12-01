/**
 * Native XNT Liquidity Transaction Builder
 * 
 * Builds transactions for adding/removing liquidity to native XNT pools
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import {
  derivePoolState,
  derivePoolPda,
  deriveTokenVault,
  derivePoolAuthority,
  deriveLpMint,
  getPoolState,
  getNativePoolReserves,
} from './nativePool';

import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Instruction discriminators (Anchor-generated)
 * Browser-compatible version using @noble/hashes
 */
function getInstructionDiscriminator(name: string): Buffer {
  const data = new TextEncoder().encode(`global:${name}`);
  const hash = sha256(data);
  return Buffer.from(hash.slice(0, 8));
}

/**
 * Serialize remove_native_liquidity instruction data
 */
function serializeRemoveNativeLiquidity(lpAmount: bigint): Buffer {
  const data = Buffer.alloc(8 + 8);
  const discriminator = getInstructionDiscriminator('remove_native_liquidity');
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(lpAmount, 8);
  return data;
}

/**
 * Serialize initialize_native_pool instruction data
 */
function serializeInitializeNativePool(
  feeNumerator: bigint,
  feeDenominator: bigint,
  protocolTreasury: PublicKey,
  protocolFeeBps: number,
  nativeMintIndex: number
): Buffer {
  const data = Buffer.alloc(8 + 8 + 8 + 32 + 2 + 1);
  let offset = 0;
  
  // Discriminator
  const discriminator = getInstructionDiscriminator('initialize_native_pool');
  discriminator.copy(data, offset);
  offset += 8;
  
  // fee_numerator (u64)
  data.writeBigUInt64LE(feeNumerator, offset);
  offset += 8;
  
  // fee_denominator (u64)
  data.writeBigUInt64LE(feeDenominator, offset);
  offset += 8;
  
  // protocol_treasury (Pubkey - 32 bytes)
  protocolTreasury.toBuffer().copy(data, offset);
  offset += 32;
  
  // protocol_fee_bps (u16)
  data.writeUInt16LE(protocolFeeBps, offset);
  offset += 2;
  
  // native_mint_index (u8) - 0 = XNT is token0
  data.writeUInt8(nativeMintIndex, offset);
  
  return data;
}

/**
 * Serialize add_native_liquidity instruction data
 */
function serializeAddNativeLiquidity(
  xntAmount: bigint,
  tokenAmount: bigint,
  minLpOut: bigint
): Buffer {
  const data = Buffer.alloc(8 + 8 + 8 + 8);
  let offset = 0;
  
  // Discriminator
  const discriminator = getInstructionDiscriminator('add_native_liquidity');
  discriminator.copy(data, offset);
  offset += 8;
  
  // xnt_amount (u64)
  data.writeBigUInt64LE(xntAmount, offset);
  offset += 8;
  
  // token_amount (u64)
  data.writeBigUInt64LE(tokenAmount, offset);
  offset += 8;
  
  // min_lp_out (u64)
  data.writeBigUInt64LE(minLpOut, offset);
  
  return data;
}


/**
 * Build add native liquidity transaction
 */
export async function buildAddNativeLiquidityTransaction(
  connection: Connection,
  programId: PublicKey,
  user: PublicKey,
  tokenMint: PublicKey,
  xntAmount: bigint,
  tokenAmount: bigint,
  slippageBps: number = 50 // 0.5% default
): Promise<Transaction> {
  // Derive PDAs
  const [poolState] = derivePoolState(tokenMint, programId);
  const [poolPda] = derivePoolPda(poolState, programId);
  const [tokenVault] = deriveTokenVault(poolState, programId);
  const [lpMint] = deriveLpMint(poolState, programId);
  const [poolAuthority] = derivePoolAuthority(poolState, programId);
  
  // Get pool state to determine if pool exists
  const poolStateData = await getPoolState(connection, poolState);
  
  // Get token mint info to determine program ID (needed for both init and add liquidity)
  const tokenMintInfo = await connection.getAccountInfo(tokenMint);
  if (!tokenMintInfo) {
    throw new Error('Token mint not found');
  }
  
  const isToken2022 = tokenMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  const tokenProgramId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  
  // Get user's token accounts (tokenProgramId already determined above)
  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    user,
    false,
    tokenProgramId
  );
  
  const userLpAccount = getAssociatedTokenAddressSync(
    lpMint,
    user,
    false,
    TOKEN_PROGRAM_ID // LP tokens are always standard SPL
  );
  
  const transaction = new Transaction();
  
  // If pool doesn't exist, initialize it first (add init instruction to transaction)
  if (!poolStateData) {
    console.log('🆕 Native pool does not exist, initializing pool first...');
    
    // Protocol fee configuration (should match smart contract defaults)
    const PROTOCOL_TREASURY = import.meta.env.VITE_PROTOCOL_TREASURY 
      ? new PublicKey(import.meta.env.VITE_PROTOCOL_TREASURY)
      : new PublicKey('2sgQ7LzA7urZ4joMy4uU3Rcus82ZoLbHa54UvChJc9j3'); // Default (same as before)
    const PROTOCOL_FEE_BPS = 20; // 0.2% protocol fee
    const LP_FEE_NUMERATOR = BigInt(3); // 0.3% LP fee
    const LP_FEE_DENOMINATOR = BigInt(1000);
    const NATIVE_MINT_INDEX = 0; // XNT is always token0 in native pools
    
    // Build initialize_native_pool instruction
    const initPoolData = serializeInitializeNativePool(
      LP_FEE_NUMERATOR,
      LP_FEE_DENOMINATOR,
      PROTOCOL_TREASURY,
      PROTOCOL_FEE_BPS,
      NATIVE_MINT_INDEX
    );
    
    // Account order MUST match Anchor struct order EXACTLY (from create-pool-raw-instruction.js):
    // This is the script that successfully created the Jack pool using raw instructions
    // Anchor matches accounts by POSITION in the struct, so order is critical!
    // 1. payer
    // 2. pool_state (Anchor derives from token_mint seeds - needs token_mint in position 3!)
    // 3. token_mint (MUST be position 3 for Anchor to derive pool_state correctly!)
    // 4. token_vault
    // 5. lp_mint
    // 6. pool_authority
    // 7. token_program
    // 8. token_2022_program
    // 9. system_program
    // 10. rent
    const initPoolIx = new TransactionInstruction({
      keys: [
        { pubkey: user, isSigner: true, isWritable: true }, // 1. payer
        { pubkey: poolState, isSigner: false, isWritable: true }, // 2. pool_state
        { pubkey: tokenMint, isSigner: false, isWritable: false }, // 3. token_mint (MOVED FROM POSITION 5!)
        { pubkey: tokenVault, isSigner: false, isWritable: true }, // 4. token_vault
        { pubkey: lpMint, isSigner: false, isWritable: true }, // 5. lp_mint
        { pubkey: poolAuthority, isSigner: false, isWritable: false }, // 6. pool_authority
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 7. token_program
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // 8. token_2022_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 9. system_program
        { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false }, // 10. rent
      ],
      programId,
      data: initPoolData,
    });
    
    // Add init instruction to transaction (will be executed before add liquidity)
    transaction.add(initPoolIx);
    console.log('✅ Pool initialization instruction added to transaction');
  } else if (!poolStateData.isNativePool) {
    throw new Error('Pool exists but is not a native pool');
  }
  
  // Check if user token account exists
  const userTokenInfo = await connection.getAccountInfo(userTokenAccount);
  if (!userTokenInfo) {
    const createTokenAtaIx = createAssociatedTokenAccountInstruction(
      user,
      userTokenAccount,
      user,
      tokenMint,
      tokenProgramId
    );
    transaction.add(createTokenAtaIx);
  }
  
  // Check if user LP account exists
  const userLpInfo = await connection.getAccountInfo(userLpAccount);
  if (!userLpInfo) {
    const createLpAtaIx = createAssociatedTokenAccountInstruction(
      user,
      userLpAccount,
      user,
      lpMint,
      TOKEN_PROGRAM_ID
    );
    transaction.add(createLpAtaIx);
  }
  
  // Calculate min LP out with slippage
  const minLpOut = xntAmount - (xntAmount * BigInt(slippageBps)) / 10000n;
  
  // Build add liquidity instruction
  const addLiqData = serializeAddNativeLiquidity(xntAmount, tokenAmount, minLpOut);
  
  console.log('📋 Account details for AddNativeLiquidity:');
  console.log('  user:', user.toString());
  console.log('  poolState:', poolState.toString());
  console.log('  poolPda:', poolPda.toString());
  console.log('  tokenVault:', tokenVault.toString());
  console.log('  userTokenAccount:', userTokenAccount.toString());
  console.log('  lpMint:', lpMint.toString());
  console.log('  userLpAccount:', userLpAccount.toString());
  console.log('  poolAuthority:', poolAuthority.toString());
  console.log('  tokenProgramId:', tokenProgramId.toString());
  console.log('  TOKEN_PROGRAM_ID:', TOKEN_PROGRAM_ID.toString());
  console.log('  TOKEN_2022_PROGRAM_ID:', TOKEN_2022_PROGRAM_ID.toString());
  
  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: tokenVault, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: userLpAccount, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Standard Token Program (Anchor requires this)
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // Token2022 Program for dynamic use
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  const addLiqIx = new TransactionInstruction({
    keys,
    programId,
    data: addLiqData,
  });
  
  transaction.add(addLiqIx);
  
  // Set transaction parameters
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = user;
  
  return transaction;
}

/**
 * Build remove native liquidity transaction
 */

/**
 * Calculate optimal liquidity amounts for adding to pool
 */
export async function calculateOptimalLiquidityAmounts(
  connection: Connection,
  programId: PublicKey,
  tokenMint: PublicKey,
  xntAmount: bigint | null,
  tokenAmount: bigint | null
): Promise<{
  xntAmount: bigint;
  tokenAmount: bigint;
  lpAmount: bigint;
  shareOfPool: number;
} | null> {
  try {
    const [poolState] = derivePoolState(tokenMint, programId);
    const [poolPda] = derivePoolPda(poolState, programId);
    const [tokenVault] = deriveTokenVault(poolState, programId);
    
    const poolStateData = await getPoolState(connection, poolState);
    if (!poolStateData || !poolStateData.isNativePool) {
      return null;
    }
    
    const reserves = await getNativePoolReserves(connection, poolState, poolPda, tokenVault);
    if (!reserves) {
      return null;
    }
    
    const { nativeReserve, tokenReserve } = reserves;
    const totalLpSupply = poolStateData.totalAmountMinted;
    
    let finalXntAmount: bigint;
    let finalTokenAmount: bigint;
    let lpAmount: bigint;
    
    // If pool is empty (first deposit)
    if (nativeReserve === 0n && tokenReserve === 0n) {
      finalXntAmount = xntAmount || 0n;
      finalTokenAmount = tokenAmount || 0n;
      // For first deposit, LP = sqrt(xnt * token)
      lpAmount = sqrt(finalXntAmount * finalTokenAmount);
    }
    // If user specified XNT amount, calculate token amount
    else if (xntAmount !== null) {
      finalXntAmount = xntAmount;
      finalTokenAmount = (xntAmount * tokenReserve) / nativeReserve;
      lpAmount = (xntAmount * totalLpSupply) / nativeReserve;
    }
    // If user specified token amount, calculate XNT amount
    else if (tokenAmount !== null) {
      finalTokenAmount = tokenAmount;
      finalXntAmount = (tokenAmount * nativeReserve) / tokenReserve;
      lpAmount = (tokenAmount * totalLpSupply) / tokenReserve;
    }
    else {
      return null;
    }
    
    // Calculate share of pool
    const newTotalLp = totalLpSupply + lpAmount;
    const shareOfPool = Number((lpAmount * 10000n) / newTotalLp) / 100;
    
    return {
      xntAmount: finalXntAmount,
      tokenAmount: finalTokenAmount,
      lpAmount,
      shareOfPool,
    };
  } catch (error) {
    console.error('Error calculating optimal liquidity amounts:', error);
    return null;
  }
}

/**
 * Integer square root (using Newton's method)
 */
function sqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error('Square root of negative number');
  }
  if (value < 2n) {
    return value;
  }
  
  let x = value;
  let y = (x + 1n) / 2n;
  
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  
  return x;
}



/**
 * Build remove native liquidity transaction
 */
export async function buildRemoveNativeLiquidityTransaction(
  connection: Connection,
  user: PublicKey,
  tokenMint: string,
  lpAmount: bigint,
  ammProgramId: PublicKey
): Promise<Transaction | null> {
  console.log("🔴 REMOVE NATIVE LIQUIDITY TRANSACTION BUILDER");
  console.log(`  user: ${user.toBase58()}`);
  console.log(`  tokenMint: ${tokenMint}`);
  console.log(`  lpAmount: ${lpAmount.toString()}`);

  try {
    const tokenMintPubkey = new PublicKey(tokenMint);
    const [poolState] = derivePoolState(tokenMintPubkey, ammProgramId);
    const [poolPda] = derivePoolPda(poolState, ammProgramId);
    const [tokenVault] = deriveTokenVault(poolState, ammProgramId);
    const [poolAuthority] = derivePoolAuthority(poolState, ammProgramId);
    const [lpMint] = deriveLpMint(poolState, ammProgramId);

    const tokenVaultInfo = await connection.getAccountInfo(tokenVault);
    if (!tokenVaultInfo) {
      throw new Error('Token vault not found');
    }
    const isToken2022 = tokenVaultInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    const tokenProgramId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    const userTokenAccount = getAssociatedTokenAddressSync(tokenMintPubkey, user, false, tokenProgramId);
    const userLpAccount = getAssociatedTokenAddressSync(lpMint, user, false, TOKEN_PROGRAM_ID);

    const discriminator = getInstructionDiscriminator('remove_native_liquidity');
    const data = Buffer.alloc(16);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(lpAmount, 8);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: lpMint, isSigner: false, isWritable: true },
        { pubkey: userLpAccount, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: ammProgramId,
      data,
    });

    const transaction = new Transaction();
    transaction.add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = user;

    console.log("✅ Remove native liquidity transaction built");
    return transaction;
  } catch (error) {
    console.error("❌ Error building remove native liquidity transaction:", error);
    return null;
  }
}
