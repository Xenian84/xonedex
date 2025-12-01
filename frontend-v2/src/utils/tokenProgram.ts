/**
 * Token Program Utilities
 * 
 * Helper functions to detect and work with Token vs Token 2022 programs
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export const TOKEN_PROGRAM_ID_PUBKEY = TOKEN_PROGRAM_ID;
export const TOKEN_2022_PROGRAM_ID_PUBKEY = TOKEN_2022_PROGRAM_ID;

/**
 * Check if a mint uses Token 2022 program
 */
export async function isToken2022Mint(
  connection: Connection,
  mint: PublicKey
): Promise<boolean> {
  try {
    const mintInfo = await connection.getAccountInfo(mint);
    if (!mintInfo) return false;
    return mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  } catch {
    return false;
  }
}

/**
 * Get the token program ID for a mint
 */
export async function getTokenProgramId(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const is2022 = await isToken2022Mint(connection, mint);
  return is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

/**
 * Check if a token account uses Token 2022 program
 */
export async function isToken2022Account(
  connection: Connection,
  account: PublicKey
): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(account);
    if (!accountInfo) return false;
    return accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  } catch {
    return false;
  }
}

/**
 * Get token program ID from token info (if available)
 */
export function getTokenProgramIdFromInfo(tokenInfo?: { programId?: string | PublicKey }): PublicKey {
  if (!tokenInfo?.programId) {
    return TOKEN_PROGRAM_ID; // Default to standard Token
  }
  
  const programId = typeof tokenInfo.programId === 'string' 
    ? new PublicKey(tokenInfo.programId)
    : tokenInfo.programId;
  
  return programId.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

/**
 * Check if program ID is Token 2022
 */
export function isToken2022ProgramId(programId: PublicKey | string): boolean {
  const id = typeof programId === 'string' ? new PublicKey(programId) : programId;
  return id.equals(TOKEN_2022_PROGRAM_ID);
}

