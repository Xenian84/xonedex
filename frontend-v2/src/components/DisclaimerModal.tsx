import { useState, useEffect } from 'react';

const DISCLAIMER_KEY = '_xonedex_have_agreed_disclaimer_';

export function DisclaimerModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [userHaveAgree, setUserHaveAgree] = useState(false);

  const confirmDisclaimer = () => {
    localStorage.setItem(DISCLAIMER_KEY, '1');
    setIsOpen(false);
  };

  useEffect(() => {
    const haveAgreedDisclaimer = localStorage.getItem(DISCLAIMER_KEY);
    if (!haveAgreedDisclaimer || haveAgreedDisclaimer !== '1') {
      setIsOpen(true);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" />
      
      {/* Modal */}
      <div className="relative bg-[#1a1f2e] border border-[#33415580] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-[#33415550]">
          <h2 className="text-2xl md:text-3xl font-bold text-white">
            ⚠️ Important Disclaimer
          </h2>
        </div>

        {/* Content */}
        <div className="p-6 md:p-8 overflow-y-auto max-h-[60vh]">
          <div className="bg-[#0d1117] rounded-lg p-4 md:p-6 space-y-4 text-sm md:text-base text-[#9ca3ff]">
            <p className="leading-relaxed">
              This website-hosted user interface (this "Interface") is an open source frontend software portal to the XoneDEX protocol, a 
              decentralized and community-driven collection of blockchain-enabled smart contracts and tools (the "XoneDEX Protocol"). This 
              Interface and the XoneDEX Protocol are made available by XoneDEX, however all transactions conducted on the protocol are run by 
              related permissionless smart contracts. As the Interface is open-sourced and the XoneDEX Protocol and its related smart contracts 
              are accessible by any user, entity or third party, there are a number of third party web and mobile user-interfaces that allow for 
              interaction with the XoneDEX Protocol.
            </p>

            <p className="leading-relaxed font-semibold text-[#ffa07a]">
              THIS INTERFACE AND THE XONEDEX PROTOCOL ARE PROVIDED "AS IS", AT YOUR OWN RISK, AND WITHOUT WARRANTIES OF ANY KIND. XoneDEX does 
              not provide, own, or control the XoneDEX Protocol or any transactions conducted on the protocol or via related smart contracts. By 
              using or accessing this Interface or the XoneDEX Protocol and related smart contracts, you agree that no developer or entity involved 
              in creating, deploying or maintaining this Interface or the XoneDEX Protocol will be liable for any claims or damages whatsoever 
              associated with your use, inability to use, or your interaction with other users of, this Interface or the XoneDEX Protocol, including 
              any direct, indirect, incidental, special, exemplary, punitive or consequential damages, or loss of profits, digital assets, tokens, 
              or anything else of value.
            </p>

            <p className="leading-relaxed">
              The XoneDEX Protocol is not available to residents of Belarus, the Central African Republic, The Democratic Republic of Congo, the 
              Democratic People's Republic of Korea, the Crimea, Donetsk People's Republic, and Luhansk People's Republic regions of Ukraine, Cuba, 
              Iran, Libya, Somalia, Sudan, South Sudan, Syria, the USA, Yemen, Zimbabwe and any other jurisdiction in which accessing or using the 
              XoneDEX Protocol is prohibited (the "Prohibited Jurisdictions").
            </p>

            <p className="leading-relaxed">
              By using or accessing this Interface, the XoneDEX Protocol, or related smart contracts, you represent that you are not located in, 
              incorporated or established in, or a citizen or resident of the Prohibited Jurisdictions. You also represent that you are not subject 
              to sanctions or otherwise designated on any list of prohibited or restricted parties or excluded or denied persons, including but not 
              limited to the lists maintained by the United States' Department of Treasury's Office of Foreign Assets Control, the United Nations 
              Security Council, the European Union or its Member States, or any other government authority.
            </p>
          </div>

          {/* Checkbox */}
          <div className="mt-6 flex items-start gap-3">
            <input
              type="checkbox"
              id="agree-terms"
              checked={userHaveAgree}
              onChange={(e) => setUserHaveAgree(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-2 border-[#334155] bg-[#0d1117] checked:bg-[#7BA8FF] checked:border-[#7BA8FF] focus:ring-2 focus:ring-[#7BA8FF] cursor-pointer transition-all"
            />
            <label htmlFor="agree-terms" className="text-white font-medium cursor-pointer select-none">
              I understand and agree to the terms and conditions
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 md:p-8 border-t border-[#33415550]">
          <button
            onClick={confirmDisclaimer}
            disabled={!userHaveAgree}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all
              ${userHaveAgree 
                ? 'bg-gradient-to-r from-[#7BA8FF] to-[#1A3CFF] text-white hover:opacity-90 hover:shadow-lg hover:shadow-[#7BA8FF]/30 cursor-pointer' 
                : 'bg-[#2a2f3f] text-[#5a5d7a] cursor-not-allowed'
              }`}
          >
            {userHaveAgree ? '🚀 Enter XoneDEX' : '⚠️ Please agree to the terms'}
          </button>
        </div>
      </div>
    </div>
  );
}

