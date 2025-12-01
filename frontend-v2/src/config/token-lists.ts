/**
 * Token List Configuration
 * 
 * XoneDEX Official Token List
 * This is the ONLY token list we manage - all verified tokens go here.
 */

export interface TokenListSource {
  name: string;
  url: string;
  trustLevel: 'high' | 'medium' | 'low';
  enabled: boolean;
}

/**
 * Official XoneDEX Token List
 * 
 * Host this JSON file on:
 * - IPFS (recommended)
 * - GitHub Pages
 * - Your CDN/server
 * 
 * Update this URL when you deploy your token list.
 */
/**
 * Network-specific token lists
 */
export const TOKEN_LIST_SOURCES_BY_NETWORK: Record<'testnet' | 'mainnet', TokenListSource[]> = {
  testnet: [
    {
      name: 'XoneDEX Testnet',
      url: 'https://token-list.xonedex.xyz/testnet.json',
      trustLevel: 'high',
      enabled: true,
    },
  ],
  mainnet: [
    {
      name: 'XoneDEX Mainnet',
      url: 'https://token-list.xonedex.xyz/mainnet.json',
      trustLevel: 'high',
      enabled: true,
    },
  ],
};

/**
 * Get token list sources for a specific network
 */
export function getTokenListSources(network: 'testnet' | 'mainnet'): TokenListSource[] {
  return TOKEN_LIST_SOURCES_BY_NETWORK[network];
}

// Legacy export for backward compatibility (defaults to testnet)
export const TOKEN_LIST_SOURCES: TokenListSource[] = TOKEN_LIST_SOURCES_BY_NETWORK.testnet;

