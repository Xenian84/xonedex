import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';
import { NATIVE_XNT_MARKER, WRAPPED_XNT_MINT_TESTNET } from './x1-native';

/**
 * X1 Network Token List
 * 
 * X1 is a Solana fork with full SVM compatibility.
 * We identify X1 network by RPC endpoint, not chain ID:
 * - X1 Testnet: https://rpc.testnet.x1.xyz
 * - X1 Mainnet: https://rpc.mainnet.x1.xyz
 * 
 * Token list is loaded from on-chain data or maintained manually.
 */

// X1 Native Token (XNT) - NOW USES NATIVE MARKER, NOT WRAPPED ADDRESS!
export const XNT_MINT = NATIVE_XNT_MARKER;

// Known X1 Testnet tokens
// XNT is the base token for all trading pairs on X1
export const X1_TESTNET_TOKENS: TokenInfo[] = [
  // XNT - Native token (base trading pair)
  {
    chainId: 0,
    address: XNT_MINT,
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 9,
    symbol: 'XNT',
    name: 'X1 Network Token',
    logoURI: '',
    tags: ['x1-native', 'x1-testnet'],
    extensions: {},
    type: 'raydium',
    hasFreeze: false,
    hasTransferFee: false,
    priority: 0
  } as TokenInfo,
  
  // SHIB - Test token for XoneDEX testing
  {
    chainId: 0,
    address: 'BkDWpvd24xu8J6AsWWLDi5ArC5ekHUL4CkpfWnxkos3p', // Correct SHIB token
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 9,
    symbol: 'SHIB',
    name: 'SHIBA INU',
    logoURI: '',
    tags: ['test-token', 'x1-testnet'],
    extensions: {},
    type: 'raydium',
    hasFreeze: false,
    hasTransferFee: false,
    priority: 1
  } as TokenInfo,
  
  // XEN - XEN Token for XoneDEX
  {
    chainId: 0,
    address: '63SFkqc14KbNQ6iyy6CNLGmrHnaTcXBxAgy5mghzPxBg',
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 9,
    symbol: 'XEN',
    name: 'XEN Token',
    logoURI: '',
    tags: ['test-token', 'x1-testnet'],
    extensions: {},
    type: 'raydium',
    hasFreeze: false,
    hasTransferFee: false,
    priority: 1
  } as TokenInfo,
  
  // NEWTOKEN - Second test token for AMM testing
  {
    chainId: 0,
    address: 'k6j7MEoLy9pZpPuee3kJNKfXjMMqBQzYAxdqpyaogaj',
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 9,
    symbol: 'NEWT',
    name: 'New Test Token',
    logoURI: '',
    tags: ['test-token', 'x1-testnet'],
    extensions: {},
    type: 'raydium',
    hasFreeze: false,
    hasTransferFee: false,
    priority: 2
  } as TokenInfo,
  
  // XNM - New test token for protocol fee testing (fresh pool with new program)
  {
    chainId: 0,
    address: '7yGLoF7SH4gTT86JWPKPs8Bi6vpeLQHaUkLapUyYJf25',
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 9,
    symbol: 'XNM',
    name: 'XNM Test Token',
    logoURI: '',
    tags: ['test-token', 'x1-testnet'],
    extensions: {},
    type: 'raydium',
    hasFreeze: false,
    hasTransferFee: false,
    priority: 1
  } as TokenInfo,
];

// Known X1 Mainnet tokens
// XNT is the base token for all trading pairs on X1
export const X1_MAINNET_TOKENS: TokenInfo[] = [
  // XNT - Native token (base trading pair)
  {
    chainId: 0,
    address: XNT_MINT,
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 9,
    symbol: 'XNT',
    name: 'X1 Network Token',
    logoURI: '',
    tags: ['x1-native', 'x1-mainnet'],
    extensions: {},
    type: 'raydium',
    hasFreeze: false,
    hasTransferFee: false,
    priority: 0
  } as TokenInfo,
  // Other tokens will be added as they get deployed on X1
];

/**
 * Get default tokens for current network
 * This is a fallback when SDK token.load() fails (no Jupiter API on X1)
 */
export function getX1DefaultTokens(network: 'testnet' | 'mainnet'): TokenInfo[] {
  return network === 'testnet' ? X1_TESTNET_TOKENS : X1_MAINNET_TOKENS;
}

