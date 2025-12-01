/**
 * Native XNT Swap Transaction Builder
 * 
 * Builds transactions for swapping XNT ↔ SPL tokens without wrapped XNT
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
  getPoolState,
  getNativePoolReserves,
  calculateNativeSwapOutput,
  calculateNativeSwapInput,
} from './nativePool';

import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Swap instruction discriminator (Anchor-generated)
 * sha256("global:swap_native")[0..8]
 * Browser-compatible version using @noble/hashes
 */
function getSwapNativeDiscriminator(): Buffer {
  const data = new TextEncoder().encode('global:swap_native');
  const hash = sha256(data);
  return Buffer.from(hash.slice(0, 8));
}

/**
 * Serialize swap_native instruction data
 */
function serializeSwapNative(
  amountIn: bigint,
  minAmountOut: bigint,
  isXntToToken: boolean
): Buffer {
  const data = Buffer.alloc(8 + 8 + 8 + 1);
  let offset = 0;
  
  // Discriminator
  const discriminator = getSwapNativeDiscriminator();
  discriminator.copy(data, offset);
  offset += 8;
  
  // amount_in (u64)
  data.writeBigUInt64LE(amountIn, offset);
  offset += 8;
  
  // min_amount_out (u64)
  data.writeBigUInt64LE(minAmountOut, offset);
  offset += 8;
  
  // is_xnt_to_token (bool)
  data.writeUInt8(isXntToToken ? 1 : 0, offset);
  
  return data;
}

/**
 * Build native swap transaction
 */
export async function buildNativeSwapTransaction(
  connection: Connection,
  programId: PublicKey,
  user: PublicKey,
  tokenMint: PublicKey,
  amountIn: bigint,
  minAmountOut: bigint,
  isXntToToken: boolean,
  slippageBps: number = 50 // 0.5% default
): Promise<Transaction> {
  // Derive PDAs
  const [poolState] = derivePoolState(tokenMint, programId);
  const [poolPda] = derivePoolPda(poolState, programId);
  const [tokenVault] = deriveTokenVault(poolState, programId);
  const [poolAuthority] = derivePoolAuthority(poolState, programId);
  
  // Get pool state to determine token program
  const poolStateData = await getPoolState(connection, poolState);
  if (!poolStateData) {
    throw new Error('Pool not found');
  }
  
  if (!poolStateData.isNativePool) {
    throw new Error('Pool is not a native pool');
  }
  
  // Get token mint info to determine program ID
  const tokenMintInfo = await connection.getAccountInfo(tokenMint);
  if (!tokenMintInfo) {
    throw new Error('Token mint not found');
  }
  
  const isToken2022 = tokenMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  const tokenProgramId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  
  // Get or create user's token account
  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    user,
    false,
    tokenProgramId
  );
  
  const transaction = new Transaction();
  
  // Check if user token account exists
  const userTokenInfo = await connection.getAccountInfo(userTokenAccount);
  if (!userTokenInfo && !isXntToToken) {
    // If swapping Token → XNT, user needs token account
    const createAtaIx = createAssociatedTokenAccountInstruction(
      user,
      userTokenAccount,
      user,
      tokenMint,
      tokenProgramId
    );
    transaction.add(createAtaIx);
  }
  
  // Build swap instruction
  const swapData = serializeSwapNative(amountIn, minAmountOut, isXntToToken);
  
  // Check if protocol treasury is set (even if fees are 0, account might be referenced)
  const DEFAULT_PUBKEY = new PublicKey('11111111111111111111111111111111');
  const hasProtocolTreasury = poolStateData.protocolTreasury 
    && !poolStateData.protocolTreasury.equals(DEFAULT_PUBKEY);
  const hasProtocolFee = hasProtocolTreasury && poolStateData.protocolFeeBps > 0;
  
  console.log('💰 Protocol Fee Check:');
  console.log('  protocolTreasury:', poolStateData.protocolTreasury?.toString());
  console.log('  protocolFeeBps:', poolStateData.protocolFeeBps);
  console.log('  hasProtocolTreasury:', hasProtocolTreasury);
  console.log('  hasProtocolFee:', hasProtocolFee);
  
  // Protocol treasury account is now REQUIRED in SwapNative context
  // Always include it, even if it's the default pubkey
  const treasuryPubkey = hasProtocolTreasury 
    ? poolStateData.protocolTreasury 
    : DEFAULT_PUBKEY;
  
  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: tokenVault, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // For Token2022 tokens
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: treasuryPubkey, isSigner: false, isWritable: true }, // Protocol treasury (required in context)
  ];
  
  console.log('  ✅ Protocol treasury account added:', treasuryPubkey.toString());
  
  console.log(`📋 Total accounts in instruction: ${keys.length}`);
  
  const swapIx = new TransactionInstruction({
    keys,
    programId,
    data: swapData,
  });
  
  transaction.add(swapIx);
  
  // Set transaction parameters
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = user;
  
  return transaction;
}

/**
 * Get quote for native swap
 */
export async function getNativeSwapQuote(
  connection: Connection,
  programId: PublicKey,
  tokenMint: PublicKey,
  amountIn: bigint,
  isXntToToken: boolean
): Promise<{
  amountOut: bigint;
  fee: bigint;
  priceImpact: number;
  reserveIn: bigint;
  reserveOut: bigint;
} | null> {
  try {
    const [poolState] = derivePoolState(tokenMint, programId);
    const [poolPda] = derivePoolPda(poolState, programId);
    const [tokenVault] = deriveTokenVault(poolState, programId);
    
    // Get pool state
    const poolStateData = await getPoolState(connection, poolState);
    if (!poolStateData || !poolStateData.isNativePool) {
      return null;
    }
    
    // Get reserves
    const reserves = await getNativePoolReserves(connection, poolState, poolPda, tokenVault);
    if (!reserves) {
      return null;
    }
    
    const { nativeReserve, tokenReserve } = reserves;
    
    // Determine input/output reserves based on swap direction
    const reserveIn = isXntToToken ? nativeReserve : tokenReserve;
    const reserveOut = isXntToToken ? tokenReserve : nativeReserve;
    
    // Calculate output
    const { amountOut, fee } = calculateNativeSwapOutput(
      amountIn,
      reserveIn,
      reserveOut,
      poolStateData.feeNumerator,
      poolStateData.feeDenominator
    );
    
    // Calculate price impact
    const priceImpact = Number((amountIn * 10000n) / reserveIn) / 100;
    
    return {
      amountOut,
      fee,
      priceImpact,
      reserveIn,
      reserveOut,
    };
  } catch (error) {
    console.error('Error getting native swap quote:', error);
    return null;
  }
}

/**
 * Get reverse quote (calculate input for desired output)
 */
export async function getNativeSwapReverseQuote(
  connection: Connection,
  programId: PublicKey,
  tokenMint: PublicKey,
  amountOut: bigint,
  isXntToToken: boolean
): Promise<{
  amountIn: bigint;
  fee: bigint;
  priceImpact: number;
} | null> {
  try {
    const [poolState] = derivePoolState(tokenMint, programId);
    const [poolPda] = derivePoolPda(poolState, programId);
    const [tokenVault] = deriveTokenVault(poolState, programId);
    
    // Get pool state
    const poolStateData = await getPoolState(connection, poolState);
    if (!poolStateData || !poolStateData.isNativePool) {
      return null;
    }
    
    // Get reserves
    const reserves = await getNativePoolReserves(connection, poolState, poolPda, tokenVault);
    if (!reserves) {
      return null;
    }
    
    const { nativeReserve, tokenReserve } = reserves;
    
    // Determine input/output reserves based on swap direction
    const reserveIn = isXntToToken ? nativeReserve : tokenReserve;
    const reserveOut = isXntToToken ? tokenReserve : nativeReserve;
    
    // Calculate input
    const { amountIn, fee } = calculateNativeSwapInput(
      amountOut,
      reserveIn,
      reserveOut,
      poolStateData.feeNumerator,
      poolStateData.feeDenominator
    );
    
    // Calculate price impact
    const priceImpact = Number((amountIn * 10000n) / reserveIn) / 100;
    
    return {
      amountIn,
      fee,
      priceImpact,
    };
  } catch (error) {
    console.error('Error getting native swap reverse quote:', error);
    return null;
  }
}

