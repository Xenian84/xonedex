import { useState, useEffect } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';

interface SlippageSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SlippageSettingsModal({ isOpen, onClose }: SlippageSettingsModalProps) {
  const { slippage, setSlippage } = useSettingsStore();
  const [currentSlippage, setCurrentSlippage] = useState((slippage * 100).toFixed(2));

  useEffect(() => {
    if (isOpen) {
      setCurrentSlippage((slippage * 100).toFixed(2));
    }
  }, [slippage, isOpen]);

  const handleSave = () => {
    const numericSlippage = parseFloat(currentSlippage) / 100;
    if (!isNaN(numericSlippage) && numericSlippage >= 0) {
      setSlippage(numericSlippage);
      onClose();
    }
  };

  const slippageNum = parseFloat(currentSlippage);
  const isHigh = slippageNum > 5;
  const isMedium = slippageNum > 1 && slippageNum <= 5;
  const isLow = slippageNum < 0.1;

  const getStatus = () => {
    if (isHigh) return { color: 'text-red-400', bg: 'bg-red-400/10', text: '⚠️ Very High - Risk of bad trades' };
    if (isMedium) return { color: 'text-yellow-400', bg: 'bg-yellow-400/10', text: '⚡ High - May accept worse prices' };
    if (isLow) return { color: 'text-orange-400', bg: 'bg-orange-400/10', text: '🐌 Low - Transactions may fail' };
    return { color: 'text-green-400', bg: 'bg-green-400/10', text: '✓ Optimal range' };
  };

  const status = getStatus();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal - Compact on mobile, scrollable */}
      <div className="relative bg-[#1a1f2e] border border-[#33415580] rounded-2xl max-w-md w-full shadow-2xl max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 md:p-6 border-b border-[#33415550]">
          <h3 className="text-lg sm:text-xl font-bold text-white">Slippage Tolerance</h3>
          <button
            onClick={onClose}
            className="text-[#8e92bc] hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4 md:space-y-5">
          {/* Description */}
          <p className="text-xs sm:text-sm text-[#8e92bc] leading-relaxed">
            Maximum price difference you'll accept between quote and execution. Lower is safer but may cause failures.
          </p>

          {/* Preset Buttons */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 0.1, label: '0.1%', desc: 'Strict' },
              { value: 0.5, label: '0.5%', desc: 'Normal' },
              { value: 1, label: '1%', desc: 'Relaxed' },
            ].map((preset) => (
              <button
                key={preset.value}
                onClick={() => setCurrentSlippage(preset.value.toString())}
                className={`flex flex-col items-center justify-center p-2.5 sm:p-3 md:p-4 rounded-lg border transition-all ${
                  parseFloat(currentSlippage) === preset.value
                    ? 'border-[#7BA8FF] bg-[#7BA8FF]/10'
                    : 'border-[#2a2f3f] bg-[#0d1117] hover:border-[#7BA8FF]/50'
                }`}
              >
                <div className="text-base sm:text-lg font-bold text-white mb-0.5 sm:mb-1">{preset.label}</div>
                <div className="text-[10px] sm:text-xs text-[#8e92bc]">{preset.desc}</div>
              </button>
            ))}
          </div>

          {/* Custom Input with Visual Slider */}
          <div className="space-y-2 sm:space-y-3">
            <label className="text-xs sm:text-sm font-medium text-white">Custom Slippage</label>
            
            {/* Input */}
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center bg-[#0d1117] rounded-lg px-3 sm:px-4 py-2 sm:py-3 border-2 border-[#2a2f3f] focus-within:border-[#7BA8FF]">
                <input
                  type="number"
                  value={currentSlippage}
                  onChange={(e) => setCurrentSlippage(e.target.value)}
                  placeholder="0.5"
                  step="0.1"
                  min="0"
                  max="50"
                  className="flex-1 bg-transparent text-white text-lg sm:text-xl font-bold outline-none"
                />
                <span className="text-[#8e92bc] text-base sm:text-lg font-medium ml-2">%</span>
              </div>
            </div>

            {/* Status Indicator */}
            <div className={`${status.bg} rounded-lg p-2 sm:p-3 flex items-center gap-2`}>
              <span className={`text-xs sm:text-sm font-medium ${status.color}`}>{status.text}</span>
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isNaN(slippageNum) || slippageNum < 0}
            className="w-full py-2.5 sm:py-3 rounded-xl font-bold bg-gradient-to-r from-[#7BA8FF] to-[#1A3CFF] text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
