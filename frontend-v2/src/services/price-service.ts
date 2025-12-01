/**
 * Price Service - Modular pricing with easy oracle integration
 * 
 * Currently uses pool-based pricing (XNT = $1)
 * Ready for oracle integration (Pyth, Switchboard, Chainlink)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { derivePoolState, derivePoolVaults } from '../utils/v2AmmPool';
import { getTokenAccountBalance } from '../utils/tokenAccount';
import { XNT_TOKEN_INFO } from '../config/x1-native';

// ============================================================================
// CONFIGURATION - Switch between pricing methods
// ============================================================================

export enum PriceSource {
  POOL = 'pool',           // Use DEX pool reserves (current)
  PYTH = 'pyth',          // Pyth Network oracle
  SWITCHBOARD = 'switchboard', // Switchboard oracle
  CHAINLINK = 'chainlink',     // Chainlink oracle (if available)
  HYBRID = 'hybrid',      // Use oracle for XNT, pool for others
}

// Change this to switch price sources
export const PRICE_SOURCE: PriceSource = PriceSource.POOL;

// XNT base price assumption (update when using pool-based pricing)
export const XNT_BASE_PRICE_USD = 1.0;

// Oracle addresses (to be filled when oracles are available)
export const ORACLE_ADDRESSES = {
  // Pyth price feeds (X1 testnet/mainnet)
  PYTH_XNT_USD: '', // Will be like: 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD'
  
  // Switchboard feeds
  SWITCHBOARD_XNT_USD: '',
  
  // Add more as needed
  PYTH_SOL_USD: '', // For reference/comparison
};

// ============================================================================
// PRICE CACHE - Avoid redundant fetches
// ============================================================================

interface PriceCache {
  [key: string]: {
    price: number;
    timestamp: number;
  };
}

const priceCache: PriceCache = {};
const CACHE_DURATION = 30000; // 30 seconds

// ============================================================================
// POOL-BASED PRICING (Current Implementation)
// ============================================================================

/**
 * Get token price in USD from pool reserves
 * Assumes: XNT = $1, calculates other tokens from XNT pools
 */
async function getPoolBasedPrice(
  connection: Connection,
  tokenMint: string
): Promise<number | null> {
  // Check cache first
  const cacheKey = `pool:${tokenMint}`;
  const cached = priceCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.price;
  }

  try {
    const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
    const isXNT = tokenMint === NATIVE_MINT || tokenMint === XNT_TOKEN_INFO.address;

    // XNT = $1 (base assumption)
    if (isXNT) {
      const price = XNT_BASE_PRICE_USD;
      priceCache[cacheKey] = { price, timestamp: Date.now() };
      return price;
    }

    // For other tokens, get price from XNT pool
    const tokenMintPubkey = new PublicKey(tokenMint);
    
    // Check if this is a native XNT pool first
    const { derivePoolState: deriveNativePoolState, getPoolState, getNativePoolReserves, derivePoolPda, deriveTokenVault } = await import('../utils/nativePool');
    const { isNativeXNT } = await import('../config/x1-native');
    const { useNetworkStore } = await import('../store/useNetworkStore');
    
    try {
      // Get dynamic program ID from network store
      const networkConfig = useNetworkStore.getState().config;
      const programId = new PublicKey(networkConfig.ammProgramId);
      
      // Try native pool first
      const [nativePoolState] = deriveNativePoolState(tokenMintPubkey, programId);
      const nativePoolStateData = await getPoolState(connection, nativePoolState);
      
      if (nativePoolStateData?.isNativePool) {
        // Use native pool reserves
        const [poolPda] = derivePoolPda(nativePoolState, programId);
        const [tokenVault] = deriveTokenVault(nativePoolState, programId);
        const reserves = await getNativePoolReserves(connection, nativePoolState, poolPda, tokenVault);
        
        if (reserves) {
          const xntReserve = Number(reserves.nativeReserve) / 1e9;
          const tokenReserve = Number(reserves.tokenReserve) / 1e9;
          
          if (xntReserve > 0 && tokenReserve > 0) {
            const price = xntReserve / tokenReserve * XNT_BASE_PRICE_USD;
            priceCache[cacheKey] = { price, timestamp: Date.now() };
            return price;
          }
        }
      }
    } catch (e) {
      // Not a native pool, fall through to regular pool
    }
    
    // Fall back to regular V2 AMM pool
    const { derivePoolState, derivePoolVaults } = await import('../utils/v2AmmPool');
    const { getTokenAccountBalance } = await import('../utils/tokenAccount');
    
    // For regular pools, we need wrapped XNT mint (testnet only)
    // On mainnet, this won't work - need to use native pools
    const WRAPPED_XNT_MINT = 'So11111111111111111111111111111111111111112';
    const xntMint = new PublicKey(WRAPPED_XNT_MINT);
    
    // Derive pool between wrapped XNT and this token
    const [poolState] = derivePoolState(xntMint, tokenMintPubkey);
    const { vault0, vault1 } = derivePoolVaults(poolState);
    
    // Get pool reserves (these are in raw lamports/smallest units)
    const [vault0Balance, vault1Balance] = await Promise.all([
      getTokenAccountBalance(connection, vault0),
      getTokenAccountBalance(connection, vault1)
    ]);

    // Convert to decimal amounts (both XNT and standard tokens use 9 decimals)
    // NOTE: If tokens have different decimals, this needs to be adjusted
    const reserve0 = Number(vault0Balance) / 1e9;
    const reserve1 = Number(vault1Balance) / 1e9;

    if (reserve0 === 0 || reserve1 === 0) {
      console.warn(`Pool has zero reserves for ${tokenMint}`);
      return null;
    }

    // Determine which vault is XNT (pool state sorts mints by address)
    const xntIsSmaller = xntMint.toBuffer().compare(tokenMintPubkey.toBuffer()) < 0;
    const xntReserve = xntIsSmaller ? reserve0 : reserve1;
    const tokenReserve = xntIsSmaller ? reserve1 : reserve0;

    // Price: 1 TOKEN = (xntReserve / tokenReserve) XNT
    // This gives us how many XNT you get for 1 TOKEN
    const tokenPriceInXNT = xntReserve / tokenReserve;
    const tokenPriceInUSD = tokenPriceInXNT * XNT_BASE_PRICE_USD;

    console.log(`[Price] ${tokenMint.slice(0, 8)}... price:`, {
      xntReserve: xntReserve.toFixed(2),
      tokenReserve: tokenReserve.toFixed(2),
      priceInXNT: tokenPriceInXNT.toExponential(4),
      priceInUSD: tokenPriceInUSD.toExponential(4),
    });

    // Cache the result
    priceCache[cacheKey] = { price: tokenPriceInUSD, timestamp: Date.now() };

    return tokenPriceInUSD;
  } catch (e) {
    console.error('Error getting pool-based price for', tokenMint, ':', e);
    return null;
  }
}

// ============================================================================
// ORACLE-BASED PRICING (Ready for Integration)
// ============================================================================

/**
 * Get token price from Pyth oracle
 * 
 * Integration steps when Pyth is available:
 * 1. Install: npm install @pythnetwork/client
 * 2. Get oracle address from Pyth for XNT/USD feed
 * 3. Uncomment the implementation below
 */
async function getPythPrice(
  connection: Connection,
  tokenMint: string
): Promise<number | null> {
  // TODO: Implement when Pyth is available on X1
  // 
  // Example implementation:
  // import { PythConnection, getPythProgramKeyForCluster } from '@pythnetwork/client';
  // 
  // const pythConnection = new PythConnection(connection, getPythProgramKeyForCluster('mainnet-beta'));
  // const data = await pythConnection.getAssetPricesFromAccounts([ORACLE_ADDRESSES.PYTH_XNT_USD]);
  // const xntPrice = data[0].price;
  // 
  // For other tokens: multiply by XNT pool price
  // if (tokenMint !== XNT) {
  //   const tokenPriceInXNT = await getPoolBasedPrice(connection, tokenMint) / xntPrice;
  //   return tokenPriceInXNT * xntPrice;
  // }
  // 
  // return xntPrice;
  
  console.warn('Pyth oracle not yet configured');
  return null;
}

/**
 * Get token price from Switchboard oracle
 * 
 * Integration steps when Switchboard is available:
 * 1. Install: npm install @switchboard-xyz/solana.js
 * 2. Get aggregator address for XNT/USD feed
 * 3. Uncomment the implementation below
 */
async function getSwitchboardPrice(
  connection: Connection,
  tokenMint: string
): Promise<number | null> {
  // TODO: Implement when Switchboard is available on X1
  //
  // Example implementation:
  // import { AggregatorAccount } from '@switchboard-xyz/solana.js';
  //
  // const aggregatorAccount = new AggregatorAccount({
  //   program,
  //   publicKey: new PublicKey(ORACLE_ADDRESSES.SWITCHBOARD_XNT_USD)
  // });
  //
  // const result = await aggregatorAccount.getLatestValue();
  // return result.toNumber();
  
  console.warn('Switchboard oracle not yet configured');
  return null;
}

/**
 * Hybrid mode: Use oracle for XNT, pool for other tokens
 */
async function getHybridPrice(
  connection: Connection,
  tokenMint: string
): Promise<number | null> {
  const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
  const isXNT = tokenMint === NATIVE_MINT || tokenMint === XNT_TOKEN_INFO.address;

  if (isXNT) {
    // Try oracle first, fallback to assumption
    const oraclePrice = await getPythPrice(connection, tokenMint);
    return oraclePrice || XNT_BASE_PRICE_USD;
  } else {
    // For other tokens, use pool-based pricing
    return getPoolBasedPrice(connection, tokenMint);
  }
}

// ============================================================================
// MAIN API - Single entry point for all price queries
// ============================================================================

/**
 * Get USD price for any token
 * Automatically uses configured price source
 * 
 * @param connection - Solana connection
 * @param tokenMint - Token mint address
 * @returns USD price or null if unavailable
 */
export async function getTokenPriceUSD(
  connection: Connection,
  tokenMint: string
): Promise<number | null> {
  try {
    switch (PRICE_SOURCE) {
      case PriceSource.POOL:
        return getPoolBasedPrice(connection, tokenMint);
      
      case PriceSource.PYTH:
        return getPythPrice(connection, tokenMint);
      
      case PriceSource.SWITCHBOARD:
        return getSwitchboardPrice(connection, tokenMint);
      
      case PriceSource.HYBRID:
        return getHybridPrice(connection, tokenMint);
      
      default:
        return getPoolBasedPrice(connection, tokenMint);
    }
  } catch (e) {
    console.error('Error getting token price:', e);
    return null;
  }
}

/**
 * Get multiple token prices in parallel
 * More efficient than calling getTokenPriceUSD multiple times
 */
export async function getTokenPricesUSD(
  connection: Connection,
  tokenMints: string[]
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  
  const results = await Promise.allSettled(
    tokenMints.map(mint => getTokenPriceUSD(connection, mint))
  );
  
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value !== null) {
      prices.set(tokenMints[index], result.value);
    }
  });
  
  return prices;
}

/**
 * Calculate USD value for a token amount
 */
export async function calculateUSDValue(
  connection: Connection,
  tokenMint: string,
  amount: number
): Promise<number | null> {
  const price = await getTokenPriceUSD(connection, tokenMint);
  if (price === null) return null;
  
  return amount * price;
}

/**
 * Clear price cache (useful for testing or manual refresh)
 */
export function clearPriceCache() {
  Object.keys(priceCache).forEach(key => delete priceCache[key]);
}

// ============================================================================
// ORACLE INTEGRATION GUIDE
// ============================================================================

/**
 * WHEN ORACLES BECOME AVAILABLE ON X1:
 * 
 * 1. PYTH NETWORK:
 *    - Install: npm install @pythnetwork/client
 *    - Get XNT/USD price feed address from Pyth
 *    - Update ORACLE_ADDRESSES.PYTH_XNT_USD
 *    - Uncomment getPythPrice implementation
 *    - Set PRICE_SOURCE = PriceSource.PYTH or HYBRID
 * 
 * 2. SWITCHBOARD:
 *    - Install: npm install @switchboard-xyz/solana.js
 *    - Create or find XNT/USD aggregator on Switchboard
 *    - Update ORACLE_ADDRESSES.SWITCHBOARD_XNT_USD
 *    - Uncomment getSwitchboardPrice implementation
 *    - Set PRICE_SOURCE = PriceSource.SWITCHBOARD or HYBRID
 * 
 * 3. HYBRID MODE (RECOMMENDED):
 *    - Uses oracle for XNT price (more accurate)
 *    - Uses pools for other tokens (always current)
 *    - Set PRICE_SOURCE = PriceSource.HYBRID
 *    - Best of both worlds!
 * 
 * 4. UPDATING COMPONENTS:
 *    - No changes needed! Components already use this service
 *    - Just switch PRICE_SOURCE and everything updates automatically
 * 
 * 5. TESTING:
 *    - Add oracle addresses to ORACLE_ADDRESSES
 *    - Switch PRICE_SOURCE
 *    - Test with clearPriceCache() to force refresh
 *    - Verify prices match expected values
 */

// Export constants for external use
export { XNT_BASE_PRICE_USD as XNT_PRICE };

