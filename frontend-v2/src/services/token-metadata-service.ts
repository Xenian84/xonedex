/**
 * Token Metadata Service
 * 
 * Fetches token metadata from on-chain sources.
 * Used for wallet-discovered tokens that aren't in token lists.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export interface TokenMetadata {
  symbol?: string;
  name?: string;
  decimals: number;
  logoURI?: string;
  programId?: PublicKey; // Token or Token 2022 program ID
}

// Cache for token metadata to avoid repeated fetches
const metadataCache = new Map<string, TokenMetadata>();

/**
 * Fetch token metadata from on-chain mint account (with caching)
 */
export async function fetchTokenMetadata(
  connection: Connection,
  mint: string
): Promise<TokenMetadata> {
  // Check cache first
  if (metadataCache.has(mint)) {
    return metadataCache.get(mint)!;
  }

  try {
    const mintPubkey = new PublicKey(mint);
    
    // Check if Token 2022 by getting account info
    let programId = TOKEN_PROGRAM_ID; // Default to standard Token
    try {
      const mintInfo = await connection.getAccountInfo(mintPubkey);
      if (mintInfo) {
        programId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) 
          ? TOKEN_2022_PROGRAM_ID 
          : TOKEN_PROGRAM_ID;
      }
    } catch {
      // If we can't check, default to standard Token
    }
    
    // Get mint account (contains decimals)
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    
    if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
      throw new Error('Invalid mint account');
    }

    const parsed = mintInfo.value.data.parsed.info;
    const decimals = parsed.decimals || 9;

    // TODO: Fetch name/symbol from Metaplex Metadata Program if available
    // For now, return basic info with placeholder name/symbol
    
    const metadata: TokenMetadata = {
      decimals,
      symbol: undefined, // Would need Metaplex metadata
      name: undefined,   // Would need Metaplex metadata
      programId, // Include program ID for Token 2022 detection
    };

    // Cache the result
    metadataCache.set(mint, metadata);
    return metadata;
  } catch (error) {
    console.error(`Failed to fetch metadata for ${mint}:`, error);
    const fallback: TokenMetadata = { decimals: 9 };
    metadataCache.set(mint, fallback);
    return fallback;
  }
}

/**
 * Batch fetch token metadata for multiple mints (more efficient)
 */
export async function fetchTokenMetadataBatch(
  connection: Connection,
  mints: string[]
): Promise<Map<string, TokenMetadata>> {
  const results = new Map<string, TokenMetadata>();
  const uncachedMints: string[] = [];

  // Check cache first
  for (const mint of mints) {
    if (metadataCache.has(mint)) {
      results.set(mint, metadataCache.get(mint)!);
    } else {
      uncachedMints.push(mint);
    }
  }

  if (uncachedMints.length === 0) {
    return results;
  }

  try {
    // Batch fetch mint accounts and detect Token 2022
    const mintPubkeys = uncachedMints.map(m => new PublicKey(m));
    const accounts = await connection.getMultipleParsedAccounts(mintPubkeys);

    for (let i = 0; i < uncachedMints.length; i++) {
      const mint = uncachedMints[i];
      const account = accounts.value[i];

      if (account && account.data && 'parsed' in account.data) {
        const parsed = account.data.parsed.info;
        const decimals = parsed.decimals || 9;
        
        // Check if Token 2022 by checking account owner
        const is2022 = account.owner.equals(TOKEN_2022_PROGRAM_ID);
        const programId = is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        
        const metadata: TokenMetadata = {
          decimals,
          symbol: undefined,
          name: undefined,
          programId, // Include program ID for Token 2022 detection
        };

        metadataCache.set(mint, metadata);
        results.set(mint, metadata);
      } else {
        // Fallback - try to detect program ID from account info
        const accountInfo = account ? await connection.getAccountInfo(mintPubkeys[i]) : null;
        const is2022 = accountInfo?.owner?.equals(TOKEN_2022_PROGRAM_ID) || false;
        const programId = is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        
        const fallback: TokenMetadata = { 
          decimals: 9,
          programId
        };
        metadataCache.set(mint, fallback);
        results.set(mint, fallback);
      }
    }
  } catch (error) {
    console.error('Failed to batch fetch metadata:', error);
    // Fallback for failed fetches
    for (const mint of uncachedMints) {
      if (!results.has(mint)) {
        const fallback: TokenMetadata = { decimals: 9 };
        metadataCache.set(mint, fallback);
        results.set(mint, fallback);
      }
    }
  }

  return results;
}

/**
 * Create TokenInfo from wallet-discovered token
 */
export function createWalletTokenInfo(
  mint: string,
  metadata: TokenMetadata
): any {
  // Use programId from metadata if available (for Token 2022 detection)
  const programId = metadata.programId || TOKEN_PROGRAM_ID;
  
  return {
    chainId: 0,
    address: mint,
    programId: programId.toBase58(),
    decimals: metadata.decimals,
    symbol: metadata.symbol || mint.slice(0, 4) + '...' + mint.slice(-4),
    name: metadata.name || `Token ${mint.slice(0, 8)}`,
    logoURI: metadata.logoURI,
    tags: [],
    extensions: {},
    type: 'raydium',
    hasFreeze: false,
    hasTransferFee: false,
    priority: 999,
    source: 'wallet',
    trustLevel: 'none' as const,
    verified: false,
    isWalletToken: true,
  };
}

