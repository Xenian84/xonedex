/**
 * V2 AMM Liquidity utilities for XoneDEX
 * Handles transaction building for add_liquidity and remove_liquidity operations
 * 
 * See docs/LIQUIDITY_INSTRUCTIONS.md for complete documentation
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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAccount,
  NATIVE_MINT,
} from '@solana/spl-token';
import { isToken2022Mint } from './tokenProgram';
import { getTokenAccountBalance } from './tokenAccount';
import { Buffer } from 'buffer';
import BN from 'bn.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { 
  derivePoolState, 
  derivePoolAuthority, 
  derivePoolVaults,
  getVaultsForMints,
} from './v2AmmPool';
import { getAmmProgramId, XNT_MINT } from './v2AmmSwap';

/**
 * Build initialize_pool instruction
 * This creates a new pool if it doesn't exist
 */
async function buildInitPoolInstruction(
  connection: Connection,
  payer: PublicKey,
  mint0: PublicKey,
  mint1: PublicKey,
  poolState: PublicKey,
  poolAuthority: PublicKey,
  vault0: PublicKey,
  vault1: PublicKey,
  poolMint: PublicKey,
  mint0Is2022: boolean,
  mint1Is2022: boolean
): Promise<TransactionInstruction> {
  // Anchor instruction discriminator: sha256("global:initialize_pool")[:8]
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode('global:initialize_pool'));
  const discriminator = Buffer.from(hash.slice(0, 8));

  // LP fee: 0.3% = 30/10000
  const FEE_NUMERATOR = new BN(30);
  const FEE_DENOMINATOR = new BN(10000);
  
  // Protocol fee: 0.2% = 20 basis points (goes to treasury)
  const PROTOCOL_FEE_BPS = 20; // 0.2%
  
  // Treasury wallet (deployer wallet)
  const TREASURY_WALLET = import.meta.env.VITE_PROTOCOL_TREASURY 
    ? new PublicKey(import.meta.env.VITE_PROTOCOL_TREASURY)
    : new PublicKey('2sgQ7LzA7urZ4joMy4uU3Rcus82ZoLbHa54UvChJc9j3'); // Default (same as before)
  
  // Encode arguments: u64 feeNumerator, u64 feeDenominator, Option<Pubkey> protocolTreasury, Option<u16> protocolFeeBps
  const feeNumBuffer = Buffer.allocUnsafe(8);
  feeNumBuffer.writeBigUInt64LE(BigInt(FEE_NUMERATOR.toString()), 0);
  
  const feeDenBuffer = Buffer.allocUnsafe(8);
  feeDenBuffer.writeBigUInt64LE(BigInt(FEE_DENOMINATOR.toString()), 0);
  
  // Option encoding: 1 byte (0 = None, 1 = Some) + optional value
  // Protocol treasury: Some(treasury_wallet)
  const protocolTreasuryOption = Buffer.concat([
    Buffer.from([1]), // Some
    TREASURY_WALLET.toBuffer()
  ]);
  
  // Protocol fee: Some(20 bps = 0.2%)
  const protocolFeeBpsBuffer = Buffer.allocUnsafe(2);
  protocolFeeBpsBuffer.writeUInt16LE(PROTOCOL_FEE_BPS, 0);
  const protocolFeeBpsOption = Buffer.concat([
    Buffer.from([1]), // Some
    protocolFeeBpsBuffer
  ]);

  const data = Buffer.concat([
    discriminator,
    feeNumBuffer,
    feeDenBuffer,
    protocolTreasuryOption,
    protocolFeeBpsOption
  ]);

  return new TransactionInstruction({
    programId: getAmmProgramId(),
    keys: [
      { pubkey: mint0, isSigner: false, isWritable: false },
      { pubkey: mint1, isSigner: false, isWritable: false },
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: vault0, isSigner: false, isWritable: true },
      { pubkey: vault1, isSigner: false, isWritable: true },
      { pubkey: poolMint, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build add_liquidity instruction
 * 
 * @param poolState - Pool state PDA
 * @param poolAuthority - Pool authority PDA
 * @param vault0 - Vault0 PDA (holds mint0)
 * @param vault1 - Vault1 PDA (holds mint1)
 * @param poolMint - Pool mint PDA (LP token)
 * @param user0 - User's token account for mint0
 * @param user1 - User's token account for mint1
 * @param userPoolAta - User's LP token account
 * @param owner - User wallet (signer)
 * @param amountLiq0 - Amount of token0 to deposit
 * @param amountLiq1 - Amount of token1 to deposit
 */
export function buildAddLiquidityInstruction(
  poolState: PublicKey,
  poolAuthority: PublicKey,
  vault0: PublicKey,
  vault1: PublicKey,
  poolMint: PublicKey,
  user0: PublicKey,
  user1: PublicKey,
  userPoolAta: PublicKey,
  owner: PublicKey,
  amountLiq0: BN,
  amountLiq1: BN
): TransactionInstruction {
  // Anchor instruction discriminator: sha256("global:add_liquidity")[:8]
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode('global:add_liquidity'));
  const discriminator = Buffer.from(hash.slice(0, 8));

  // Encode arguments: amount_liq0 (u64) + amount_liq1 (u64)
  const amountLiq0Buffer = Buffer.allocUnsafe(8);
  amountLiq0Buffer.writeBigUInt64LE(BigInt(amountLiq0.toString()), 0);
  
  const amountLiq1Buffer = Buffer.allocUnsafe(8);
  amountLiq1Buffer.writeBigUInt64LE(BigInt(amountLiq1.toString()), 0);

  const data = Buffer.concat([discriminator, amountLiq0Buffer, amountLiq1Buffer]);

  return new TransactionInstruction({
    programId: getAmmProgramId(),
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false }, // Script shows false!
      { pubkey: vault0, isSigner: false, isWritable: true },
      { pubkey: vault1, isSigner: false, isWritable: true },
      { pubkey: poolMint, isSigner: false, isWritable: true },
      { pubkey: user0, isSigner: false, isWritable: true },
      { pubkey: user1, isSigner: false, isWritable: true },
      { pubkey: userPoolAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // Token 2022 program
    ],
    data,
  });
}

/**
 * Build remove_liquidity instruction
 * 
 * @param poolState - Pool state PDA
 * @param poolAuthority - Pool authority PDA
 * @param vault0 - Vault0 PDA (holds mint0)
 * @param vault1 - Vault1 PDA (holds mint1)
 * @param poolMint - Pool mint PDA (LP token)
 * @param user0 - User's token account for mint0 (receives tokens)
 * @param user1 - User's token account for mint1 (receives tokens)
 * @param userPoolAta - User's LP token account (burns tokens)
 * @param owner - User wallet (signer)
 * @param burnAmount - Amount of LP tokens to burn
 */
export function buildRemoveLiquidityInstruction(
  poolState: PublicKey,
  poolAuthority: PublicKey,
  vault0: PublicKey,
  vault1: PublicKey,
  poolMint: PublicKey,
  user0: PublicKey,
  user1: PublicKey,
  userPoolAta: PublicKey,
  owner: PublicKey,
  burnAmount: BN
): TransactionInstruction {
  // Anchor instruction discriminator: sha256("global:remove_liquidity")[:8]
  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode('global:remove_liquidity'));
  const discriminator = Buffer.from(hash.slice(0, 8));

  // Encode arguments: burn_amount (u64)
  const burnAmountBuffer = Buffer.allocUnsafe(8);
  burnAmountBuffer.writeBigUInt64LE(BigInt(burnAmount.toString()), 0);

  const data = Buffer.concat([discriminator, burnAmountBuffer]);

  return new TransactionInstruction({
    programId: getAmmProgramId(),
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false }, // Script shows false!
      { pubkey: vault0, isSigner: false, isWritable: true },
      { pubkey: vault1, isSigner: false, isWritable: true },
      { pubkey: poolMint, isSigner: false, isWritable: true },
      { pubkey: user0, isSigner: false, isWritable: true },
      { pubkey: user1, isSigner: false, isWritable: true },
      { pubkey: userPoolAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // Token 2022 program
    ],
    data,
  });
}

/**
 * Build complete add_liquidity transaction
 * 
 * IMPORTANT: This function handles mint sorting and vault mapping automatically.
 * The user tokens are mapped to the correct vaults based on sorted order.
 * 
 * @param connection - Solana connection
 * @param owner - User wallet
 * @param mint0 - First token mint
 * @param mint1 - Second token mint
 * @param amount0 - Amount of token0 to deposit (in token decimals)
 * @param amount1 - Amount of token1 to deposit (in token decimals)
 */
export async function buildAddLiquidityTransaction(
  connection: Connection,
  owner: PublicKey,
  mint0: PublicKey,
  mint1: PublicKey,
  amount0: BN,
  amount1: BN,
  priorityFeeInLamports: number = 0 // Priority fee in lamports
): Promise<Transaction> {
  const transaction = new Transaction();

  // Add priority fee if specified
  if (priorityFeeInLamports > 0) {
    const microLamports = Math.floor(priorityFeeInLamports * 1000000 / 300000); // Assuming 300k compute units for liquidity
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 })
    );
  }

  // 1. Sort mints to match pool structure (smaller address first)
  const [mintA, mintB] = mint0.toBuffer().compare(mint1.toBuffer()) < 0 
    ? [mint0, mint1] 
    : [mint1, mint0];
  
  // Map amounts to sorted mints
  const amountA = mint0.equals(mintA) ? amount0 : amount1;
  const amountB = mint0.equals(mintA) ? amount1 : amount0;

  // 2. Derive pool addresses (using sorted mints)
  const [poolState] = derivePoolState(mintA, mintB);
  const [poolAuthority] = derivePoolAuthority(poolState);
  const { vault0, vault1, poolMint } = derivePoolVaults(poolState);

  // 3. Detect Token 2022 for each mint (needed for both init and add liquidity)
  const mintAIs2022 = await isToken2022Mint(connection, mintA);
  const mintBIs2022 = await isToken2022Mint(connection, mintB);

  // 4. Check if pool exists, if not, initialize it first
  const poolStateAccount = await connection.getAccountInfo(poolState);
  if (!poolStateAccount) {
    console.log('🆕 Pool does not exist, initializing pool first...');
    // Build init_pool instruction
    const initPoolIx = await buildInitPoolInstruction(
      connection,
      owner,
      mintA,
      mintB,
      poolState,
      poolAuthority,
      vault0,
      vault1,
      poolMint,
      mintAIs2022,
      mintBIs2022
    );
    transaction.add(initPoolIx);
    console.log('✅ Pool initialization instruction added');
  }
  // Pool mint always uses standard Token program (LP tokens are standard)
  
  // Get user token accounts (with correct program ID for Token 2022)
  const userAtaA = await getAssociatedTokenAddress(
    mintA, 
    owner, 
    false, 
    mintAIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  );
  const userAtaB = await getAssociatedTokenAddress(
    mintB, 
    owner, 
    false, 
    mintBIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  );
  const userPoolAta = await getAssociatedTokenAddress(
    poolMint, 
    owner, 
    false, 
    TOKEN_PROGRAM_ID // Pool mint always uses standard Token
  );

  // 5. Check which accounts exist and get balances (matching script approach)
  const isMintANative = mintA.equals(NATIVE_MINT) || mintA.equals(XNT_MINT);
  const isMintBNative = mintB.equals(NATIVE_MINT) || mintB.equals(XNT_MINT);
  
  let userAtaAExists = false;
  let userAtaBExists = false;
  let userPoolAtaExists = false;
  let currentBalanceA = new BN(0);
  let currentBalanceB = new BN(0);

  // Check if accounts exist and get balances (works with both Token and Token2022)
  try {
    const balanceA = await getTokenAccountBalance(connection, userAtaA);
    userAtaAExists = balanceA !== BigInt(0) || (await connection.getAccountInfo(userAtaA)) !== null;
    if (isMintANative) {
      currentBalanceA = new BN(balanceA.toString());
    }
  } catch (e) {
    // Account doesn't exist, will be created
  }

  try {
    const balanceB = await getTokenAccountBalance(connection, userAtaB);
    userAtaBExists = balanceB !== BigInt(0) || (await connection.getAccountInfo(userAtaB)) !== null;
    if (isMintBNative) {
      currentBalanceB = new BN(balanceB.toString());
    }
  } catch (e) {
    // Account doesn't exist, will be created
  }

  try {
    const lpBalance = await getTokenAccountBalance(connection, userPoolAta);
    userPoolAtaExists = lpBalance !== BigInt(0) || (await connection.getAccountInfo(userPoolAta)) !== null;
  } catch (e) {
    // Account doesn't exist, will be created
  }

  // 6. Create user token accounts if they don't exist (MUST be done before XNT transfers)
  // Match script: create accounts first, then wrap XNT, then add liquidity (with correct program ID)
  // IMPORTANT: Use idempotent version for native mint - doesn't query extensions
  const isNativeMintA = mintA.equals(NATIVE_MINT) || mintA.equals(XNT_MINT);
  const isNativeMintB = mintB.equals(NATIVE_MINT) || mintB.equals(XNT_MINT);
  
  if (!userAtaAExists) {
    // Use idempotent instruction for native mint (doesn't query extensions)
    // Use standard instruction for others (supports Token2022)
    transaction.add(
      isNativeMintA 
        ? createAssociatedTokenAccountIdempotentInstruction(
            owner,
            userAtaA,
            owner,
            mintA
          )
        : createAssociatedTokenAccountInstruction(
            owner,
            userAtaA,
            owner,
            mintA,
            mintAIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
          )
    );
  }

  if (!userAtaBExists) {
    // Use idempotent instruction for native mint (doesn't query extensions)
    // Use standard instruction for others (supports Token2022)
    transaction.add(
      isNativeMintB
        ? createAssociatedTokenAccountIdempotentInstruction(
            owner,
            userAtaB,
            owner,
            mintB
          )
        : createAssociatedTokenAccountInstruction(
            owner,
            userAtaB,
            owner,
            mintB,
            mintBIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
          )
    );
  }

  if (!userPoolAtaExists) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userPoolAta,
        owner,
        poolMint,
        TOKEN_PROGRAM_ID // Pool mint always uses standard Token
      )
    );
  }

  // 7. Handle native XNT wrapping (matching script approach)
  // Script wraps XNT BEFORE add_liquidity instruction
  // We do it in the same transaction but BEFORE the add_liquidity instruction
  if (isMintANative) {
    const requiredBalance = amountA;
    
    // Calculate how much we need to wrap
    let wrapAmount: BN;
    if (userAtaAExists && currentBalanceA.gte(requiredBalance)) {
      // Already have enough wrapped XNT - no wrapping needed
      wrapAmount = new BN(0);
    } else if (userAtaAExists && currentBalanceA.gt(new BN(0))) {
      // Need to wrap more - calculate difference
      // Ensure we don't get negative values
      if (requiredBalance.gt(currentBalanceA)) {
        wrapAmount = requiredBalance.sub(currentBalanceA);
      } else {
        // Already have enough, no wrapping needed
        wrapAmount = new BN(0);
      }
    } else {
      // Account doesn't exist or has no balance - wrap full amount
      wrapAmount = requiredBalance;
    }
    
    // Wrap XNT if needed (matching script: transfer + sync)
    // Ensure wrapAmount is positive and non-zero
    if (wrapAmount.gt(new BN(0))) {
      const wrapAmountNum = wrapAmount.toNumber();
      if (wrapAmountNum > 0) {
        // Transfer SOL to wrapped account
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey: userAtaA,
            lamports: wrapAmountNum,
          })
        );
        
        // Sync native balance (converts SOL to wrapped XNT)
        transaction.add(createSyncNativeInstruction(userAtaA));
      }
    }
  }

  if (isMintBNative) {
    const requiredBalance = amountB;
    
    let wrapAmount: BN;
    if (userAtaBExists && currentBalanceB.gte(requiredBalance)) {
      wrapAmount = new BN(0);
    } else if (userAtaBExists && currentBalanceB.gt(new BN(0))) {
      // Ensure we don't get negative values
      if (requiredBalance.gt(currentBalanceB)) {
        wrapAmount = requiredBalance.sub(currentBalanceB);
      } else {
        // Already have enough, no wrapping needed
        wrapAmount = new BN(0);
      }
    } else {
      wrapAmount = requiredBalance;
    }
    
    // Ensure wrapAmount is positive and non-zero
    if (wrapAmount.gt(new BN(0))) {
      const wrapAmountNum = wrapAmount.toNumber();
      if (wrapAmountNum > 0) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey: userAtaB,
            lamports: wrapAmountNum,
          })
        );
        
        transaction.add(createSyncNativeInstruction(userAtaB));
      }
    }
  }

  // 8. Build add_liquidity instruction
  // vault0 holds mintA (smaller address), vault1 holds mintB (larger address)
  const addLiquidityIx = buildAddLiquidityInstruction(
    poolState,
    poolAuthority,
    vault0,      // Holds mintA
    vault1,      // Holds mintB
    poolMint,
    userAtaA,    // User's account for mintA
    userAtaB,    // User's account for mintB
    userPoolAta,
    owner,
    amountA,     // Amount of mintA
    amountB      // Amount of mintB
  );

  transaction.add(addLiquidityIx);

  // 9. Set transaction parameters
  // Get fresh blockhash right before returning to minimize expiration risk
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = owner;
  
  // Log transaction details for debugging
  console.log('📦 Transaction built:', {
    instructions: transaction.instructions.length,
    blockhash: blockhash.toString().slice(0, 8) + '...',
    lastValidBlockHeight,
  });

  // Note: Don't call compileMessage() here - let the wallet handle it
  // compileMessage() can cause serialization issues with some wallets

  return transaction;
}

/**
 * Build complete remove_liquidity transaction
 * 
 * @param connection - Solana connection
 * @param owner - User wallet
 * @param mint0 - First token mint
 * @param mint1 - Second token mint
 * @param burnAmount - Amount of LP tokens to burn
 */
export async function buildRemoveLiquidityTransaction(
  connection: Connection,
  owner: PublicKey,
  mint0: PublicKey,
  mint1: PublicKey,
  burnAmount: BN,
  priorityFeeInLamports: number = 0 // Priority fee in lamports
): Promise<Transaction> {
  const transaction = new Transaction();

  // Add priority fee if specified
  if (priorityFeeInLamports > 0) {
    const microLamports = Math.floor(priorityFeeInLamports * 1000000 / 250000); // Assuming 250k compute units for removal
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250000 })
    );
  }

  // 1. Sort mints to match pool structure
  const [mintA, mintB] = mint0.toBuffer().compare(mint1.toBuffer()) < 0 
    ? [mint0, mint1] 
    : [mint1, mint0];

  // 2. Derive pool addresses
  const [poolState] = derivePoolState(mintA, mintB);
  const [poolAuthority] = derivePoolAuthority(poolState);
  const { vault0, vault1, poolMint } = derivePoolVaults(poolState);

  // 3. Verify pool exists
  const poolStateAccount = await connection.getAccountInfo(poolState);
  if (!poolStateAccount) {
    throw new Error(`Pool does not exist for ${mint0.toString()} / ${mint1.toString()}`);
  }

  // 4. Detect Token 2022 for each mint
  const mintAIs2022 = await isToken2022Mint(connection, mintA);
  const mintBIs2022 = await isToken2022Mint(connection, mintB);
  
  // Get user token accounts (with correct program ID for Token 2022)
  const userAtaA = await getAssociatedTokenAddress(
    mintA, 
    owner, 
    false, 
    mintAIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  );
  const userAtaB = await getAssociatedTokenAddress(
    mintB, 
    owner, 
    false, 
    mintBIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  );
  const userPoolAta = await getAssociatedTokenAddress(
    poolMint, 
    owner, 
    false, 
    TOKEN_PROGRAM_ID // Pool mint always uses standard Token
  );

  // 5. Create user token accounts if they don't exist (for receiving tokens, with correct program ID)
  try {
    await getAccount(
      connection, 
      userAtaA, 
      'confirmed',
      mintAIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );
  } catch (e) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userAtaA,
        owner,
        mintA,
        mintAIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      )
    );
  }

  try {
    await getAccount(
      connection, 
      userAtaB, 
      'confirmed',
      mintBIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );
  } catch (e) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userAtaB,
        owner,
        mintB,
        mintBIs2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      )
    );
  }

  // userPoolAta must exist (user must have LP tokens)
  try {
    await getAccount(connection, userPoolAta);
  } catch (e) {
    throw new Error(`User LP token account does not exist. User must have LP tokens to remove liquidity.`);
  }

  // 6. Build remove_liquidity instruction
  const removeLiquidityIx = buildRemoveLiquidityInstruction(
    poolState,
    poolAuthority,
    vault0,      // Holds mintA
    vault1,      // Holds mintB
    poolMint,
    userAtaA,    // User's account for mintA (receives tokens)
    userAtaB,    // User's account for mintB (receives tokens)
    userPoolAta, // User's LP account (burns tokens)
    owner,
    burnAmount
  );

  transaction.add(removeLiquidityIx);

  // 7. Set transaction parameters
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = owner;

  // Note: Don't call compileMessage() here - let the wallet handle it

  return transaction;
}

