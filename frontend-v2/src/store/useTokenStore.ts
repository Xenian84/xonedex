import { create } from 'zustand';
import { Connection, PublicKey } from '@solana/web3.js';
import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';
import { XNT_TOKEN_INFO, NATIVE_XNT_MARKER, XNT_MINT, WRAPPED_XNT_MINT_TESTNET } from '../config/x1-native';
import { loadAllTokenLists, type ParsedTokenInfo } from '../services/token-list-service';
import { getTokenListSources } from '../config/token-lists';
import { fetchTokenMetadata, fetchTokenMetadataBatch, createWalletTokenInfo } from '../services/token-metadata-service';

export interface TokenBalance {
  mint: string;
  balance: string;
  decimals: number;
  uiAmount: number;
}

interface TokenState {
  // Token registry (from lists)
  tokenRegistry: Map<string, ParsedTokenInfo>;
  
  // Wallet-discovered tokens
  walletTokens: Map<string, ParsedTokenInfo>;
  
  // User balances
  balances: Map<string, TokenBalance>;
  wrappedXNTBalance: number;
  
  // Loading states
  loadingTokens: boolean;
  loadingBalances: boolean;
  
  // Cached token list (for performance)
  _cachedTokenList: ParsedTokenInfo[] | null;
  _cacheVersion: number;
  _lastTokenListLoad: number;
  
  // Actions
  loadTokenLists: (connection: Connection, network: 'testnet' | 'mainnet') => Promise<void>;
  discoverWalletTokens: (connection: Connection, owner: PublicKey) => Promise<void>;
  loadBalances: (connection: Connection, owner: PublicKey) => Promise<void>;
  getAllTokens: () => ParsedTokenInfo[];
  getTokenInfo: (mint: string) => ParsedTokenInfo | undefined;
  getBalance: (mint: string) => TokenBalance | undefined;
  getWrappedXNTBalance: () => number;
  isTokenVerified: (mint: string) => boolean;
  getVerificationLevel: (mint: string) => 'native' | 'official' | 'community' | 'wallet' | 'unknown';
  clearAllTokens: () => void;
}

// Initialize XNT immediately (always available)
const initialXNT: ParsedTokenInfo = {
  ...XNT_TOKEN_INFO,
  source: 'native',
  trustLevel: 'high',
  verified: true,
} as ParsedTokenInfo;

const initialRegistry = new Map<string, ParsedTokenInfo>();
initialRegistry.set(NATIVE_XNT_MARKER, initialXNT);

export const useTokenStore = create<TokenState>((set, get) => ({
  tokenRegistry: initialRegistry, // Start with XNT immediately
  walletTokens: new Map(),
  balances: new Map(),
  wrappedXNTBalance: 0,
  loadingTokens: false,
  loadingBalances: false,
  _cachedTokenList: null,
  _cacheVersion: 0,
  _lastTokenListLoad: 0,

  /**
   * Load token lists from configured sources
   */
  loadTokenLists: async (connection: Connection, network: 'testnet' | 'mainnet') => {
    const state = get();
    
    // Skip if already loading or recently loaded (within 5 seconds)
    if (state.loadingTokens) {
      console.log('⏭️ Token lists already loading, skipping...');
      return;
    }
    
    // Check if we have tokens and it's been less than 5 seconds since last load
    const lastLoadTime = (state as any)._lastTokenListLoad || 0;
    if (state.tokenRegistry.size > 1 && Date.now() - lastLoadTime < 5000) {
      console.log('⏭️ Token lists recently loaded, using cached version');
      return;
    }
    
    console.log('🔄 Loading token lists for network:', network);
    set({ loadingTokens: true });
    
    try {
      // Always include XNT
      const tokenRegistry = new Map<string, ParsedTokenInfo>();
      tokenRegistry.set(XNT_MINT, {
        ...XNT_TOKEN_INFO,
        source: 'native',
        trustLevel: 'high',
        verified: true,
      } as ParsedTokenInfo);
      
      // Load from external sources (network-specific)
      const tokenListSources = getTokenListSources(network);
      const listTokens = await loadAllTokenLists(tokenListSources);
      listTokens.forEach((token, mint) => {
        tokenRegistry.set(mint, token);
      });
      
      set({
        tokenRegistry,
        loadingTokens: false,
        _cachedTokenList: null, // Invalidate cache
        _cacheVersion: get()._cacheVersion + 1,
        _lastTokenListLoad: Date.now(),
      } as any);
      
      console.log(`✅ Loaded ${tokenRegistry.size} tokens from lists`);
    } catch (error) {
      console.error('❌ Failed to load token lists:', error);
      set({ loadingTokens: false });
    }
  },

  /**
   * Discover tokens from user's wallet (optimized with batch fetching)
   */
  discoverWalletTokens: async (connection: Connection, owner: PublicKey) => {
    console.log('🔄 Discovering wallet tokens...');
    
    try {
      const { tokenRegistry, walletTokens } = get();
      const discoveredTokens = new Map<string, ParsedTokenInfo>();
      
      // Get all token accounts (both Token and Token 2022)
      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      
      const [standardAccounts, token2022Accounts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID
        }),
        connection.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_2022_PROGRAM_ID
        })
      ]);
      
      const tokenAccounts = {
        value: [...standardAccounts.value, ...token2022Accounts.value]
      };
      
      console.log(`✅ Found ${tokenAccounts.value.length} token accounts`);
      
      // Collect all mints that need metadata (excluding registry tokens)
      const mintsToFetch: string[] = [];
      const mintToAccount = new Map<string, any>();
      
      for (const account of tokenAccounts.value) {
        const mint = account.account.data.parsed.info.mint;
        
        // Skip if already in registry (registry tokens have priority and proper names)
        if (tokenRegistry.has(mint)) {
          console.log(`⏭️ Skipping ${mint.slice(0, 8)}... - already in registry`);
          continue;
        }
        
        // Only fetch if not already discovered
        if (!discoveredTokens.has(mint) && !walletTokens.has(mint)) {
          mintsToFetch.push(mint);
          mintToAccount.set(mint, account);
        }
      }
      
      // Clean up: Remove any existing wallet tokens that are now in registry
      walletTokens.forEach((token, mint) => {
        if (!tokenRegistry.has(mint)) {
          discoveredTokens.set(mint, token);
        } else {
          console.log(`🧹 Removing wallet token ${mint.slice(0, 8)}... - now in registry`);
        }
      });
      
      if (mintsToFetch.length === 0) {
        console.log('✅ No new tokens to discover');
        // Still update to clean up registry tokens
        if (discoveredTokens.size !== walletTokens.size) {
          set({ 
            walletTokens: discoveredTokens,
            _cachedTokenList: null,
            _cacheVersion: get()._cacheVersion + 1,
          });
        }
        return;
      }
      
      // Batch fetch metadata (much faster than sequential)
      const metadataMap = await fetchTokenMetadataBatch(connection, mintsToFetch);
      
      // Create token info for all discovered tokens (only those NOT in registry)
      for (const mint of mintsToFetch) {
        // Double-check registry hasn't been updated
        if (tokenRegistry.has(mint)) {
          console.log(`⏭️ Skipping ${mint.slice(0, 8)}... - now in registry`);
          continue;
        }
        const metadata = metadataMap.get(mint) || { decimals: 9 };
        const tokenInfo = createWalletTokenInfo(mint, metadata);
        discoveredTokens.set(mint, tokenInfo);
      }
      
      set({ 
        walletTokens: discoveredTokens,
        _cachedTokenList: null, // Invalidate cache
        _cacheVersion: get()._cacheVersion + 1,
      });
      console.log(`✅ Discovered ${mintsToFetch.length} wallet tokens (batch processed)`);
    } catch (error) {
      console.error('❌ Failed to discover wallet tokens:', error);
    }
  },

  /**
   * Load user token balances
   */
  loadBalances: async (connection: Connection, owner: PublicKey) => {
    console.log('🔄 Loading balances...');
    set({ loadingBalances: true });
    
    try {
      const balances = new Map<string, TokenBalance>();
      let wrappedXNTBalance = 0; // Initialize to 0 - will be updated if wrapped account exists
      
      // Get native XNT balance (raw lamports from wallet)
      // Add retry logic for network errors
      let xntBalance = 0;
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        try {
          xntBalance = await Promise.race([
            connection.getBalance(owner),
            new Promise<number>((_, reject) => 
              setTimeout(() => reject(new Error('Balance fetch timeout')), 10000)
            )
          ]);
          break; // Success, exit retry loop
        } catch (error: any) {
          retries++;
          if (retries >= maxRetries) {
            console.error('Failed to fetch XNT balance after retries:', error);
            // Use 0 as fallback - don't break the entire balance loading
            xntBalance = 0;
            break;
          }
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }
      
      balances.set(NATIVE_XNT_MARKER, {
        mint: NATIVE_XNT_MARKER,
        balance: xntBalance.toString(),
        decimals: 9,
        uiAmount: xntBalance / 1e9
      });
      
      // Get SPL token accounts (both Token and Token 2022)
      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      
      const [standardAccounts, token2022Accounts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID
        }),
        connection.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_2022_PROGRAM_ID
        })
      ]);
      
      const tokenAccounts = {
        value: [...standardAccounts.value, ...token2022Accounts.value]
      };
      
      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed.info;
        const mint = parsedInfo.mint;
        const rawAmount = parsedInfo.tokenAmount.amount;
        const decimals = parsedInfo.tokenAmount.decimals || 9;
        const uiAmount = parsedInfo.tokenAmount.uiAmount ?? (Number(rawAmount) / Math.pow(10, decimals));
        
        // Check if this is wrapped XNT (testnet only)
        if (mint === 'So11111111111111111111111111111111111111112') {
          wrappedXNTBalance = uiAmount; // Update wrapped balance if account exists
          continue; // Don't add to token list - wrapped XNT is legacy testnet only
        }
        
        // Only include tokens with meaningful balance (more than dust threshold)
        // Dust threshold: 0.000001 (1e-6) to filter out empty or near-empty accounts
        if (uiAmount > 0.000001) {
          balances.set(mint, {
            mint,
            balance: rawAmount,
            decimals,
            uiAmount
          });
        }
      }
      
      // Always set wrappedXNTBalance (0 if no wrapped account exists, or the actual balance)
      set({ balances, wrappedXNTBalance, loadingBalances: false });
      console.log(`✅ Loaded balances for ${balances.size} tokens, wrapped XNT: ${wrappedXNTBalance}`);
    } catch (error) {
      console.error('❌ Failed to load balances:', error);
      set({ loadingBalances: false });
    }
  },

  /**
   * Get all tokens (registry + wallet) - with caching for performance
   * Always includes XNT first, even if registry is empty
   */
  getAllTokens: () => {
    const { tokenRegistry, walletTokens, _cachedTokenList, _cacheVersion } = get();
    
    // Return cached list if available and still valid
    if (_cachedTokenList) {
      return _cachedTokenList;
    }
    
    // Build token list - always include XNT first
    const allTokens: ParsedTokenInfo[] = [];
    
    // Always add XNT first (even if not in registry yet - fallback)
    const xntToken = tokenRegistry.get(XNT_MINT) || initialXNT;
    allTokens.push(xntToken);
    
    // Add registry tokens (skip XNT to avoid duplicate)
    tokenRegistry.forEach(token => {
      if (token.address !== XNT_MINT) {
        allTokens.push(token);
      }
    });
    
    // Add wallet tokens not in registry
    walletTokens.forEach((token, mint) => {
      if (!tokenRegistry.has(mint) && mint !== XNT_MINT) {
        allTokens.push(token);
      }
    });
    
    // Cache the result
    set({ _cachedTokenList: allTokens });
    
    return allTokens;
  },

  getTokenInfo: (mint: string) => {
    const { tokenRegistry, walletTokens } = get();
    
    // Always return XNT immediately (hardcoded fallback)
    if (mint === XNT_MINT) {
      return tokenRegistry.get(XNT_MINT) || initialXNT;
    }
    
    return tokenRegistry.get(mint) || walletTokens.get(mint);
  },

  getBalance: (mint: string) => {
    return get().balances.get(mint);
  },

  getWrappedXNTBalance: () => {
    return get().wrappedXNTBalance;
  },

  isTokenVerified: (mint: string) => {
    if (mint === XNT_MINT) return true;
    const token = get().getTokenInfo(mint);
    return token?.verified === true;
  },

  getVerificationLevel: (mint: string): 'native' | 'official' | 'community' | 'wallet' | 'unknown' => {
    if (mint === XNT_MINT) return 'native';
    const token = get().getTokenInfo(mint);
    if (!token) return 'unknown';
    if (token.source === 'wallet') return 'wallet';
    if (token.trustLevel === 'high') return 'official';
    if (token.trustLevel === 'medium') return 'community';
    return 'unknown';
  },

  /**
   * Clear all tokens (used when switching networks)
   */
  clearAllTokens: () => {
    console.log('🧹 Clearing all tokens for network switch...');
    set({
      tokenRegistry: new Map(),
      walletTokens: new Map(),
      balances: new Map(),
      wrappedXNTBalance: 0,
      loadingTokens: false,
      loadingBalances: false,
      _cachedTokenList: null,
      _cacheVersion: 0,
      _lastTokenListLoad: 0,
    });
  },
}));
