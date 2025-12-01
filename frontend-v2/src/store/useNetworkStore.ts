import { create } from 'zustand';

export type NetworkType = 'testnet' | 'mainnet';

const NETWORK_KEY = '_xonedex_network_';

interface NetworkConfig {
  name: string;
  displayName: string;
  rpcUrl: string;
  explorerUrl: string;
  color: string;
  ammProgramId: string;
  allowWalletDiscovery: boolean; // Disable wallet token discovery on mainnet until ready
}

const NETWORKS: Record<NetworkType, NetworkConfig> = {
  testnet: {
    name: 'testnet',
    displayName: 'Testnet',
    rpcUrl: 'https://rpc.testnet.x1.xyz',
    explorerUrl: 'https://explorer.testnet.x1.xyz',
    color: 'bg-green-500',
    ammProgramId: '2Sya8FEfD1J6wbR6imW6YFjQgaamLQY1ZSghRPKWSxPu',
    allowWalletDiscovery: true, // Allow discovering test tokens
  },
  mainnet: {
    name: 'mainnet',
    displayName: 'Mainnet',
    rpcUrl: 'https://rpc.mainnet.x1.xyz',
    explorerUrl: 'https://explorer.mainnet.x1.xyz',
    color: 'bg-blue-500',
    ammProgramId: 'AMMEDavgL7M5tbrxoXmtmxM7iArJb98KkoBW1EtFFJ2', // Vanity Address!
    allowWalletDiscovery: false, // Disable on mainnet - only show verified tokens
  },
};

interface NetworkStore {
  network: NetworkType;
  config: NetworkConfig;
  setNetwork: (network: NetworkType) => void;
  getConfig: () => NetworkConfig;
}

// Load from localStorage
const loadNetwork = (): NetworkType => {
  try {
    const stored = localStorage.getItem(NETWORK_KEY);
    if (stored === 'mainnet' || stored === 'testnet') {
      return stored;
    }
  } catch {
    // ignore
  }
  return 'testnet'; // Default to testnet
};

export const useNetworkStore = create<NetworkStore>((set, get) => ({
  network: loadNetwork(),
  config: NETWORKS[loadNetwork()],

  setNetwork: (network: NetworkType) => {
    try {
      localStorage.setItem(NETWORK_KEY, network);
    } catch {
      // ignore
    }
    
    // Clear token store cache when switching networks
    try {
      const { useTokenStore } = require('./useTokenStore');
      useTokenStore.getState().clearAllTokens();
    } catch {
      // ignore if store not available
    }
    
    set({ network, config: NETWORKS[network] });
    // Reload page to reconnect with new RPC
    window.location.reload();
  },

  getConfig: () => get().config,
}));

export { NETWORKS };

