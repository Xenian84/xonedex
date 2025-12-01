import { useState, useEffect } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';

interface PriorityFeeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PriorityFeeModal({ isOpen, onClose }: PriorityFeeModalProps) {
  const {
    customPriorityFee,
    setCustomPriorityFee,
  } = useSettingsStore();

  const [localFee, setLocalFee] = useState(customPriorityFee.toString());

  useEffect(() => {
    if (isOpen) {
      setLocalFee(customPriorityFee.toString());
    }
  }, [customPriorityFee, isOpen]);

  const handleSave = () => {
    const numericFee = parseFloat(localFee);
    if (!isNaN(numericFee) && numericFee >= 0) {
      setCustomPriorityFee(numericFee);
    }
    onClose();
  };

  const presets = [
    { 
      label: 'None', 
      value: 0, 
      desc: 'Standard processing',
      icon: '🚶🏻',
      color: 'text-gray-400'
    },
    { 
      label: 'Low', 
      value: 0.0001, 
      desc: 'Slightly faster',
      icon: '🚶🏻‍♂️',
      color: 'text-blue-400'
    },
    { 
      label: 'Medium', 
      value: 0.0005, 
      desc: 'Recommended',
      icon: '🏃🏻',
      color: 'text-green-400'
    },
    { 
      label: 'High', 
      value: 0.001, 
      desc: 'Priority processing',
      icon: '🏃🏻‍♂️',
      color: 'text-yellow-400'
    },
    { 
      label: 'Ultra', 
      value: 0.005, 
      desc: 'Maximum speed',
      icon: '🏃🏻‍♂️💨',
      color: 'text-red-400'
    },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal - Compact on mobile, scrollable */}
      <div className="relative bg-[#1a1f2e] border border-[#33415580] rounded-2xl max-w-md w-full shadow-2xl max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 md:p-6 border-b border-[#33415550]">
          <h3 className="text-lg sm:text-xl font-bold text-white">⚡ Priority Fee</h3>
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
            Priority fees help validators process your transaction faster. Higher fees = faster confirmation.
          </p>

          {/* Preset Buttons - Responsive Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setLocalFee(preset.value.toString())}
                className={`flex flex-col items-center justify-center p-2 sm:p-3 md:p-4 rounded-lg border transition-all ${
                  parseFloat(localFee) === preset.value
                    ? 'border-[#7BA8FF] bg-[#7BA8FF]/10 text-white'
                    : 'border-[#2a2f3f] bg-[#0d1117] text-[#8e92bc] hover:border-[#7BA8FF]/50 hover:text-white'
                }`}
              >
                {/* Icon */}
                <div className={`text-2xl sm:text-2xl mb-0.5 sm:mb-1 ${parseFloat(localFee) === preset.value ? preset.color : ''}`}>
                  {preset.icon}
                </div>
                {/* Label */}
                <div className="text-xs sm:text-sm font-bold mb-0.5">{preset.label}</div>
                {/* Description */}
                <div className="text-[10px] sm:text-xs text-[#5a5d7a] text-center leading-tight">{preset.desc}</div>
              </button>
            ))}
          </div>

          {/* Custom Input */}
          <div className="space-y-1.5 sm:space-y-2">
            <label className="text-xs sm:text-sm text-[#8e92bc]">Custom Amount</label>
            <div className="flex items-center bg-[#0d1117] rounded-lg px-3 sm:px-4 py-2 sm:py-3 border border-[#2a2f3f] focus-within:border-[#7BA8FF]">
              <input
                type="number"
                value={localFee}
                onChange={(e) => setLocalFee(e.target.value)}
                placeholder="0.0005"
                step="0.0001"
                min="0"
                className="flex-1 bg-transparent text-white text-base sm:text-lg outline-none"
              />
              <span className="text-[#8e92bc] font-medium ml-2 text-sm sm:text-base">XNT</span>
            </div>
            {parseFloat(localFee) > 0 && (
              <p className="text-[10px] sm:text-xs text-[#5a5d7a]">
                ≈ ${(parseFloat(localFee) * 1).toFixed(6)} USD
              </p>
            )}
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            className="w-full py-2.5 sm:py-3 rounded-xl font-bold bg-gradient-to-r from-[#7BA8FF] to-[#1A3CFF] text-white hover:opacity-90 transition-all text-sm sm:text-base"
          >
            Save Priority Fee
          </button>
        </div>
      </div>
    </div>
  );
}
