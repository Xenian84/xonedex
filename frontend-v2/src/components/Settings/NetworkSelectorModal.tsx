import { useNetworkStore, NetworkType, NETWORKS } from '@/store/useNetworkStore';

interface NetworkSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NetworkSelectorModal({ isOpen, onClose }: NetworkSelectorModalProps) {
  const network = useNetworkStore((state) => state.network);
  const setNetwork = useNetworkStore((state) => state.setNetwork);

  const handleNetworkChange = (newNetwork: NetworkType) => {
    if (newNetwork !== network) {
      setNetwork(newNetwork);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal */}
      <div className="relative bg-[#1a1f2e] border border-[#33415580] rounded-2xl max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#33415550]">
          <h3 className="text-xl font-bold text-white">Select Network</h3>
          <button
            onClick={onClose}
            className="text-[#8e92bc] hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-3">
          {/* Testnet Option */}
          <button
            onClick={() => handleNetworkChange('testnet')}
            className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
              network === 'testnet'
                ? 'border-green-500 bg-green-500/10'
                : 'border-[#2a2f3f] bg-[#0d1117] hover:border-green-500/50'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${NETWORKS.testnet.color} ${network === 'testnet' ? 'animate-pulse' : ''}`}></div>
              <div className="text-left">
                <div className="text-white font-semibold">X1 Testnet</div>
                <div className="text-xs text-[#8e92bc]">For testing and development</div>
              </div>
            </div>
            {network === 'testnet' && (
              <div className="text-green-500 text-xl">✓</div>
            )}
          </button>

          {/* Mainnet Option */}
          <button
            onClick={() => handleNetworkChange('mainnet')}
            className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
              network === 'mainnet'
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-[#2a2f3f] bg-[#0d1117] hover:border-blue-500/50'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${NETWORKS.mainnet.color} ${network === 'mainnet' ? 'animate-pulse' : ''}`}></div>
              <div className="text-left">
                <div className="text-white font-semibold">X1 Mainnet</div>
                <div className="text-xs text-[#8e92bc]">Production network</div>
              </div>
            </div>
            {network === 'mainnet' && (
              <div className="text-blue-500 text-xl">✓</div>
            )}
          </button>

          {/* Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mt-4">
            <p className="text-xs text-yellow-400">
              ⚠️ Switching networks will reload the page and disconnect your wallet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

