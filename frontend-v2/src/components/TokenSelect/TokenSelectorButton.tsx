import { useState } from 'react';
import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';
import { useTokenStore } from '../../store/useTokenStore';
import { TokenSelectModal } from './TokenSelectModal';

interface TokenSelectorButtonProps {
  mint: string;
  onSelect: (token: TokenInfo) => void;
  excludeToken?: string;
  label?: string;
  className?: string;
  showLabel?: boolean;
}

/**
 * Reusable Token Selector Button Component
 * 
 * Provides consistent token selection UI across Swap and Liquidity pages.
 * Can be used standalone or integrated into other components.
 */
export function TokenSelectorButton({
  mint,
  onSelect,
  excludeToken,
  label,
  className = '',
  showLabel = false,
}: TokenSelectorButtonProps) {
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const getTokenInfo = useTokenStore(s => s.getTokenInfo);
  
  const tokenInfo = getTokenInfo(mint);
  
  // Use actual token info or fallback
  const token = tokenInfo || {
    symbol: '???',
    name: 'Unknown Token',
    logoURI: '',
    decimals: 9,
    address: mint
  };

  const handleTokenSelect = (selectedToken: TokenInfo) => {
    onSelect(selectedToken);
    setIsSelectOpen(false);
  };

  const defaultClassName = `
    w-full bg-[#0d0e14] border border-[#2c2d3a] rounded-xl px-4 py-4 
    flex items-center justify-between hover:border-[#5A8FFF] transition-colors 
    min-h-[56px]
  `;

  return (
    <>
      {showLabel && label && (
        <label className="block text-sm font-medium text-[#8e92bc] mb-2">
          {label}
        </label>
      )}
      <button
        onClick={() => setIsSelectOpen(true)}
        className={className || defaultClassName}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {token && token.symbol !== '???' ? (
            <>
              {token.logoURI ? (
                <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-[#0d0e14] flex items-center justify-center text-white font-semibold text-sm">
                  <img 
                    src={token.logoURI} 
                    alt={token.symbol}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const img = e.currentTarget;
                      const currentSrc = img.src;
                      
                      // Try fallback IPFS gateways
                      if (currentSrc.includes('gateway.pinata.cloud')) {
                        const ipfsHash = currentSrc.split('/ipfs/')[1];
                        img.src = `https://ipfs.io/ipfs/${ipfsHash}`;
                        console.log('Trying ipfs.io gateway for', token.symbol);
                      } else if (currentSrc.includes('ipfs.io')) {
                        const ipfsHash = currentSrc.split('/ipfs/')[1];
                        img.src = `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`;
                        console.log('Trying cloudflare-ipfs gateway for', token.symbol);
                      } else {
                        // All gateways failed, show fallback text
                        console.error('All IPFS gateways failed for', token.symbol, token.logoURI);
                        img.style.display = 'none';
                        img.parentElement!.innerText = token.symbol.charAt(0);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="w-8 h-8 bg-[#5A8FFF] rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0">
                  {token.symbol.charAt(0)}
                </div>
              )}
              <span className="text-white font-medium truncate">{token.symbol}</span>
            </>
          ) : (
            <span className="text-[#5a5d7a]">Select token</span>
          )}
        </div>
        <svg 
          className="w-5 h-5 text-[#8e92bc] shrink-0 ml-2" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <TokenSelectModal
        isOpen={isSelectOpen}
        onClose={() => setIsSelectOpen(false)}
        onSelect={handleTokenSelect}
        excludeToken={excludeToken}
      />
    </>
  );
}

