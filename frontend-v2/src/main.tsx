import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletProvider } from './lib/WalletProvider';
import './index.css';
import App from './App';
import { Buffer } from 'buffer';

// Polyfill Buffer for browser (needed for Solana web3.js)
window.Buffer = Buffer;
(globalThis as any).Buffer = Buffer;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>,
);
