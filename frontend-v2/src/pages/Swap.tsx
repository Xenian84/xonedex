import { useState, useEffect } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { SwapPanel } from '../components/Swap/SwapPanel';
import { XNT_TOKEN_INFO, NATIVE_XNT_MARKER } from '../config/x1-native';
import { getSwapPairCache, setSwapPairCache } from '../utils/swapCache';
import { useTokenStore } from '../store/useTokenStore';
import { useNetworkStore } from '../store/useNetworkStore';

export default function Swap() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const network = useNetworkStore((state) => state.network);
  const loadTokenLists = useTokenStore((state) => state.loadTokenLists);
  const tokenRegistry = useTokenStore((state) => state.tokenRegistry);

  // Load cached swap pair or use defaults
  const cachedPair = getSwapPairCache();
  const [inputMint, setInputMint] = useState<string>(
    cachedPair.inputMint || XNT_TOKEN_INFO.address
  );
  const [outputMint, setOutputMint] = useState<string>(
    cachedPair.outputMint || '' // Empty - user must select output token
  );

  // Load tokens immediately when connection is available
  useEffect(() => {
    if (!connection) return;
    
    // Load token lists immediately - XNT is already available, this loads others
    loadTokenLists(connection, network).catch((error) => {
      console.error('Failed to load token lists:', error);
    });
  }, [connection, network, loadTokenLists]);
  
  // Discover wallet tokens after token list loads (or immediately if wallet connected)
  useEffect(() => {
    if (!connection || !publicKey) return;
    
    // Check if wallet discovery is allowed for current network
    const networkConfig = useNetworkStore.getState().config;
    if (!networkConfig.allowWalletDiscovery) {
      console.log('⏭️ Wallet discovery disabled for', networkConfig.displayName);
      return;
    }
    
    // Small delay to ensure token list has loaded first
    const timer = setTimeout(() => {
      useTokenStore.getState().discoverWalletTokens(connection, publicKey);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [connection, publicKey, tokenRegistry.size]); // Re-run when registry changes

  // Load balances when wallet connects or changes
  useEffect(() => {
    if (publicKey && connection) {
      useTokenStore.getState().loadBalances(connection, publicKey);
    }
  }, [publicKey, connection]);

  // Save to cache when pair changes
  useEffect(() => {
    if (inputMint && outputMint) {
      setSwapPairCache({ inputMint, outputMint });
    }
  }, [inputMint, outputMint]);

  return (
    <div className="w-full flex items-start justify-center py-4 sm:py-8">
      <div className="w-full max-w-[480px] px-2 sm:px-4">
        <SwapPanel
          inputMint={inputMint}
          outputMint={outputMint}
          onInputMintChange={(mint) => {
            setInputMint(mint);
            setSwapPairCache({ inputMint: mint });
          }}
          onOutputMintChange={(mint) => {
            setOutputMint(mint);
            setSwapPairCache({ outputMint: mint });
          }}
          onDirectionNeedReverse={() => {
            // Optional: handle direction reverse if needed
          }}
        />
      </div>
    </div>
  );
}
