/**
 * Token Account Utilities
 * Handles both SPL Token and Token 2022 accounts
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/**
 * Get token account balance - works for both Token and Token 2022
 * Returns the raw amount (not UI amount)
 */
export async function getTokenAccountBalance(
  connection: Connection,
  accountAddress: PublicKey
): Promise<bigint> {
  try {
    const accountInfo = await connection.getAccountInfo(accountAddress);
    
    if (!accountInfo) {
      console.warn(`Token account not found: ${accountAddress.toString()}`);
      return BigInt(0);
    }

    // Check which program owns this account
    const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    const isTokenProgram = accountInfo.owner.equals(TOKEN_PROGRAM_ID);

    if (!isToken2022 && !isTokenProgram) {
      console.error(`Account is not owned by Token or Token2022 program: ${accountInfo.owner.toString()}`);
      return BigInt(0);
    }

    // For both Token and Token2022, the account layout is the same for the base fields
    // The amount field is at the same offset (64 bytes)
    // Layout: mint (32) + owner (32) + amount (8) + ...
    
    const data = accountInfo.data;
    
    // Standard token account should be at least 165 bytes
    // Token 2022 with extensions can be larger
    if (data.length < 165) {
      console.error(`Token account data too small: ${data.length} bytes`);
      return BigInt(0);
    }

    try {
      // Use AccountLayout to decode - works for both Token and Token2022
      const decoded = AccountLayout.decode(data);
      return decoded.amount;
    } catch (e) {
      // Fallback: manually read amount at offset 64
      console.warn('Failed to decode with AccountLayout, using manual parsing:', e);
      const amountBuffer = data.slice(64, 72);
      
      // Read as little-endian uint64
      let amount = BigInt(0);
      for (let i = 0; i < 8; i++) {
        amount |= BigInt(amountBuffer[i]) << BigInt(i * 8);
      }
      
      return amount;
    }
  } catch (error) {
    console.error('Error getting token account balance:', error);
    return BigInt(0);
  }
}

/**
 * Get token account info - works for both Token and Token 2022
 */
export async function getTokenAccountInfo(
  connection: Connection,
  accountAddress: PublicKey
): Promise<{
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals?: number;
} | null> {
  try {
    const accountInfo = await connection.getAccountInfo(accountAddress);
    
    if (!accountInfo) {
      console.warn(`Token account not found: ${accountAddress.toString()}`);
      return null;
    }

    const data = accountInfo.data;
    
    if (data.length < 165) {
      console.error(`Token account data too small: ${data.length} bytes`);
      return null;
    }

    try {
      // Decode using AccountLayout
      const decoded = AccountLayout.decode(data);
      
      return {
        mint: decoded.mint,
        owner: decoded.owner,
        amount: decoded.amount,
      };
    } catch (e) {
      console.warn('Failed to decode with AccountLayout, using manual parsing:', e);
      
      // Manual parsing as fallback
      // Layout: mint (32) + owner (32) + amount (8)
      const mint = new PublicKey(data.slice(0, 32));
      const owner = new PublicKey(data.slice(32, 64));
      
      // Read amount as little-endian uint64
      const amountBuffer = data.slice(64, 72);
      let amount = BigInt(0);
      for (let i = 0; i < 8; i++) {
        amount |= BigInt(amountBuffer[i]) << BigInt(i * 8);
      }
      
      return {
        mint,
        owner,
        amount,
      };
    }
  } catch (error) {
    console.error('Error getting token account info:', error);
    return null;
  }
}

