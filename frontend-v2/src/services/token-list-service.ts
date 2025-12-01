/**
 * Token List Service
 * 
 * Fetches and parses token lists from external sources.
 * Follows Uniswap Token Lists standard.
 */

import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';
import type { TokenListSource } from '../config/token-lists';

export interface TokenList {
  name: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  timestamp: string;
  tokens: TokenListToken[];
}

export interface TokenListToken {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  verified?: boolean;
  extensions?: {
    program?: string;
    [key: string]: any;
  };
}

export interface ParsedTokenInfo extends TokenInfo {
  source: string;
  trustLevel: 'high' | 'medium' | 'low' | 'none';
  verified: boolean;
}

/**
 * Fetch token list from URL
 */
// In-memory cache for token lists (prevents redundant fetches)
const tokenListCache = new Map<string, { data: TokenList; timestamp: number }>();
const CACHE_DURATION = 60000; // 1 minute cache

export async function fetchTokenList(url: string): Promise<TokenList | null> {
  try {
    // Check cache first
    const cached = tokenListCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`📦 Using cached token list for: ${url}`);
      return cached.data;
    }
    
    // Add cache busting only if cache expired
    const cacheBustUrl = url.includes('?') 
      ? `${url}&v=${Math.floor(Date.now() / CACHE_DURATION)}` 
      : `${url}?v=${Math.floor(Date.now() / CACHE_DURATION)}`;
    
    console.log(`📥 Fetching token list from: ${cacheBustUrl}`);
    
    const response = await fetch(cacheBustUrl, {
      headers: {
        'Accept': 'application/json',
      },
      cache: 'default', // Allow browser caching
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Validate token list structure
    if (!data.tokens || !Array.isArray(data.tokens)) {
      throw new Error('Invalid token list format');
    }

    // Cache the result
    tokenListCache.set(url, { data: data as TokenList, timestamp: Date.now() });

    return data as TokenList;
  } catch (error) {
    console.error(`Failed to fetch token list from ${url}:`, error);
    return null;
  }
}

/**
 * Parse token list into TokenInfo format
 */
export function parseTokenList(
  list: TokenList,
  source: TokenListSource
): ParsedTokenInfo[] {
  const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  
  return list.tokens.map(token => {
    // Check if token is Token 2022 based on extensions
    const isToken2022 = token.extensions?.program === 'Token2022' || 
                        (token as any).extensions?.program === 'Token2022';
    
    return {
      chainId: token.chainId || 0,
      address: token.address,
      programId: isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      decimals: token.decimals,
      symbol: token.symbol,
      name: token.name,
      logoURI: token.logoURI || '',
      tags: token.tags || [],
      extensions: token.extensions || {},
      type: 'raydium',
      hasFreeze: false,
      hasTransferFee: false,
      priority: source.trustLevel === 'high' ? 1 : 2,
      // Custom fields
      source: source.name,
      trustLevel: source.trustLevel,
      verified: source.trustLevel === 'high' || source.trustLevel === 'medium' || token.verified === true,
    };
  }) as ParsedTokenInfo[];
}

/**
 * Load all enabled token lists
 */
export async function loadAllTokenLists(
  sources: TokenListSource[]
): Promise<Map<string, ParsedTokenInfo>> {
  const tokenMap = new Map<string, ParsedTokenInfo>();
  
  const enabledSources = sources.filter(s => s.enabled);
  
  console.log(`🔄 Loading ${enabledSources.length} token list(s)...`);

  const results = await Promise.allSettled(
    enabledSources.map(async (source) => {
      const list = await fetchTokenList(source.url);
      if (list) {
        const tokens = parseTokenList(list, source);
        console.log(`✅ Loaded ${tokens.length} tokens from ${source.name}:`, tokens.map(t => ({ symbol: t.symbol, address: t.address, verified: t.verified })));
        return { source: source.name, tokens };
      }
      return null;
    })
  );

  // Merge tokens (later sources override earlier ones for same address)
  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      result.value.tokens.forEach((token) => {
        tokenMap.set(token.address, token);
        console.log(`📝 Adding token to registry: ${token.symbol} (${token.address.slice(0, 8)}...) - verified: ${token.verified}`);
      });
    } else if (result.status === 'rejected') {
      console.error(`❌ Failed to load token list:`, result.reason);
    }
  });

  console.log(`✅ Total unique tokens loaded: ${tokenMap.size}`);
  return tokenMap;
}

