import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';
import { useTokenStore } from '../../store/useTokenStore';
import { XNT_MINT, NATIVE_XNT_MARKER, isNativeXNT } from '../../config/x1-native';
import type { ParsedTokenInfo } from '../../services/token-list-service';
import { useNetworkStore } from '../../store/useNetworkStore';

interface TokenSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (token: TokenInfo) => void;
  excludeToken?: string;
}

interface TokenDisplayInfo {
  token: ParsedTokenInfo;
  balance: number;
  hasBalance: boolean;
  isVerified: boolean;
  verificationLevel: 'native' | 'official' | 'community' | 'wallet' | 'unknown';
}

export function TokenSelectModal({ isOpen, onClose, onSelect, excludeToken }: TokenSelectModalProps) {
  const [search, setSearch] = useState('');
  const [showAllWalletTokens, setShowAllWalletTokens] = useState(false);
  
  const getAllTokens = useTokenStore(s => s.getAllTokens);
  const getBalance = useTokenStore(s => s.getBalance);
  const isTokenVerified = useTokenStore(s => s.isTokenVerified);
  const getVerificationLevel = useTokenStore(s => s.getVerificationLevel);
  
  // Subscribe to store state changes to trigger re-renders when tokens load
  const tokenRegistry = useTokenStore(s => s.tokenRegistry);
  const walletTokens = useTokenStore(s => s.walletTokens);
  const loadingTokens = useTokenStore(s => s.loadingTokens);
  const _cacheVersion = useTokenStore(s => s._cacheVersion);

  // Wallet token discovery is handled at the page level (Swap/Liquidity)
  // No need to discover here to avoid state updates during render

  // Get all tokens - subscribe to store changes to trigger re-renders
  const allTokens = useMemo(() => {
    return getAllTokens();
  }, [getAllTokens, tokenRegistry.size, walletTokens.size, _cacheVersion]);

  // Create TokenDisplayInfo for each token (optimized)
  const tokenDisplayList = useMemo(() => {
    // Pre-compute verification levels and balances for faster access
    const balanceMap = new Map<string, number>();
    const verificationMap = new Map<string, boolean>();
    const levelMap = new Map<string, 'native' | 'official' | 'community' | 'wallet' | 'unknown'>();
    
    // Batch compute all values
    for (const token of allTokens) {
      const balance = getBalance(token.address);
      balanceMap.set(token.address, balance?.uiAmount || 0);
      verificationMap.set(token.address, isTokenVerified(token.address));
      levelMap.set(token.address, getVerificationLevel(token.address));
    }
    
    // Create display list with pre-computed values
    const displayList: TokenDisplayInfo[] = allTokens.map(token => {
      const balanceAmount = balanceMap.get(token.address) || 0;
      
      return {
        token,
        balance: balanceAmount,
        hasBalance: balanceAmount > 0,
        isVerified: verificationMap.get(token.address) || false,
        verificationLevel: levelMap.get(token.address) || 'unknown',
      };
    });

    // Optimized sort: use pre-computed values and avoid repeated comparisons
    return displayList.sort((a, b) => {
      // 1. XNT (native token) always first
      const aIsXNT = a.token.address === XNT_MINT;
      const bIsXNT = b.token.address === XNT_MINT;
      if (aIsXNT !== bIsXNT) {
        return aIsXNT ? -1 : 1;
      }
      
      // 2. Verified tokens come next
      if (a.isVerified !== b.isVerified) {
        return a.isVerified ? -1 : 1;
      }
      
      // 3. Among same verification status, tokens with balance come first
      if (a.hasBalance !== b.hasBalance) {
        return a.hasBalance ? -1 : 1;
      }
      
      // 4. Then by balance amount (only if both have balance)
      if (a.hasBalance && b.hasBalance && b.balance !== a.balance) {
        return b.balance - a.balance;
      }
      
      // 5. Finally alphabetically
      return a.token.symbol.localeCompare(b.token.symbol);
    });
  }, [allTokens, getBalance, isTokenVerified, getVerificationLevel]);

  // Filter tokens based on search
  const filteredTokens = useMemo(() => {
    let tokens = tokenDisplayList;
    
    // Exclude specified token
    if (excludeToken) {
      tokens = tokens.filter(t => t.token.address !== excludeToken);
    }
    
    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      tokens = tokens.filter(t => 
        t.token.symbol.toLowerCase().includes(searchLower) ||
        t.token.name.toLowerCase().includes(searchLower) ||
        t.token.address.toLowerCase().includes(searchLower)
      );
    }
    
    return tokens;
  }, [tokenDisplayList, search, excludeToken]);

  // Separate tokens into categories
  const walletTokensList = useMemo(() => 
    filteredTokens.filter(t => t.hasBalance),
    [filteredTokens]
  );
  
  // All tokens EXCLUDING wallet tokens (to avoid duplication)
  const allTokensList = useMemo(() => {
    if (search) {
      // When searching, show all filtered tokens
      return filteredTokens;
    }
    // When not searching, exclude tokens that are already in "Your Tokens"
    const walletTokenAddresses = new Set(walletTokensList.map(t => t.token.address));
    return filteredTokens.filter(t => !walletTokenAddresses.has(t.token.address));
  }, [filteredTokens, walletTokensList, search]);

  const handleSelect = (token: TokenInfo) => {
    onSelect(token);
    onClose();
    setSearch('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4"
         onClick={onClose}>
      <div className="bg-[#1a1b23] rounded-xl max-w-md w-full max-h-[90vh] sm:max-h-[80vh] flex flex-col border border-[#2c2d3a] shadow-xl"
           onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-[#2c2d3a]">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-lg sm:text-xl font-semibold text-white">Select Token</h2>
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 hover:bg-[rgba(255,255,255,0.1)] rounded-lg transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-[#8e92bc]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name, symbol, or address"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#0d0e14] border border-[#2c2d3a] rounded-lg px-3 sm:px-4 py-2 sm:py-3 pl-9 sm:pl-10 text-sm sm:text-base text-white placeholder-[#5a5d7a] outline-none focus:ring-2 focus:ring-[#5A8FFF] focus:ring-opacity-30 transition-all"
              autoFocus
            />
            <svg 
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#5a5d7a]"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto relative">
          {loadingTokens && allTokens.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-[#5A8FFF]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-sm text-[#8e92bc]">Loading tokens...</p>
              </div>
            </div>
          ) : filteredTokens.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-sm text-[#8e92bc] mb-2">No tokens found</p>
              <p className="text-xs text-[#5a5d7a]">Try searching with a different term</p>
            </div>
          ) : (
            <>
              {/* Your Tokens Section */}
              {!search && walletTokensList.length > 0 && (
                <div className="px-6 py-4 border-b border-[#2c2d3a]">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-medium text-[#5a5d7a] uppercase tracking-wide">
                      Your Tokens
                    </h3>
                    {walletTokensList.length > 6 && (
                      <button
                        onClick={() => setShowAllWalletTokens(!showAllWalletTokens)}
                        className="text-xs text-[#5A8FFF] hover:text-[#5A8FFF]/80"
                      >
                        {showAllWalletTokens ? 'Show Less' : `View All (${walletTokensList.length})`}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {(showAllWalletTokens ? walletTokensList : walletTokensList.slice(0, 6)).map(({ token, balance, verificationLevel }) => (
                      <TokenRow
                        key={token.address}
                        token={token}
                        balance={balance}
                        hasBalance={true}
                        verificationLevel={verificationLevel}
                        onClick={() => handleSelect(token)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* All Tokens List */}
              {allTokensList.length > 0 && (
                <div className="px-2 sm:px-4 py-2">
                  {!search && walletTokensList.length > 0 && (
                    <div className="flex items-center justify-between px-2 sm:px-3 py-2 text-xs text-[#5a5d7a] border-b border-[#2c2d3a] mb-2">
                      <span className="uppercase tracking-wide font-medium">All Tokens</span>
                      <span className="text-[#5a5d7a]">{allTokensList.length} tokens</span>
                    </div>
                  )}
                  
                  <div className="space-y-1">
                    {allTokensList.map(({ token, balance, hasBalance, verificationLevel }) => (
                      <TokenRow
                        key={token.address}
                        token={token}
                        balance={balance}
                        hasBalance={hasBalance}
                        verificationLevel={verificationLevel}
                        onClick={() => handleSelect(token)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Token Row Component
function TokenRow({ 
  token, 
  balance, 
  hasBalance, 
  verificationLevel,
  onClick 
}: { 
  token: ParsedTokenInfo; 
  balance: number; 
  hasBalance: boolean; 
  verificationLevel: 'native' | 'official' | 'community' | 'wallet' | 'unknown';
  onClick: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const networkConfig = useNetworkStore(state => state.config);
  
  // Calculate menu position when opened
  useEffect(() => {
    if (showMenu && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    } else {
      setMenuPosition(null);
    }
  }, [showMenu]);
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);
  
  // Get the actual address to display (use native mint for native XNT)
  const getDisplayAddress = () => {
    if (isNativeXNT(token.address)) {
      // Use the actual native mint address (Solana/X1 standard)
      return 'So11111111111111111111111111111111111111112';
    }
    return token.address;
  };
  
  const displayAddress = getDisplayAddress();
  
  const handleCopyAddress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(displayAddress);
      setShowMenu(false);
      // Show toast notification (you can add a toast library later)
      const toast = document.createElement('div');
      toast.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      toast.textContent = 'Address copied!';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };
  
  const handleViewExplorer = (e: React.MouseEvent) => {
    e.stopPropagation();
    // For native token, use the native mint address in explorer
    const explorerUrl = `${networkConfig.explorerUrl}/token/${displayAddress}`;
    window.open(explorerUrl, '_blank');
    setShowMenu(false);
  };
  const getBadge = () => {
    switch (verificationLevel) {
      case 'native':
        return (
          <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded" title="X1 Native Token">
            NATIVE
          </span>
        );
      case 'official':
      case 'community':
        return (
          <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <title>Verified token</title>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'wallet':
        return (
          <span className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded" title="Unverified token - Use with caution">
            ⚠ Unverified
          </span>
        );
      case 'unknown':
        return (
          <span className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded" title="Unknown token">
            ⚠ Unknown
          </span>
        );
    }
  };

  // Format large numbers with K, M, B suffixes
  const formatBalance = (num: number) => {
    if (num < 0.000001) {
      return num.toExponential(2);
    }
    
    // For very large numbers, use K/M/B notation on mobile
    if (num >= 1_000_000_000) {
      return (num / 1_000_000_000).toFixed(2) + 'B';
    }
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(2) + 'M';
    }
    if (num >= 10_000) {
      return (num / 1_000).toFixed(2) + 'K';
    }
    
    // For smaller numbers, show with appropriate decimals
    if (num >= 1) {
      return num.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
    }
    
    return num.toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 0 });
  };

  return (
    <div className="relative group" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={onClick}
        className="w-full flex items-center gap-2 sm:gap-3 p-2 sm:p-3 hover:bg-[rgba(255,255,255,0.1)] rounded-lg transition-colors"
      >
        {/* Token Icon */}
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#0d0e14] flex items-center justify-center text-[#8e92bc] font-semibold shrink-0 border border-[#2c2d3a] overflow-hidden text-xs sm:text-sm">
          {token.logoURI ? (
            <img 
              src={token.logoURI} 
              alt={token.symbol} 
              className="w-full h-full rounded-full object-cover"
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
                  img.parentElement!.innerText = token.symbol.substring(0, 2).toUpperCase();
                }
              }}
            />
          ) : (
            token.symbol.substring(0, 2).toUpperCase()
          )}
        </div>
        
        {/* Token Info - Flexible, can shrink */}
        <div className="text-left min-w-0 flex-1">
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="font-medium text-white truncate text-sm sm:text-base">{token.symbol}</span>
            <span className="shrink-0">{getBadge()}</span>
          </div>
          <div className="text-xs text-[#5a5d7a] truncate hidden sm:block">{token.name}</div>
          {!isNativeXNT(token.address) && (
            <div className="text-xs text-[#5a5d7a] truncate sm:hidden font-mono">
              {`${token.address.slice(0, 4)}...${token.address.slice(-4)}`}
            </div>
          )}
        </div>
        
        {/* Balance - Semi-fixed width, responsive */}
        <div className="text-right shrink-0 ml-2 flex items-center gap-2">
          {hasBalance && balance > 0.000001 ? (
            <div className="font-medium text-white text-xs sm:text-sm" title={balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}>
              {formatBalance(balance)}
            </div>
          ) : (
            <div className="text-xs text-[#5a5d7a]">—</div>
          )}
          
          {/* Menu Button - Only show for SPL tokens, not native */}
          {!isNativeXNT(token.address) && (
            <button
              ref={buttonRef}
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1.5 hover:bg-[rgba(255,255,255,0.1)] rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              aria-label="Token options"
              aria-expanded={showMenu}
            >
              <svg className="w-4 h-4 text-[#8e92bc]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          )}
        </div>
      </button>
      
      {/* Dropdown Menu - Rendered via Portal */}
      {showMenu && menuPosition && createPortal(
        <>
          {/* Backdrop to close menu */}
          <div 
            className="fixed inset-0 z-[100]"
            onClick={() => setShowMenu(false)}
          />
          {/* Menu positioned relative to viewport */}
          <div 
            ref={menuRef}
            className="fixed bg-[#1a1b23] border border-[#2c2d3a] rounded-lg shadow-xl z-[101] min-w-[200px] overflow-hidden"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
            }}
          >
            <button
              onClick={handleCopyAddress}
              className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[rgba(255,255,255,0.1)] flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>Copy Address</span>
            </button>
            <button
              onClick={handleViewExplorer}
              className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[rgba(255,255,255,0.1)] flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>View on Explorer</span>
            </button>
            <div className="px-4 py-2.5 border-t border-[#2c2d3a] bg-[#0d0e14]">
              <div className="text-xs text-[#5a5d7a] font-mono break-all leading-relaxed">
                {displayAddress}
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
