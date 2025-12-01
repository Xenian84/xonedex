import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEffect, useState } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import './WalletButton.css';

export function WalletButton() {
  const { publicKey, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [balance, setBalance] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (publicKey && connected) {
      let isCancelled = false;
      
      const fetchBalance = async (retryCount = 0) => {
        if (isCancelled) return;
        
        try {
          // Add a small delay to ensure connection is ready after network switch
          if (retryCount === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Check if connection is still valid
          if (!connection || isCancelled) return;
          
          const bal = await Promise.race([
            connection.getBalance(publicKey),
            new Promise<number>((_, reject) => 
              setTimeout(() => reject(new Error('Balance fetch timeout')), 10000)
            )
          ]);
          
          if (!isCancelled) {
            setBalance(bal / LAMPORTS_PER_SOL);
          }
        } catch (error: any) {
          if (isCancelled) return;
          
          // Retry up to 2 times for network errors
          if (retryCount < 2 && (
            error?.message?.includes('network') || 
            error?.message?.includes('fetch') ||
            error?.message?.includes('timeout') ||
            error?.name === 'NetworkError'
          )) {
            console.log(`🔄 Retrying balance fetch (attempt ${retryCount + 1}/2)...`);
            setTimeout(() => fetchBalance(retryCount + 1), 1000 * (retryCount + 1));
            return;
          }
          
          console.error('Error fetching balance:', error);
          // Don't set balance to null on error - keep last known balance
          // setBalance(null);
        }
      };

      fetchBalance();
      
      // Refresh balance every 10 seconds
      const interval = setInterval(() => fetchBalance(), 10000);
      return () => {
        isCancelled = true;
        clearInterval(interval);
      };
    } else {
      setBalance(null);
    }
  }, [publicKey, connected, connection]);


  const base58 = publicKey?.toBase58();
  const content = connected && base58
    ? `${base58.slice(0, 4)}..${base58.slice(-4)}`
    : 'Select Wallet';

  if (!connected) {
    return (
      <button 
        className="custom-wallet-button"
        onClick={() => setVisible(true)}
      >
        <span className="wallet-button-text">Select Wallet</span>
      </button>
    );
  }

  return (
    <div className="custom-wallet-wrapper">
      <button 
        className="custom-wallet-button connected"
        onClick={() => setDropdownOpen(!dropdownOpen)}
      >
        <div className="wallet-info">
          <span className="wallet-address">{content}</span>
          {balance !== null && (
            <span className="wallet-balance">{balance.toFixed(4)} XNT</span>
          )}
        </div>
      </button>
      
      {dropdownOpen && (
        <>
          <div 
            className="wallet-dropdown-backdrop" 
            onClick={() => setDropdownOpen(false)}
          />
          <div className="wallet-dropdown">
            <button 
              className="wallet-dropdown-item"
              onClick={() => {
                setVisible(true);
                setDropdownOpen(false);
              }}
            >
              Change Wallet
            </button>
            <button 
              className="wallet-dropdown-item disconnect"
              onClick={() => {
                disconnect();
                setDropdownOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

