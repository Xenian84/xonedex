/**
 * X1 Network Configuration for XoneDEX
 * Extracted patterns from Raydium, adapted for X1
 */

import { PublicKey } from '@solana/web3.js';

export enum X1Network {
  Mainnet = "x1-mainnet",
  Testnet = "x1-testnet",
  Local = "x1-local"
}

export const X1_NETWORK = {
  TESTNET: 'x1-testnet',
  MAINNET: 'x1-mainnet',
} as const;

// Active network
export const ACTIVE_NETWORK = X1_NETWORK.TESTNET;

// RPC Endpoints
export const RPC_ENDPOINTS = {
  [X1_NETWORK.TESTNET]: 'https://rpc.testnet.x1.xyz',
  [X1_NETWORK.MAINNET]: 'https://rpc.mainnet.x1.xyz',
};

// WebSocket Endpoints  
export const WS_ENDPOINTS = {
  [X1_NETWORK.TESTNET]: 'wss://rpc.testnet.x1.xyz',
  [X1_NETWORK.MAINNET]: 'wss://rpc.mainnet.x1.xyz',
};

// Explorer URLs
export const EXPLORER_URLS = {
  [X1_NETWORK.TESTNET]: 'https://explorer.testnet.x1.xyz',
  [X1_NETWORK.MAINNET]: 'https://explorer.mainnet.x1.xyz',
};

// AMM Program IDs (XoneDEX Uniswap V2 Style)
export const AMM_PROGRAM_IDS = {
  [X1_NETWORK.TESTNET]: new PublicKey('2Sya8FEfD1J6wbR6imW6YFjQgaamLQY1ZSghRPKWSxPu'),
  [X1_NETWORK.MAINNET]: new PublicKey('AMMEDavgL7M5tbrxoXmtmxM7iArJb98KkoBW1EtFFJ2'), // Vanity Address!
};

// Get current config
export const getCurrentRPC = () => RPC_ENDPOINTS[ACTIVE_NETWORK];
export const getCurrentWS = () => WS_ENDPOINTS[ACTIVE_NETWORK];
export const getCurrentExplorer = () => EXPLORER_URLS[ACTIVE_NETWORK];
export const getCurrentAmmProgramId = () => AMM_PROGRAM_IDS[ACTIVE_NETWORK];

// Native token (XNT) - Import from centralized config
import { NATIVE_XNT_MARKER, XNT_TOKEN_INFO as XNT_INFO_NATIVE, WRAPPED_XNT_MINT_TESTNET } from './x1-native';

// For backwards compatibility with code that expects a PublicKey
// NOTE: This will fail if used with the native marker - use string address instead
export const NATIVE_MINT = WRAPPED_XNT_MINT_TESTNET; // Legacy wrapped XNT (testnet only)

export const XNT_TOKEN = {
  symbol: 'XNT',
  name: 'X1 Network Token (Native)',
  mint: NATIVE_XNT_MARKER, // Use native marker, not wrapped address
  decimals: 9,
  logoURI: '/xnt-logo.png',
};

// Legacy exports for compatibility - now uses native marker
export const XNT_TOKEN_INFO = XNT_INFO_NATIVE;

// NOTE: PROGRAM_ID is now dynamic - use getAmmProgramId() from this file or useNetworkStore.getConfig().ammProgramId

export const defaultX1Network = ACTIVE_NETWORK;
export const defaultX1Endpoint = getCurrentRPC();
export const X1_EXPLORER_URLS = EXPLORER_URLS;
export const X1_AMM_PROGRAM_IDS = AMM_PROGRAM_IDS;

// Helper functions
export function getTxExplorerUrl(signature: string): string {
  return `${getCurrentExplorer()}/tx/${signature}`;
}

export function getAddressExplorerUrl(address: string): string {
  return `${getCurrentExplorer()}/address/${address}`;
}

