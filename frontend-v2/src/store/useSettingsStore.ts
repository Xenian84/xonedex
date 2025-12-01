import { create } from 'zustand';

export const SLIPPAGE_KEY = '_xonedex_slippage_';
export const PRIORITY_LEVEL_KEY = '_xonedex_priority_level_';
export const PRIORITY_MODE_KEY = '_xonedex_priority_mode_';
export const PRIORITY_FEE_KEY = '_xonedex_priority_fee_';
export const EXPLORER_URL_KEY = '_xonedex_explorer_url_';
export const RPC_URL_KEY = '_xonedex_rpc_url_';

export enum PriorityLevel {
  Fast = 0,
  Turbo = 1,
  Degen = 2,
}

export enum PriorityMode {
  AutoFee = 0,
  ExactFee = 1,
}

interface SettingsStore {
  // Slippage
  slippage: number; // 0.005 = 0.5%
  setSlippage: (slippage: number) => void;

  // Priority Fee
  priorityLevel: PriorityLevel;
  priorityMode: PriorityMode;
  customPriorityFee: number; // in XNT (SOL equivalent)
  setPriorityLevel: (level: PriorityLevel) => void;
  setPriorityMode: (mode: PriorityMode) => void;
  setCustomPriorityFee: (fee: number) => void;

  // Explorer URL
  explorerUrl: string;
  useCustomExplorer: boolean;
  customExplorerUrl: string;
  setExplorerUrl: (url: string) => void;
  setUseCustomExplorer: (use: boolean) => void;
  setCustomExplorerUrl: (url: string) => void;

  // RPC Endpoint
  rpcUrl: string;
  useCustomRpc: boolean;
  customRpcUrl: string;
  setRpcUrl: (url: string) => void;
  setUseCustomRpc: (use: boolean) => void;
  setCustomRpcUrl: (url: string) => void;

  // Computed priority fee
  getComputedPriorityFee: () => number;
}

// Load from localStorage
const loadFromStorage = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
};

// Save to localStorage
const saveToStorage = <T>(key: string, value: T) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to save ${key} to localStorage:`, error);
  }
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // Default: 0.5% slippage
  slippage: loadFromStorage(SLIPPAGE_KEY, 0.005),
  setSlippage: (slippage) => {
    saveToStorage(SLIPPAGE_KEY, slippage);
    set({ slippage });
  },

  // Default: Turbo level, Auto mode
  priorityLevel: loadFromStorage(PRIORITY_LEVEL_KEY, PriorityLevel.Turbo),
  priorityMode: loadFromStorage(PRIORITY_MODE_KEY, PriorityMode.AutoFee),
  customPriorityFee: loadFromStorage(PRIORITY_FEE_KEY, 0.001),
  
  setPriorityLevel: (level) => {
    saveToStorage(PRIORITY_LEVEL_KEY, level);
    set({ priorityLevel: level });
  },
  
  setPriorityMode: (mode) => {
    saveToStorage(PRIORITY_MODE_KEY, mode);
    set({ priorityMode: mode });
  },
  
  setCustomPriorityFee: (fee) => {
    saveToStorage(PRIORITY_FEE_KEY, fee);
    set({ customPriorityFee: fee });
  },

  // Default: Use network-specific explorer (will be set by useNetworkStore)
  explorerUrl: '', // Set dynamically by network
  useCustomExplorer: false,
  customExplorerUrl: loadFromStorage(EXPLORER_URL_KEY, ''),
  
  setExplorerUrl: (url) => {
    saveToStorage(EXPLORER_URL_KEY, url);
    set({ explorerUrl: url });
  },
  
  setUseCustomExplorer: (use) => {
    set({ useCustomExplorer: use });
  },
  
  setCustomExplorerUrl: (url) => {
    saveToStorage(EXPLORER_URL_KEY, url);
    set({ customExplorerUrl: url, explorerUrl: url });
  },

  // Default: Use network-specific RPC (will be set by useNetworkStore)
  rpcUrl: '', // Set dynamically by network
  useCustomRpc: false,
  customRpcUrl: loadFromStorage(RPC_URL_KEY, ''),
  
  setRpcUrl: (url) => {
    saveToStorage(RPC_URL_KEY, url);
    set({ rpcUrl: url });
  },
  
  setUseCustomRpc: (use) => {
    set({ useCustomRpc: use });
  },
  
  setCustomRpcUrl: (url) => {
    saveToStorage(RPC_URL_KEY, url);
    set({ customRpcUrl: url, rpcUrl: url });
  },

  // Compute priority fee based on mode and level
  getComputedPriorityFee: () => {
    const { priorityMode, priorityLevel, customPriorityFee } = get();
    
    if (priorityMode === PriorityMode.ExactFee) {
      return customPriorityFee;
    }
    
    // Auto-fee based on level (market avg multipliers)
    const marketAvg = 0.0005033; // Current market average in XNT
    const multipliers = {
      [PriorityLevel.Fast]: 1.1,    // +10% market avg
      [PriorityLevel.Turbo]: 1.3,   // +30% market avg
      [PriorityLevel.Degen]: 2.0,   // +100% market avg
    };
    
    return Math.min(marketAvg * multipliers[priorityLevel], customPriorityFee);
  },
}));

