/**
 * X1 Native Token Configuration
 * 
 * CRITICAL: XNT is the NATIVE token (like SOL on Solana)
 * It exists as raw lamports in the wallet, NOT as an SPL token!
 * 
 * We use a special marker address to identify it in the UI,
 * but the smart contract and transactions work with raw lamports.
 */

import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';
import { PublicKey } from '@solana/web3.js';

// Special marker for native XNT (not a real SPL token mint!)
// This is just for UI identification - actual XNT is raw lamports
export const NATIVE_XNT_MARKER = 'NATIVE_XNT_11111111111111111111111111111111';

// For backwards compatibility with wrapped XNT on testnet
// This is the wrapped version that exists on testnet only
export const WRAPPED_XNT_MINT_TESTNET = 'So11111111111111111111111111111111111111112';

// Alias for backwards compatibility
export const XNT_MINT = NATIVE_XNT_MARKER;

// NOTE: PROGRAM_ID is now dynamic based on network (testnet/mainnet)
// Use getAmmProgramId() from x1-network.ts or useNetworkStore.getConfig().ammProgramId

// Check if an address is native XNT
export function isNativeXNT(address: string): boolean {
  return address === NATIVE_XNT_MARKER || 
         address === 'NATIVE_XNT' ||
         address === '';  // Empty string also means native
}

export const XNT_TOKEN_INFO: TokenInfo = {
  chainId: 0,
  address: NATIVE_XNT_MARKER,  // Use special marker, not a real mint
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  decimals: 9,
  symbol: 'XNT',
  name: 'X1 Network Token (Native)',
  logoURI: 'https://x1.xyz/_next/image?url=%2Fx1-logo.png&w=96&q=75&dpl=dpl_CgqrxgM4ijNMynKBvmQG3HnYr6yY',
  tags: ['x1-native', 'native'],
  extensions: {
    isNative: true,  // Mark this as native token
  },
  type: 'raydium',
  hasFreeze: false,
  hasTransferFee: false,
  priority: 1000,  // Highest priority - show first
} as TokenInfo;

// Wrapped XNT info (testnet only - for backwards compatibility)
export const WRAPPED_XNT_TOKEN_INFO: TokenInfo = {
  chainId: 204005,
  address: WRAPPED_XNT_MINT_TESTNET,
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  decimals: 9,
  symbol: 'wXNT',
  name: 'Wrapped XNT (Testnet Only)',
  logoURI: 'https://x1.xyz/_next/image?url=%2Fx1-logo.png&w=96&q=75&dpl=dpl_CgqrxgM4ijNMynKBvmQG3HnYr6yY',
  tags: ['wrapped', 'testnet'],
  extensions: {},
  type: 'raydium',
  hasFreeze: false,
  hasTransferFee: false,
  priority: 0,
} as TokenInfo;

