import { useState, useEffect } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useNetworkStore } from '@/store/useNetworkStore';

interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSettingsModal({ isOpen, onClose }: GlobalSettingsModalProps) {
  const networkConfig = useNetworkStore((state) => state.config);
  
  const {
    useCustomExplorer,
    customExplorerUrl,
    useCustomRpc,
    customRpcUrl,
    setUseCustomExplorer,
    setCustomExplorerUrl,
    setUseCustomRpc,
    setCustomRpcUrl,
  } = useSettingsStore();

  const [localUseCustomExplorer, setLocalUseCustomExplorer] = useState(useCustomExplorer);
  const [localExplorerUrl, setLocalExplorerUrl] = useState(customExplorerUrl);
  const [localUseCustomRpc, setLocalUseCustomRpc] = useState(useCustomRpc);
  const [localRpcUrl, setLocalRpcUrl] = useState(customRpcUrl);

  useEffect(() => {
    if (isOpen) {
      setLocalUseCustomExplorer(useCustomExplorer);
      setLocalExplorerUrl(customExplorerUrl);
      setLocalUseCustomRpc(useCustomRpc);
      setLocalRpcUrl(customRpcUrl);
    }
  }, [isOpen, useCustomExplorer, customExplorerUrl, useCustomRpc, customRpcUrl]);

  const handleSave = () => {
    setUseCustomExplorer(localUseCustomExplorer);
    if (localUseCustomExplorer && localExplorerUrl) {
      setCustomExplorerUrl(localExplorerUrl);
    }
    setUseCustomRpc(localUseCustomRpc);
    if (localUseCustomRpc && localRpcUrl) {
      setCustomRpcUrl(localRpcUrl);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal - Compact on mobile, scrollable */}
      <div className="relative bg-[#1a1f2e] border border-[#33415580] rounded-2xl max-w-lg w-full shadow-2xl max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 md:p-6 border-b border-[#33415550]">
          <h3 className="text-lg sm:text-xl font-bold text-white">Global Settings</h3>
          <button
            onClick={onClose}
            className="text-[#8e92bc] hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-5 md:space-y-6">
          {/* Explorer URL */}
          <div className="space-y-2 sm:space-y-3">
            <h4 className="text-white font-semibold text-sm sm:text-base">Set Explorer URL</h4>
            
            <div className="flex gap-2 sm:gap-4">
              <button
                onClick={() => setLocalUseCustomExplorer(false)}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all text-xs sm:text-sm ${
                  !localUseCustomExplorer
                    ? 'bg-[#7BA8FF] text-white'
                    : 'bg-[#0d1117] text-[#8e92bc] hover:bg-[#2a2f3f]'
                }`}
              >
                <div className={`w-3.5 sm:w-4 h-3.5 sm:h-4 rounded-full border-2 flex items-center justify-center ${
                  !localUseCustomExplorer ? 'border-white' : 'border-[#8e92bc]'
                }`}>
                  {!localUseCustomExplorer && <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-white" />}
                </div>
                Default
              </button>
              
              <button
                onClick={() => setLocalUseCustomExplorer(true)}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all text-xs sm:text-sm ${
                  localUseCustomExplorer
                    ? 'bg-[#7BA8FF] text-white'
                    : 'bg-[#0d1117] text-[#8e92bc] hover:bg-[#2a2f3f]'
                }`}
              >
                <div className={`w-3.5 sm:w-4 h-3.5 sm:h-4 rounded-full border-2 flex items-center justify-center ${
                  localUseCustomExplorer ? 'border-white' : 'border-[#8e92bc]'
                }`}>
                  {localUseCustomExplorer && <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-white" />}
                </div>
                Custom URL
              </button>
            </div>

            {localUseCustomExplorer && (
              <input
                type="text"
                value={localExplorerUrl}
                onChange={(e) => setLocalExplorerUrl(e.target.value)}
                placeholder={networkConfig.explorerUrl}
                className="w-full bg-[#0d1117] text-white rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 border border-[#2a2f3f] focus:border-[#7BA8FF] outline-none text-xs sm:text-sm"
              />
            )}
          </div>

          <div className="border-t border-[#33415550]" />

          {/* RPC Endpoints */}
          <div className="space-y-2 sm:space-y-3">
            <h4 className="text-white font-semibold text-sm sm:text-base">RPC Endpoints</h4>
            
            <div className="flex gap-2 sm:gap-4">
              <button
                onClick={() => setLocalUseCustomRpc(false)}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all text-xs sm:text-sm ${
                  !localUseCustomRpc
                    ? 'bg-[#7BA8FF] text-white'
                    : 'bg-[#0d1117] text-[#8e92bc] hover:bg-[#2a2f3f]'
                }`}
              >
                <div className={`w-3.5 sm:w-4 h-3.5 sm:h-4 rounded-full border-2 flex items-center justify-center ${
                  !localUseCustomRpc ? 'border-white' : 'border-[#8e92bc]'
                }`}>
                  {!localUseCustomRpc && <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-white" />}
                </div>
                Default
              </button>
              
              <button
                onClick={() => setLocalUseCustomRpc(true)}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all text-xs sm:text-sm ${
                  localUseCustomRpc
                    ? 'bg-[#7BA8FF] text-white'
                    : 'bg-[#0d1117] text-[#8e92bc] hover:bg-[#2a2f3f]'
                }`}
              >
                <div className={`w-3.5 sm:w-4 h-3.5 sm:h-4 rounded-full border-2 flex items-center justify-center ${
                  localUseCustomRpc ? 'border-white' : 'border-[#8e92bc]'
                }`}>
                  {localUseCustomRpc && <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-white" />}
                </div>
                Custom URL
              </button>
            </div>

            {localUseCustomRpc && (
              <input
                type="text"
                value={localRpcUrl}
                onChange={(e) => setLocalRpcUrl(e.target.value)}
                placeholder={networkConfig.rpcUrl}
                className="w-full bg-[#0d1117] text-white rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 border border-[#2a2f3f] focus:border-[#7BA8FF] outline-none text-xs sm:text-sm"
              />
            )}
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            className="w-full py-2.5 sm:py-3 rounded-xl font-bold bg-gradient-to-r from-[#7BA8FF] to-[#1A3CFF] text-white hover:opacity-90 transition-all text-sm sm:text-base"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

