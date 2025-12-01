import { FC, ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { DisclaimerModal } from '../DisclaimerModal';
import { NetworkSelectorModal } from '../Settings/NetworkSelectorModal';
import { useNetworkStore } from '../../store/useNetworkStore';
import { WalletButton } from './WalletButton';

interface LayoutProps {
  children: ReactNode;
}

export const Layout: FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected } = useWallet();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showNetworkSelector, setShowNetworkSelector] = useState(false);
  const config = useNetworkStore((state) => state.config);

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-[#0d0e14] text-white">
      {/* Disclaimer Modal - appears on first visit */}
      <DisclaimerModal />
      
      {/* Network Selector Modal */}
      <NetworkSelectorModal 
        isOpen={showNetworkSelector} 
        onClose={() => setShowNetworkSelector(false)} 
      />
      
      {/* Header */}
      <header className="border-b border-[#2c2d3a] bg-[#0d0e14]">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-3 md:py-4">
          <div className="flex items-center justify-between gap-1 sm:gap-3 md:gap-4">
            {/* Logo */}
            <Link to="/" className="flex items-center shrink-0">
              <img 
                src="/logo-header.svg" 
                alt="XoneDEX" 
                className="h-9 sm:h-10 md:h-11 w-auto"
              />
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-6">
              <Link
                to="/swap"
                className={`px-0 py-2 font-medium text-sm transition-colors ${
                  isActive('/swap') || isActive('/')
                    ? 'text-white border-b-2 border-[#5A8FFF]'
                    : 'text-[#8e92bc] hover:text-white'
                }`}
              >
                Swap
              </Link>
              <Link
                to="/liquidity"
                className={`px-0 py-2 font-medium text-sm transition-colors ${
                  isActive('/liquidity')
                    ? 'text-white border-b-2 border-[#5A8FFF]'
                    : 'text-[#8e92bc] hover:text-white'
                }`}
              >
                Liquidity
              </Link>
              <button className="px-0 py-2 text-[#8e92bc] hover:text-white font-medium text-sm transition-colors">
                Pools
              </button>
              <button className="px-0 py-2 text-[#8e92bc] hover:text-white font-medium text-sm transition-colors">
                Farms
              </button>
              <button className="px-0 py-2 text-[#8e92bc] hover:text-white font-medium text-sm transition-colors">
                Staking
              </button>
              <button className="px-0 py-2 text-[#8e92bc] hover:text-white font-medium text-sm transition-colors">
                Bridge
              </button>
            </nav>

            {/* Right Side - Network + Wallet + Settings */}
            <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
              {/* Network Selector - Next to wallet */}
              <button
                onClick={() => setShowNetworkSelector(true)}
                className="flex items-center gap-1 px-1.5 sm:px-2 md:px-3 py-1 sm:py-1.5 md:py-2 bg-[#1a1b23] hover:bg-[#2a2f3f] rounded-lg border border-[#2c2d3a] hover:border-[#7BA8FF]/50 transition-all cursor-pointer shrink-0 text-xs sm:text-sm"
                title="Switch Network"
              >
                <div className={`w-2 h-2 ${config.color} rounded-full animate-pulse`}></div>
                <span className="text-white font-medium">{config.displayName}</span>
                <svg className="w-3 h-3 text-[#8e92bc]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Wallet Button - Next to network */}
              <WalletButton />

              {/* Settings - Hide on small screens */}
              <button className="hidden md:block p-2 lg:p-2.5 hover:bg-[#1a1b23] rounded-xl transition-colors shrink-0">
                <svg className="w-4 h-4 lg:w-5 lg:h-5 text-[#8e92bc]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 001.066 1.066c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-1.066-1.066c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-1.066z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Add bottom padding on mobile for bottom nav */}
      <main className="container mx-auto px-4 py-8 pb-20 lg:pb-8">
        {children}
      </main>

      {/* Bottom Navigation Bar - Mobile Only */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#0d0e14] border-t border-[#2c2d3a] z-40 lg:hidden">
        <div className="grid grid-cols-5 h-16">
          {/* Swap */}
          <button
            onClick={() => navigate('/swap')}
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              isActive('/swap') || isActive('/') ? 'text-[#5A8FFF]' : 'text-[#5a5d7a] hover:text-[#8e92bc]'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            <span className="text-xs font-medium">Swap</span>
          </button>

          {/* Liquidity */}
          <button
            onClick={() => navigate('/liquidity')}
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              isActive('/liquidity') ? 'text-[#5A8FFF]' : 'text-[#5a5d7a] hover:text-[#8e92bc]'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs font-medium">Liquidity</span>
          </button>

          {/* Portfolio */}
          <button
            onClick={() => {/* Coming soon */}}
            className="flex flex-col items-center justify-center gap-1 text-[#5a5d7a] hover:text-[#8e92bc] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <span className="text-xs font-medium">Portfolio</span>
          </button>

          {/* Farms */}
          <button
            onClick={() => {/* Coming soon */}}
            className="flex flex-col items-center justify-center gap-1 text-[#5a5d7a] hover:text-[#8e92bc] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-medium">Farms</span>
          </button>

          {/* More */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex flex-col items-center justify-center gap-1 text-[#5a5d7a] hover:text-[#8e92bc] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <span className="text-xs font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Desktop Footer - Hidden on Mobile */}
      <footer className="hidden lg:block border-t border-[#2c2d3a] mt-12 py-4">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-[#5a5d7a] text-xs">
              <span>© 2025 XoneDEX.xyz</span>
              <span>•</span>
              <span>Powered by X1 Blockchain</span>
            </div>
            
            <div className="flex items-center gap-4">
              <a href="https://twitter.com/xonedex" target="_blank" rel="noopener noreferrer" className="text-[#8e92bc] hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
                </svg>
              </a>
              <a href="https://github.com/xonedex" target="_blank" rel="noopener noreferrer" className="text-[#8e92bc] hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              </a>
              <a href="https://discord.gg/xonedex" target="_blank" rel="noopener noreferrer" className="text-[#8e92bc] hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
