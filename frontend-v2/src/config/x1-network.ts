/**
 * X1 Network Configuration
 * Based on X1 blockchain (Solana fork with full SVM compatibility)
 */

export interface X1RPCConfig {
  name: string;
  http: string;
  ws?: string;
}

// X1 RPC Endpoints - YOUR SPECIFIED RPCS
export const X1_TESTNET_RPC: X1RPCConfig = {
  name: 'X1 Testnet',
  http: 'https://rpc.testnet.x1.xyz',
  ws: 'wss://rpc.testnet.x1.xyz'
};

export const X1_MAINNET_RPC: X1RPCConfig = {
  name: 'X1 Mainnet',
  http: 'https://rpc.mainnet.x1.xyz',
  ws: 'wss://rpc.mainnet.x1.xyz'
};

// X1 Explorer URLs - YOUR SPECIFIED EXPLORERS
export const X1_EXPLORER = {
  testnet: 'https://explorer.testnet.x1.xyz',
  mainnet: 'https://explorer.mainnet.x1.xyz'
};

// XoneDEX AMM Program IDs (Uniswap V2 Style)
export const XONEDEX_AMM_PROGRAM_ID = {
  TESTNET: '2Sya8FEfD1J6wbR6imW6YFjQgaamLQY1ZSghRPKWSxPu',
  MAINNET: 'AMMEDavgL7M5tbrxoXmtmxM7iArJb98KkoBW1EtFFJ2', // Vanity Address!
};

/**
 * Get current X1 RPC endpoint based on network
 */
export function getCurrentX1RPC(network: 'testnet' | 'mainnet' = 'testnet'): X1RPCConfig {
  return network === 'testnet' ? X1_TESTNET_RPC : X1_MAINNET_RPC;
}

/**
 * Get current AMM program ID based on network
 */
export function getAmmProgramId(network: 'testnet' | 'mainnet' = 'testnet'): string {
  return network === 'testnet' ? XONEDEX_AMM_PROGRAM_ID.TESTNET : XONEDEX_AMM_PROGRAM_ID.MAINNET;
}

/**
 * Get X1 Explorer URL for transaction/address
 */
export function getX1ExplorerUrl(
  type: 'tx' | 'address' | 'token',
  value: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): string {
  const baseUrl = network === 'testnet' ? X1_EXPLORER.testnet : X1_EXPLORER.mainnet;
  
  switch (type) {
    case 'tx':
      return `${baseUrl}/tx/${value}`;
    case 'address':
      return `${baseUrl}/address/${value}`;
    case 'token':
      // X1 explorer uses /address/ for tokens, not /token/
      return `${baseUrl}/address/${value}`;
    default:
      return baseUrl;
  }
}

// Default network for wallet adapter
export const X1_NETWORK = 'testnet'; // or 'mainnet'

