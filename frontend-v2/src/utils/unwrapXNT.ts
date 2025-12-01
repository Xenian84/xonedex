/**
 * Utility to unwrap XNT (wrapped SOL) back to native SOL
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createCloseAccountInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import { getTokenAccountBalance } from './tokenAccount';

/**
 * Build transaction to unwrap XNT (close wrapped SOL account and transfer SOL back)
 */
export async function buildUnwrapXNTTransaction(
  connection: Connection,
  owner: PublicKey
): Promise<Transaction | null> {
  try {
    const transaction = new Transaction();

    // Get the wrapped SOL token account (ATA for native mint)
    const wrappedAccount = await getAssociatedTokenAddress(NATIVE_MINT, owner);

    // Check if account exists and has balance
    const balance = await getTokenAccountBalance(connection, wrappedAccount);
    
    // If account has no balance or doesn't exist, nothing to unwrap
    if (balance === BigInt(0)) {
      return null;
    }

    // Close the wrapped SOL account and transfer SOL back to owner
    transaction.add(
      createCloseAccountInstruction(
        wrappedAccount, // Account to close
        owner, // Destination for remaining SOL
        owner, // Owner of the account
        [] // No multisig signers
      )
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = owner;

    return transaction;
  } catch (error) {
    console.error('Error building unwrap transaction:', error);
    return null;
  }
}

/**
 * Get wrapped XNT balance
 */
export async function getWrappedXNTBalance(
  connection: Connection,
  owner: PublicKey
): Promise<number> {
  try {
    const wrappedAccount = await getAssociatedTokenAddress(NATIVE_MINT, owner);
    const balance = await getTokenAccountBalance(connection, wrappedAccount);
    return Number(balance) / 1e9; // Convert lamports to XNT
  } catch (e) {
    return 0;
  }
}

