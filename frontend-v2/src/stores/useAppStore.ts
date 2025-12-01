import { create } from 'zustand';
import { Connection, PublicKey } from '@solana/web3.js';
import { defaultX1Endpoint, defaultX1Network, X1_EXPLORER_URLS, XNT_TOKEN_INFO } from '../config/x1';

interface AppState {
  connection: Connection;
  publicKey: PublicKey | null;
  connected: boolean;
  network: typeof defaultX1Network;
  explorerUrl: string;
  xntToken: typeof XNT_TOKEN_INFO;
  setPublicKey: (publicKey: PublicKey | null) => void;
  setNetwork: (network: typeof defaultX1Network) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connection: new Connection(defaultX1Endpoint, 'confirmed'),
  publicKey: null,
  connected: false,
  network: defaultX1Network,
  explorerUrl: X1_EXPLORER_URLS[defaultX1Network],
  xntToken: XNT_TOKEN_INFO,
  setPublicKey: (publicKey: PublicKey | null) => set({ publicKey, connected: !!publicKey }),
  setNetwork: (network: typeof defaultX1Network) => set({
    network,
    connection: new Connection(defaultX1Endpoint, 'confirmed'),
    explorerUrl: X1_EXPLORER_URLS[network],
  }),
}));
