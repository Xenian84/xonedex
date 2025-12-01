import { useState, useRef, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { XNT_TOKEN_INFO, isNativeXNT, WRAPPED_XNT_MINT_TESTNET } from '../config/x1-native';
import { buildAddLiquidityTransaction, buildRemoveLiquidityTransaction } from '../utils/v2AmmLiquidity';
import { buildUnifiedAddLiquidityTransaction, buildUnifiedRemoveLiquidityTransaction } from '../utils/unifiedLiquidity';
import { derivePoolState, derivePoolVaults } from '../utils/v2AmmPool';
import { fetchV2AmmPoolState } from '../utils/v2AmmPoolState';
import { getTokenAccountBalance } from '../utils/tokenAccount';
import BN from 'bn.js';
import { useTokenStore } from '../store/useTokenStore';
import { useNetworkStore } from '../store/useNetworkStore';
import { TokenSelectorButton } from '../components/TokenSelect/TokenSelectorButton';
import { RemoveLiquidityModal } from '../components/Liquidity/RemoveLiquidityModal';
import { PositionCard } from '../components/Liquidity/PositionCard';
import { Toast, ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { useSettingsStore } from '../store/useSettingsStore';
import type { TokenInfo } from '@raydium-io/raydium-sdk-v2';

export default function Liquidity() {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [step, setStep] = useState<1 | 2>(1);
  const [mint0, setMint0] = useState<string>(XNT_TOKEN_INFO.address);
  const [mint1, setMint1] = useState<string>('');
  const [amount0, setAmount0] = useState<string>('');
  const [amount1, setAmount1] = useState<string>('');
  const [lpAmount, setLpAmount] = useState<string>('');
  const [poolExists, setPoolExists] = useState<boolean>(false);
  const [poolInfo, setPoolInfo] = useState<any>(null);
  const [poolRatio, setPoolRatio] = useState<number | null>(null); // Reserve0/Reserve1 ratio
  const [isCalculating, setIsCalculating] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lpBalance, setLpBalance] = useState<number>(0); // User's LP token balance
  const [showPositions, setShowPositions] = useState<boolean>(true); // Show positions by default
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<{
    mint0: string;
    mint1: string;
    poolMint: string;
    poolState: string;
    token0Symbol: string;
    token1Symbol: string;
  } | null>(null);
  const { toasts, hideToast, showInfo, showSuccess, showError } = useToast();
  
  // Settings
  const slippageFromSettings = useSettingsStore(s => s.slippage);
  const getComputedPriorityFee = useSettingsStore(s => s.getComputedPriorityFee);
  
  const [userPositions, setUserPositions] = useState<Array<{
    mint0: string;
    mint1: string;
    lpBalance: number;
    poolMint: string;
    poolState: string;
    token0Symbol: string;
    token1Symbol: string;
  }>>([]); // All user's liquidity positions
  const [isDiscoveringPositions, setIsDiscoveringPositions] = useState(false);
  
  const getAllTokens = useTokenStore((state) => state.getAllTokens);
  const balances = useTokenStore((state) => state.balances);
  const network = useNetworkStore((state) => state.network);
  const getTokenInfo = useTokenStore((state) => state.getTokenInfo);
  const loadTokenLists = useTokenStore((state) => state.loadTokenLists);

  // Load tokens and balances when component mounts or wallet connects
  useEffect(() => {
    if (connection) {
      // Load token lists for current network
      loadTokenLists(connection, network);
    }
  }, [connection, network, loadTokenLists]);

  // Load balances when wallet connects or changes
  useEffect(() => {
    if (publicKey && connection) {
      useTokenStore.getState().loadBalances(connection, publicKey);
    }
  }, [publicKey, connection]);

  // Refresh balances when tokens are selected
  useEffect(() => {
    if (publicKey && connection && (mint0 || mint1)) {
      // Refresh balances when tokens change
      useTokenStore.getState().loadBalances(connection, publicKey);
    }
  }, [mint0, mint1, publicKey, connection]);

  useEffect(() => {
    if (mint0 && mint1) {
      checkPoolExists();
    }
  }, [mint0, mint1]);

  // Discover all user positions when wallet connects or positions view opens
  useEffect(() => {
    if (showPositions && publicKey && connection) {
      console.log('🔄 Auto-discovering positions (wallet connected)');
      discoverAllPositions();
    }
  }, [showPositions, publicKey, connection]);
  
  // Also discover positions on initial mount if wallet is already connected
  useEffect(() => {
    if (showPositions && publicKey && connection) {
      // Small delay to ensure wallet adapter is fully initialized
      const timer = setTimeout(() => {
        console.log('🔄 Auto-discovering positions (initial mount)');
        discoverAllPositions();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []); // Run once on mount

  /**
   * Discover all liquidity positions for the connected wallet
   * Checks LP tokens for common token pairs (XNT + other tokens)
   */
  async function discoverAllPositions() {
    if (!publicKey || !connection) return;
    
    setIsDiscoveringPositions(true);
    const positions: Array<{
      mint0: string;
      mint1: string;
      lpBalance: number;
      poolMint: string;
      poolState: string;
      token0Symbol: string;
      token1Symbol: string;
    }> = [];

    try {
      // Get all token accounts (both Token and Token 2022)
      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      
      const [standardAccounts, token2022Accounts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_PROGRAM_ID
        }),
        connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_2022_PROGRAM_ID
        })
      ]);
      
      const tokenAccounts = {
        value: [...standardAccounts.value, ...token2022Accounts.value]
      };

      console.log(`🔍 Discovering positions from ${tokenAccounts.value.length} token accounts...`);

      // Get all known tokens (excluding XNT)
      const allTokens = getAllTokens();
      const knownTokens = allTokens.filter(t => t.address !== XNT_TOKEN_INFO.address);
      
      // Check LP tokens for XNT pairs (most common)
      for (const account of tokenAccounts.value) {
        const lpMint = account.account.data.parsed.info.mint;
        const lpBalanceRaw = account.account.data.parsed.info.tokenAmount.amount;
        const lpBalanceUi = parseFloat(lpBalanceRaw) / 1e9;

        // Skip if balance is 0
        if (lpBalanceUi === 0) continue;

        // Try to match this LP mint against known token pairs
        // Check NATIVE XNT + other token pairs first (native pools)
        const { derivePoolState: deriveNativePoolState, deriveLpMint } = await import('../utils/nativePool');
        const { useNetworkStore } = await import('../store/useNetworkStore');
        
        // Get dynamic program ID from network store
        const networkConfig = useNetworkStore.getState().config;
        const programId = new PublicKey(networkConfig.ammProgramId);
        
        for (const token of knownTokens) {
          try {
            // Check for native pool
            const tokenMintPubkey = new PublicKey(token.address);
            const [nativePoolState] = deriveNativePoolState(tokenMintPubkey, programId);
            const [nativeLpMint] = deriveLpMint(nativePoolState, programId);

            if (nativeLpMint.toBase58() === lpMint) {
              // Verify native pool exists
              const poolStateInfo = await connection.getAccountInfo(nativePoolState);
              if (poolStateInfo) {
                positions.push({
                  mint0: XNT_TOKEN_INFO.address,
                  mint1: token.address,
                  lpBalance: lpBalanceUi,
                  poolMint: nativeLpMint.toBase58(),
                  poolState: nativePoolState.toBase58(),
                  token0Symbol: 'XNT',
                  token1Symbol: token.symbol,
                });
                console.log(`✅ Found NATIVE pool position: XNT/${token.symbol} - ${lpBalanceUi.toFixed(6)} LP`);
                break; // Found match, move to next LP token
              }
            }
          } catch (e) {
            // Continue checking
          }
          
          // Also check regular V2 AMM pools (wrapped XNT on testnet)
          // Skip this if XNT_TOKEN_INFO.address is NATIVE_XNT_MARKER (can't create PublicKey)
          try {
            // Use wrapped XNT mint for regular pools (testnet only)
            const WRAPPED_XNT_MINT = 'So11111111111111111111111111111111111111112';
            const mint0Pubkey = new PublicKey(WRAPPED_XNT_MINT);
            const mint1Pubkey = new PublicKey(token.address);
            const [poolState] = derivePoolState(mint0Pubkey, mint1Pubkey);
            const { poolMint } = derivePoolVaults(poolState);

            // If this LP mint matches a pool mint, we found a position!
            if (poolMint.toBase58() === lpMint) {
              // Verify pool exists
              const poolData = await fetchV2AmmPoolState(connection, poolState);
              if (poolData) {
                positions.push({
                  mint0: XNT_TOKEN_INFO.address,
                  mint1: token.address,
                  lpBalance: lpBalanceUi,
                  poolMint: poolMint.toBase58(),
                  poolState: poolState.toBase58(),
                  token0Symbol: 'XNT',
                  token1Symbol: token.symbol,
                });
                console.log(`✅ Found position: XNT/${token.symbol} - ${lpBalanceUi.toFixed(6)} LP`);
                break; // Found match, move to next LP token
              }
            }
          } catch (e) {
            // Continue checking other pairs
            continue;
          }
        }

        // Also check other token pairs (non-XNT pairs) - but limit to avoid too many checks
        // Only check if we haven't found a match yet
        if (positions.find(p => p.poolMint === lpMint)) continue;

        for (let i = 0; i < Math.min(knownTokens.length, 10); i++) {
          for (let j = i + 1; j < Math.min(knownTokens.length, 10); j++) {
            try {
              const mint0Pubkey = new PublicKey(knownTokens[i].address);
              const mint1Pubkey = new PublicKey(knownTokens[j].address);
              const [poolState] = derivePoolState(mint0Pubkey, mint1Pubkey);
              const { poolMint } = derivePoolVaults(poolState);

              if (poolMint.toBase58() === lpMint) {
                const poolData = await fetchV2AmmPoolState(connection, poolState);
                if (poolData) {
                  positions.push({
                    mint0: knownTokens[i].address,
                    mint1: knownTokens[j].address,
                    lpBalance: lpBalanceUi,
                    poolMint: poolMint.toBase58(),
                    poolState: poolState.toBase58(),
                    token0Symbol: knownTokens[i].symbol,
                    token1Symbol: knownTokens[j].symbol,
                  });
                  console.log(`✅ Found position: ${knownTokens[i].symbol}/${knownTokens[j].symbol} - ${lpBalanceUi.toFixed(6)} LP`);
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        }
      }

      setUserPositions(positions);
      console.log(`✅ Discovered ${positions.length} liquidity position(s)`);
    } catch (error) {
      console.error('❌ Error discovering positions:', error);
    } finally {
      setIsDiscoveringPositions(false);
    }
  }

  async function checkPoolExists() {
    if (!mint0 || !mint1) return;
    
    try {
      // For native XNT, use a placeholder for derivation (won't be used anyway)
      const isNative0 = mint0 === XNT_TOKEN_INFO.address;
      const isNative1 = mint1 === XNT_TOKEN_INFO.address;
      
      // Handle native XNT pools
      if (isNative0 || isNative1) {
        console.log('🔵 Native XNT pool detected - checking for native pool');
        const { derivePoolState: deriveNativePoolState, deriveLpMint } = await import('../utils/nativePool');
        const { useNetworkStore } = await import('../store/useNetworkStore');
        
        // Get dynamic program ID from network store
        const networkConfig = useNetworkStore.getState().config;
        const programId = new PublicKey(networkConfig.ammProgramId);
        
        // Get the SPL token mint (not the native XNT marker)
        const tokenMint = isNative0 ? mint1 : mint0;
        const tokenMintPubkey = new PublicKey(tokenMint);
        
        // Derive native pool addresses
        const [nativePoolState] = deriveNativePoolState(tokenMintPubkey, programId);
        const [nativeLpMint] = deriveLpMint(nativePoolState, programId);
        
        console.log('🔍 Checking native pool:', {
          poolState: nativePoolState.toString(),
          lpMint: nativeLpMint.toString(),
        });
        
        // Check if native pool exists
        const poolStateInfo = await connection.getAccountInfo(nativePoolState);
        const exists = !!poolStateInfo;
        console.log('📊 Native pool exists:', exists);
        setPoolExists(exists);
        
        if (exists && publicKey) {
          // Fetch user's LP token balance for native pool
          try {
            const userPoolAta = await getAssociatedTokenAddress(nativeLpMint, publicKey);
            const lpBalanceBigInt = await getTokenAccountBalance(connection, userPoolAta);
            const lpBalanceUi = Number(lpBalanceBigInt) / 1e9;
            console.log('✅ Native pool LP Balance:', lpBalanceUi, 'LP tokens');
            setLpBalance(lpBalanceUi);
          } catch (e) {
            console.log('⚠️ No LP balance for native pool (account may not exist)');
            setLpBalance(0);
          }
        }
        
        return;
      }
      
      const mint0Pubkey = new PublicKey(mint0);
      const mint1Pubkey = new PublicKey(mint1);
      const [poolState] = derivePoolState(mint0Pubkey, mint1Pubkey);
      
      console.log('🔍 Checking if pool exists:', poolState.toBase58());
      const poolStateData = await fetchV2AmmPoolState(connection, poolState);
      const exists = !!poolStateData;
      console.log('📊 Pool exists:', exists);
      setPoolExists(exists);
      
      if (poolStateData) {
        const { vault0, vault1, poolMint } = derivePoolVaults(poolState);
        console.log('📍 Pool details:', {
          poolState: poolState.toBase58(),
          poolMint: poolMint.toBase58(),
          vault0: vault0.toBase58(),
          vault1: vault1.toBase58(),
        });
        
        // Fetch vault balances to calculate ratio - works with both Token and Token2022
        const [vault0BalanceBigInt, vault1BalanceBigInt] = await Promise.all([
          getTokenAccountBalance(connection, vault0),
          getTokenAccountBalance(connection, vault1)
        ]);
        
        const reserve0 = Number(vault0BalanceBigInt) / 1e9;
        const reserve1 = Number(vault1BalanceBigInt) / 1e9;
        
        const ratio = reserve0 > 0 && reserve1 > 0 ? reserve0 / reserve1 : null;
        setPoolRatio(ratio);
        
        setPoolInfo({
          poolState,
          vault0,
          vault1,
          poolMint,
          reserve0,
          reserve1,
          ...poolStateData,
        });

        // Fetch user's LP token balance
        if (publicKey) {
          try {
            console.log('🔍 Fetching LP balance for pool:', poolMint.toBase58());
            const userPoolAta = await getAssociatedTokenAddress(poolMint, publicKey);
            console.log('📍 User LP ATA:', userPoolAta.toBase58());
            const lpBalanceBigInt = await getTokenAccountBalance(connection, userPoolAta);
            const lpBalanceUi = Number(lpBalanceBigInt) / 1e9;
            console.log('✅ LP Balance found:', lpBalanceBigInt.toString(), 'raw =', lpBalanceUi, 'LP tokens');
            setLpBalance(lpBalanceUi);
          } catch (e: any) {
            console.error('❌ Error fetching LP balance:', e);
            console.error('Error details:', e.message || e.toString());
            // LP account doesn't exist or has no balance
            setLpBalance(0);
          }
        } else {
          console.log('⚠️ No publicKey, cannot fetch LP balance');
          setLpBalance(0);
        }
      } else {
        console.log('⚠️ Pool does not exist');
        setPoolInfo(null);
        setPoolRatio(null);
        setLpBalance(0);
      }
    } catch (e: any) {
      console.error('❌ Error checking pool:', e);
      console.error('Error details:', e.message || e.toString());
      setPoolExists(false);
      setPoolInfo(null);
      setLpBalance(0);
    }
  }

  async function handleAddLiquidity() {
    if (!publicKey || !mint0 || !mint1 || !amount0 || !amount1) {
      showError('Missing Information', 'Please fill in all fields');
      return;
    }

    setIsLoading(true);
    showInfo('Building Transaction', 'Preparing your liquidity transaction...');

    try {
      if (!signTransaction || !sendTransaction) {
        throw new Error('Wallet not connected');
      }

      // Refresh balances before validation to ensure we have latest data
      await useTokenStore.getState().loadBalances(connection, publicKey);

      // NOTE: Don't create PublicKeys here - let unified builder handle native XNT marker
      // const mint0Pubkey = new PublicKey(mint0);  // Would fail for NATIVE_XNT_MARKER!
      // const mint1Pubkey = new PublicKey(mint1);
      
      // Get token decimals
      const allTokens = getAllTokens();
      const token0 = allTokens.find((t: any) => t.address === mint0);
      const token1 = allTokens.find((t: any) => t.address === mint1);
      const decimals0 = token0?.decimals || 9;
      const decimals1 = token1?.decimals || 9;
      
      // Convert amounts to BN (accounting for decimals)
      // Ensure amounts are valid positive numbers
      const numAmount0 = parseFloat(amount0);
      const numAmount1 = parseFloat(amount1);
      
      console.log('Amount inputs:', { amount0, amount1, numAmount0, numAmount1 });
      console.log('Decimals:', { decimals0, decimals1 });
      
      if (isNaN(numAmount0) || numAmount0 <= 0) {
        throw new Error('Invalid amount for token 0');
      }
      if (isNaN(numAmount1) || numAmount1 <= 0) {
        throw new Error('Invalid amount for token 1');
      }
      
      // Convert to BN safely using string multiplication to avoid precision loss
      // Split the number into integer and decimal parts
      const [int0, dec0 = ''] = amount0.split('.');
      const [int1, dec1 = ''] = amount1.split('.');
      
      // Pad or trim decimal part to match token decimals
      const paddedDec0 = (dec0 + '0'.repeat(decimals0)).slice(0, decimals0);
      const paddedDec1 = (dec1 + '0'.repeat(decimals1)).slice(0, decimals1);
      
      // Combine integer and decimal parts as a string (raw amount)
      const rawAmount0Str = int0 + paddedDec0;
      const rawAmount1Str = int1 + paddedDec1;
      
      console.log('Raw amounts (string):', { rawAmount0Str, rawAmount1Str });
      
      // Create BN from string (no precision loss)
      const amount0BN = new BN(rawAmount0Str);
      const amount1BN = new BN(rawAmount1Str);
      
      // Validate BN values are positive
      if (amount0BN.lte(new BN(0)) || amount1BN.lte(new BN(0))) {
        throw new Error('Amounts must be greater than zero');
      }

      // Validate balances BEFORE building transaction
      const balance0 = balances.get?.(mint0)?.uiAmount || 0;
      const balance1 = balances.get?.(mint1)?.uiAmount || 0;
      
      // For XNT (native), check both native and wrapped balance
      const NATIVE_MINT = WRAPPED_XNT_MINT_TESTNET; // Legacy wrapped XNT for testnet
      let availableBalance0 = balance0;
      if (mint0 === NATIVE_MINT) {
        const wrappedBalance = useTokenStore.getState().getWrappedXNTBalance();
        availableBalance0 = balance0 + wrappedBalance;
      }
      
      let availableBalance1 = balance1;
      if (mint1 === NATIVE_MINT) {
        const wrappedBalance = useTokenStore.getState().getWrappedXNTBalance();
        availableBalance1 = balance1 + wrappedBalance;
      }

      if (numAmount0 > availableBalance0) {
        throw new Error(`Insufficient ${token0?.symbol || 'token 0'} balance. You have ${availableBalance0.toFixed(4)}, but trying to deposit ${numAmount0.toFixed(4)}.`);
      }
      
      if (numAmount1 > availableBalance1) {
        throw new Error(`Insufficient ${token1?.symbol || 'token 1'} balance. You have ${availableBalance1.toFixed(4)}, but trying to deposit ${numAmount1.toFixed(4)}.`);
      }
      
      // Get priority fee in lamports
      const priorityFeeXNT = getComputedPriorityFee();
      const priorityFeeInLamports = Math.floor(priorityFeeXNT * 1e9);

      // Pass mint strings directly (unified builder handles native XNT marker)
      const transaction = await buildUnifiedAddLiquidityTransaction(
        connection,
        publicKey,
        mint0,  // Pass string! Unified builder converts if needed
        mint1,  // Pass string! Unified builder converts if needed
        amount0BN,
        amount1BN,
        slippageFromSettings * 10000 // Convert to basis points
      );
      
      if (!transaction) {
        throw new Error('Failed to build transaction');
      }
      
      // TODO: Add priority fee support for native pools
      if (priorityFeeInLamports > 0) {
        console.log('Priority fee support for native pools coming soon');
      }

      // Sign and send transaction (using same pattern as swap)
      console.log('📝 Transaction built, requesting wallet signature...');
      console.log('Transaction instructions:', transaction.instructions.length);
      
      // Sign transaction
      const signedTx = await signTransaction(transaction);
      console.log('✅ Transaction signed successfully');

      // Send transaction using sendRawTransaction (same as swap)
      const rawTransaction = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
      });
      console.log('✅ Transaction sent:', signature);
      const explorerUrl = useNetworkStore.getState().config.explorerUrl;
      console.log('Explorer:', `${explorerUrl}/tx/${signature}`);

      // Wait for confirmation (same pattern as swap)
      try {
        await connection.confirmTransaction(signature, 'confirmed');
      } catch (confirmError: any) {
        // Handle timeout errors gracefully - transaction may still succeed
        const errorMessage = confirmError?.message || confirmError?.toString() || '';
        const isTimeout = errorMessage.includes('Transaction was not confirmed') ||
                         errorMessage.includes('TransactionExpiredTimeoutError') ||
                         confirmError?.name === 'TransactionExpiredTimeoutError';
        
        if (isTimeout) {
          console.log('⏱️ Confirmation timeout - transaction may still be processing');
          const explorerUrl = useNetworkStore.getState().config.explorerUrl;
          console.log('⏱️ Check explorer:', `${explorerUrl}/tx/${signature}`);
          // Don't throw - transaction may still succeed
        } else {
          throw confirmError;
        }
      }
      
      showSuccess(
        'Liquidity Added!',
        `Successfully added liquidity to ${token0?.symbol || 'Token0'}/${token1?.symbol || 'Token1'} pool`,
        signature
      );
      setAmount0('');
      setAmount1('');
      setStep(1);
      setShowPositions(true); // Switch to positions view after adding
      
      // Refresh balances and pool info
      setTimeout(async () => {
        await checkPoolExists();
        await useTokenStore.getState().loadBalances(connection, publicKey);
        // Refresh LP balance
        if (poolExists && poolInfo?.poolMint && publicKey) {
          try {
            const userPoolAta = await getAssociatedTokenAddress(poolInfo.poolMint, publicKey);
            const lpBalanceBigInt = await getTokenAccountBalance(connection, userPoolAta);
            setLpBalance(Number(lpBalanceBigInt) / 1e9);
          } catch (e) {
            setLpBalance(0);
          }
        }
      }, 2000);
    } catch (e: any) {
      console.error('Error adding liquidity:', e);
      
      // Better error messages
      let errorMessage = 'Failed to add liquidity';
      const errorStr = e.toString().toLowerCase();
      const errorMsg = e.message?.toLowerCase() || '';
      
      if (errorStr.includes('plugin closed') || errorMsg.includes('plugin closed') || errorStr.includes('user rejected') || errorMsg.includes('user rejected')) {
        errorMessage = 'Transaction was cancelled or rejected. Please approve the transaction in your wallet.';
      } else if (errorStr.includes('insufficient') || errorMsg.includes('insufficient')) {
        errorMessage = 'Insufficient balance. Please check your wallet balances.';
      } else if (errorStr.includes('simulation') || errorMsg.includes('simulation')) {
        errorMessage = 'Transaction simulation failed. Please check your balances and try again.';
      } else if (errorStr.includes('32002') || errorMsg.includes('32002')) {
        errorMessage = 'Transaction simulation failed. This usually means insufficient balance or invalid account state. Please check your balances.';
      } else if (e.message) {
        errorMessage = e.message;
      }
      
      showError('Transaction Failed', errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRemoveLiquidity() {
    if (!publicKey || !mint0 || !mint1 || !lpAmount) {
      showError('Missing Information', 'Please fill in LP amount');
      return;
    }

    setIsLoading(true);
    showInfo('Building Transaction', 'Preparing to remove liquidity...');

    try {
      if (!signTransaction || !sendTransaction) {
        throw new Error('Wallet not connected');
      }

      // Pass strings directly to unified builder (handles native XNT marker)
      // NOTE: Don't create PublicKeys from mint strings - would fail for NATIVE_XNT_MARKER!
      
      // LP tokens have 9 decimals - convert safely using string
      const [intLp, decLp = ''] = lpAmount.split('.');
      const paddedDecLp = (decLp + '0'.repeat(9)).slice(0, 9);
      const rawLpAmountStr = intLp + paddedDecLp;
      const lpAmountBN = new BN(rawLpAmountStr);
      
      // Get priority fee in lamports
      const priorityFeeXNT = getComputedPriorityFee();
      const priorityFeeInLamports = Math.floor(priorityFeeXNT * 1e9);

      const transaction = await buildUnifiedRemoveLiquidityTransaction(
        connection,
        publicKey,
        mint0,  // Pass string!
        mint1,  // Pass string!
        lpAmountBN,
        slippageFromSettings * 10000 // Convert to basis points
      );
      
      if (!transaction) {
        throw new Error('Failed to build transaction');
      }
      
      // TODO: Add priority fee support for native pools
      if (priorityFeeInLamports > 0) {
        console.log('Priority fee support for native pools coming soon');
      }

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction using sendRawTransaction (same as swap)
      const rawTransaction = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      // Wait for confirmation
      try {
        await connection.confirmTransaction(signature, 'confirmed');
      } catch (confirmError: any) {
        // Handle timeout errors gracefully
        const errorMessage = confirmError?.message || confirmError?.toString() || '';
        const isTimeout = errorMessage.includes('Transaction was not confirmed') ||
                         errorMessage.includes('TransactionExpiredTimeoutError') ||
                         confirmError?.name === 'TransactionExpiredTimeoutError';
        
        if (isTimeout) {
          console.log('⏱️ Confirmation timeout - transaction may still be processing');
          const explorerUrl = useNetworkStore.getState().config.explorerUrl;
          console.log('⏱️ Check explorer:', `${explorerUrl}/tx/${signature}`);
        } else {
          throw confirmError;
        }
      }
      
      const token0 = getAllTokens().find((t: any) => t.address === mint0);
      const token1 = getAllTokens().find((t: any) => t.address === mint1);
      showSuccess(
        'Liquidity Removed!',
        `Successfully removed liquidity from ${token0?.symbol || 'Token0'}/${token1?.symbol || 'Token1'} pool`,
        signature
      );
      setLpAmount('');
      
      // Refresh balances and pool info
      setTimeout(async () => {
        await checkPoolExists();
        await useTokenStore.getState().loadBalances(connection, publicKey);
        // Refresh LP balance
        if (poolExists && poolInfo?.poolMint && publicKey) {
          try {
            const userPoolAta = await getAssociatedTokenAddress(poolInfo.poolMint, publicKey);
            const lpBalanceBigInt = await getTokenAccountBalance(connection, userPoolAta);
            setLpBalance(Number(lpBalanceBigInt) / 1e9);
          } catch (e) {
            setLpBalance(0);
          }
        }
      }, 2000);
    } catch (e: any) {
      console.error('Error removing liquidity:', e);
      showError('Transaction Failed', e.message || 'Failed to remove liquidity');
    } finally {
      setIsLoading(false);
    }
  }

  // Get all tokens and find selected tokens
  const allTokens = getAllTokens();
  const token0 = allTokens.find((t: any) => t.address === mint0);
  const token1 = allTokens.find((t: any) => t.address === mint1);
  
  // Calculate balances (including wrapped XNT for native token)
  const NATIVE_MINT = WRAPPED_XNT_MINT_TESTNET; // Legacy wrapped XNT for testnet
  let balance0 = balances.get?.(mint0)?.uiAmount || 0;
  if (mint0 === NATIVE_MINT || mint0 === XNT_TOKEN_INFO.address) {
    const wrappedBalance = useTokenStore.getState().getWrappedXNTBalance();
    balance0 = balance0 + wrappedBalance;
  }
  
  let balance1 = mint1 ? (balances.get?.(mint1)?.uiAmount || 0) : 0;
  if (mint1 === NATIVE_MINT) {
    const wrappedBalance = useTokenStore.getState().getWrappedXNTBalance();
    balance1 = balance1 + wrappedBalance;
  }

  // Track which input was last edited to prevent circular updates
  const lastEditedRef = useRef<'amount0' | 'amount1' | null>(null);

  // Calculate amount1 based on amount0 and pool ratio (for existing pools)
  useEffect(() => {
    if (poolExists && poolRatio !== null && amount0 && !isCalculating && lastEditedRef.current !== 'amount1') {
      const numAmount0 = parseFloat(amount0);
      if (!isNaN(numAmount0) && numAmount0 > 0) {
        setIsCalculating(true);
        const calculatedAmount1 = numAmount0 / poolRatio;
        if (!isNaN(calculatedAmount1) && calculatedAmount1 >= 0) {
          const formattedAmount1 = calculatedAmount1.toFixed(9);
          // Only update if the value actually changed to prevent loops
          if (amount1 !== formattedAmount1) {
            setAmount1(formattedAmount1);
          }
        }
        setTimeout(() => setIsCalculating(false), 50);
      }
    }
  }, [amount0, poolExists, poolRatio, isCalculating]);

  // Calculate amount0 based on amount1 and pool ratio (for existing pools)
  useEffect(() => {
    if (poolExists && poolRatio !== null && amount1 && !isCalculating && lastEditedRef.current !== 'amount0') {
      const numAmount1 = parseFloat(amount1);
      if (!isNaN(numAmount1) && numAmount1 > 0) {
        setIsCalculating(true);
        const calculatedAmount0 = numAmount1 * poolRatio;
        if (!isNaN(calculatedAmount0) && calculatedAmount0 >= 0) {
          const formattedAmount0 = calculatedAmount0.toFixed(9);
          // Only update if the value actually changed to prevent loops
          if (amount0 !== formattedAmount0) {
            setAmount0(formattedAmount0);
          }
        }
        setTimeout(() => setIsCalculating(false), 50);
      }
    }
  }, [amount1, poolExists, poolRatio, isCalculating]);

  const handleTokenSelect0 = async (token: TokenInfo) => {
    setMint0(token.address);
    if (token.address === mint1) {
      setMint1('');
    }
    // Refresh balances when token is selected
    if (publicKey && connection) {
      await useTokenStore.getState().loadBalances(connection, publicKey);
    }
  };

  const handleTokenSelect1 = async (token: TokenInfo) => {
    setMint1(token.address);
    if (token.address === mint0) {
      setMint0(XNT_TOKEN_INFO.address);
    }
    // Refresh balances when token is selected
    if (publicKey && connection) {
      await useTokenStore.getState().loadBalances(connection, publicKey);
    }
  };

  const canContinue = mint0 && mint1 && !poolExists;

  return (
    <div className="w-full h-full min-h-screen">
      <div className="container mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Breadcrumbs */}
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs sm:text-sm text-[#5a5d7a]">
              {showPositions ? (
                <span>Your positions</span>
              ) : (
                <>
                  Your positions <span className="mx-2">/</span> New position
                </>
              )}
            </div>
            {!showPositions && (
              <button
                onClick={() => setShowPositions(true)}
                className="text-xs sm:text-sm text-[#5A8FFF] hover:text-[#5A8FFF]-hover font-medium active:scale-95 transition-transform"
              >
                View Your Positions →
              </button>
            )}
            {showPositions && (
              <button
                onClick={() => setShowPositions(false)}
                className="text-xs sm:text-sm text-[#5A8FFF] hover:text-[#5A8FFF]-hover font-medium active:scale-95 transition-transform"
              >
                ← Back to Add Liquidity
              </button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white">
              {showPositions ? 'Your Positions' : 'New position'}
            </h1>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 max-w-7xl mx-auto">
          {/* Left Sidebar - Steps (Only show when adding liquidity) */}
          {!showPositions && (
            <div className="lg:w-64 flex-shrink-0">
              <div className="bg-[#1a1b23] rounded-xl p-6 border border-[#2c2d3a]">
                <div className="space-y-6">
                {/* Step 1 */}
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${
                    step === 1 ? 'bg-[#5A8FFF] text-white' : 'bg-[#0d0e14] text-[#5a5d7a]'
                  }`}>
                    1
                  </div>
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${step === 1 ? 'text-white' : 'text-[#5a5d7a]'}`}>
                      Step 1
                    </div>
                    <div className={`text-sm mt-1 ${step === 1 ? 'text-[#8e92bc]' : 'text-[#5a5d7a]'}`}>
                      Select token pair and fees
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${
                    step === 2 ? 'bg-[#5A8FFF] text-white' : 'bg-[#0d0e14] text-[#5a5d7a]'
                  }`}>
                    2
                  </div>
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${step === 2 ? 'text-white' : 'text-[#5a5d7a]'}`}>
                      Step 2
                    </div>
                    <div className={`text-sm mt-1 ${step === 2 ? 'text-[#8e92bc]' : 'text-[#5a5d7a]'}`}>
                      Set deposit amounts
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          )}

          {/* Main Content */}
          <div className="flex-1">
            {/* Your Positions View */}
            {showPositions && (
              <div className="bg-[#1a1b23] rounded-xl p-4 sm:p-6 md:p-8 border border-[#2c2d3a]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4">
                  <h2 className="text-lg sm:text-xl font-semibold text-white">Your Liquidity Positions</h2>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setShowPositions(false);
                        setStep(1);
                      }}
                      className="px-4 py-2 bg-[#5A8FFF] text-white rounded-xl font-semibold hover:opacity-90 transition-opacity flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      New Position
                    </button>
                    <button
                      onClick={discoverAllPositions}
                      disabled={isDiscoveringPositions}
                      className="text-sm text-[#5A8FFF] hover:text-[#5A8FFF]-hover font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isDiscoveringPositions ? (
                        <>
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Refreshing...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Refresh
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-[#8e92bc] mb-6">
                  {userPositions.length > 0 
                    ? `Found ${userPositions.length} liquidity position${userPositions.length > 1 ? 's' : ''}. Click "Manage Position" to view details.`
                    : 'Your liquidity positions will appear here automatically.'}
                </p>
                
                {/* Loading state */}
                {isDiscoveringPositions && (
                  <div className="mb-6 p-4 bg-[#1a1b23] border border-[#22D1F8] rounded-xl">
                    <div className="text-sm text-[#22D1F8] flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Discovering your liquidity positions...
                    </div>
                  </div>
                )}

                {/* Show all discovered positions */}
                {!isDiscoveringPositions && userPositions.length > 0 && (
                  <div className="space-y-4 mb-6">
                    {userPositions.map((position, index) => {
                      const token0Info = getTokenInfo(position.mint0);
                      const token1Info = getTokenInfo(position.mint1);
                      return (
                        <PositionCard 
                          key={index}
                          index={index}
                          position={position}
                          token0Info={token0Info}
                          token1Info={token1Info}
                          onAddMore={() => {
                            setMint0(position.mint0);
                            setMint1(position.mint1);
                            setShowPositions(false);
                            setStep(2);
                            setTimeout(() => checkPoolExists(), 200);
                          }}
                          onRemove={() => {
                            setSelectedPosition({
                              mint0: position.mint0,
                              mint1: position.mint1,
                              poolMint: position.poolMint,
                              poolState: position.poolState,
                              token0Symbol: position.token0Symbol,
                              token1Symbol: position.token1Symbol,
                            });
                            setIsRemoveModalOpen(true);
                          }}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Show current position if pool exists and user has LP tokens (for selected pair) - legacy support */}
                {!isDiscoveringPositions && poolExists && lpBalance > 0 && mint0 && mint1 && !userPositions.find(p => p.mint0 === mint0 && p.mint1 === mint1) && (
                  <div className="space-y-4">
                    <div className="bg-[#0d0e14] border border-[#2c2d3a] rounded-xl p-4 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex -space-x-2">
                            <div className="w-10 h-10 bg-[#5A8FFF] rounded-full flex items-center justify-center text-white font-semibold">
                              {token0?.symbol?.charAt(0) || '?'}
                            </div>
                            <div className="w-10 h-10 bg-[#5A8FFF] rounded-full flex items-center justify-center text-white font-semibold border-2 border-[#0d0e14]">
                              {token1?.symbol?.charAt(0) || '?'}
                            </div>
                          </div>
                          <div>
                            <div className="text-white font-semibold">
                              {token0?.symbol} / {token1?.symbol}
                            </div>
                            <div className="text-xs text-[#5a5d7a]">
                              {poolInfo ? 
                                `${((Number(poolInfo.feeNumerator) / Number(poolInfo.feeDenominator)) * 100 + (poolInfo.protocolFeeBps || 0) / 100).toFixed(2)}% fee` 
                                : '0.5% fee'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-semibold">
                            {lpBalance.toFixed(6)} LP
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Show manually selected pair position if not in discovered positions */}
                {!isDiscoveringPositions && poolExists && lpBalance > 0 && mint0 && mint1 && !userPositions.find(p => p.mint0 === mint0 && p.mint1 === mint1) && (
                  <div className="space-y-4">
                    <div className="bg-[#0d0e14] border border-[#2c2d3a] rounded-xl p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex -space-x-2">
                            <div className="w-10 h-10 bg-[#5A8FFF] rounded-full flex items-center justify-center text-white font-semibold">
                              {token0?.symbol?.charAt(0) || '?'}
                            </div>
                            <div className="w-10 h-10 bg-[#5A8FFF] rounded-full flex items-center justify-center text-white font-semibold border-2 border-[#0d0e14]">
                              {token1?.symbol?.charAt(0) || '?'}
                            </div>
                          </div>
                          <div>
                            <div className="text-white font-semibold">
                              {token0?.symbol} / {token1?.symbol}
                            </div>
                            <div className="text-xs text-[#5a5d7a]">
                              {poolInfo ? 
                                `${((Number(poolInfo.feeNumerator) / Number(poolInfo.feeDenominator)) * 100 + (poolInfo.protocolFeeBps || 0) / 100).toFixed(2)}% fee` 
                                : '0.5% fee'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-semibold">
                            {lpBalance.toFixed(6)} LP
                          </div>
                          {poolInfo?.totalAmountMinted && (
                            <div className="text-xs text-[#5a5d7a]">
                              {((lpBalance / (Number(poolInfo.totalAmountMinted.toString()) / 1e9)) * 100).toFixed(2)}% of pool
                            </div>
                          )}
                        </div>
                      </div>
                      {poolInfo?.reserve0 && poolInfo?.reserve1 && poolInfo?.totalAmountMinted && (
                        <div className="mt-4 pt-4 border-t border-[#2c2d3a]">
                          <div className="text-xs text-[#5a5d7a] mb-2">Your share represents:</div>
                          <div className="text-sm text-white">
                            {((lpBalance / (Number(poolInfo.totalAmountMinted.toString()) / 1e9)) * Number(poolInfo.reserve0)).toFixed(4)} {token0?.symbol} / {' '}
                            {((lpBalance / (Number(poolInfo.totalAmountMinted.toString()) / 1e9)) * Number(poolInfo.reserve1)).toFixed(4)} {token1?.symbol}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setShowPositions(false);
                          setStep(2);
                        }}
                        className="mt-4 w-full bg-[#5A8FFF] text-white py-3 rounded-xl font-semibold hover:opacity-90 transition-opacity"
                      >
                        Manage Position
                      </button>
                    </div>
                  </div>
                )}

                {!isDiscoveringPositions && userPositions.length === 0 && (!poolExists || lpBalance === 0) && (
                  <div className="text-center py-12">
                    <div className="text-[#5a5d7a] mb-4">
                      {!publicKey 
                        ? 'Connect your wallet to see your positions' 
                        : 'No liquidity positions found. Add liquidity to create your first position.'}
                    </div>
                    {!publicKey && (
                      <button
                        onClick={() => setShowPositions(false)}
                        className="text-[#5A8FFF] hover:text-[#5A8FFF]-hover font-medium"
                      >
                        Add your first position →
                      </button>
                    )}
                    {publicKey && (
                      <button
                        onClick={() => {
                          setShowPositions(false);
                          setStep(1);
                        }}
                        className="mt-4 text-[#5A8FFF] hover:text-[#5A8FFF]-hover font-medium"
                      >
                        Add Liquidity →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 1: Select Token Pair */}
            {!showPositions && step === 1 && (
              <div className="bg-[#1a1b23] rounded-xl p-4 sm:p-6 md:p-8 border border-[#2c2d3a]">
                <h2 className="text-lg sm:text-xl font-semibold text-white mb-2">Select pair</h2>
                <p className="text-xs sm:text-sm text-[#8e92bc] mb-4 sm:mb-6">
                  Choose the tokens you want to provide liquidity for. You can select tokens on all supported networks.
                </p>

                {/* Token Selection */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  {/* Token 0 */}
                  <div>
                    <TokenSelectorButton
                      mint={mint0}
                      onSelect={handleTokenSelect0}
                      excludeToken={mint1}
                      label="Token 0"
                      showLabel={true}
                    />
                  </div>

                  {/* Token 1 */}
                  <div>
                    <TokenSelectorButton
                      mint={mint1}
                      onSelect={handleTokenSelect1}
                      excludeToken={mint0}
                      label="Token 1"
                      showLabel={true}
                    />
                  </div>
                </div>

                {/* Fee Tier */}
                {mint0 && mint1 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-[#8e92bc] mb-2">Fee tier</h3>
                    <p className="text-sm text-[#5a5d7a]">
                      {poolExists && poolInfo ? (
                        <>
                          Swappers pay {' '}
                          <span className="text-white font-semibold">
                            {((Number(poolInfo.feeNumerator) / Number(poolInfo.feeDenominator)) * 100 + (poolInfo.protocolFeeBps || 0) / 100).toFixed(2)}%
                          </span>
                          {' '}per swap. You earn {' '}
                          <span className="text-[#00FF88] font-semibold">
                            {((Number(poolInfo.feeNumerator) / Number(poolInfo.feeDenominator)) * 100).toFixed(2)}%
                          </span>
                          {poolInfo.protocolFeeBps && poolInfo.protocolFeeBps > 0 ? (
                            <>, protocol receives {(poolInfo.protocolFeeBps / 100).toFixed(2)}%.</>
                          ) : (
                            <>.</>
                          )}
                        </>
                      ) : (
                        <>
                          Swappers pay <span className="text-white font-semibold">0.50%</span> per swap. 
                          You earn <span className="text-[#00FF88] font-semibold">0.30%</span>, protocol receives 0.20%.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {/* Pool Status Warning - Only show for new pools */}
                {mint0 && mint1 && !poolExists && (
                  <div className="mb-6 p-4 bg-[#1a1b23] border border-[#FED33A] rounded-xl">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#FED33A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#FED33A] mb-1">
                          Creating new pool
                        </div>
                        <div className="text-xs text-[#FED33A]/70">
                          Your selections will create a new liquidity pool which may result in lower initial liquidity and increased volatility. Consider adding to an existing pool to minimize these risks.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Continue Button */}
                <button
                  onClick={() => mint0 && mint1 && setStep(2)}
                  disabled={!mint0 || !mint1}
                  className="w-full bg-[#5A8FFF] text-white py-4 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  Continue
                </button>
              </div>
            )}

            {/* Step 2: Deposit Amounts */}
            {!showPositions && step === 2 && (
              <div className="bg-[#1a1b23] rounded-xl p-8 border border-[#2c2d3a]">
                {/* Token Pair Display */}
                {token0 && token1 && (
                  <div className="mb-6 p-4 bg-[#0d0e14] rounded-xl border border-[#2c2d3a] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-2">
                        {/* Token 0 Logo */}
                        {token0.logoURI ? (
                          <img 
                            src={token0.logoURI} 
                            alt={token0.symbol}
                            className="w-10 h-10 rounded-full border-2 border-[#0d0e14]"
                            onError={(e) => {
                              const img = e.target as HTMLImageElement;
                              if (img.src.includes('gateway.pinata.cloud')) {
                                img.src = img.src.replace('gateway.pinata.cloud/ipfs/', 'ipfs.io/ipfs/');
                              } else if (img.src.includes('ipfs.io')) {
                                img.src = img.src.replace('ipfs.io/ipfs/', 'cloudflare-ipfs.com/ipfs/');
                              } else {
                                img.style.display = 'none';
                                const fallback = img.nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }
                            }}
                          />
                        ) : null}
                        <div 
                          className="w-10 h-10 bg-[#5A8FFF] rounded-full flex items-center justify-center text-white font-semibold border-2 border-[#0d0e14]"
                          style={{ display: token0.logoURI ? 'none' : 'flex' }}
                        >
                          {token0.symbol.charAt(0)}
                        </div>
                        
                        {/* Token 1 Logo */}
                        {token1.logoURI ? (
                          <img 
                            src={token1.logoURI} 
                            alt={token1.symbol}
                            className="w-10 h-10 rounded-full border-2 border-[#0d0e14]"
                            onError={(e) => {
                              const img = e.target as HTMLImageElement;
                              if (img.src.includes('gateway.pinata.cloud')) {
                                img.src = img.src.replace('gateway.pinata.cloud/ipfs/', 'ipfs.io/ipfs/');
                              } else if (img.src.includes('ipfs.io')) {
                                img.src = img.src.replace('ipfs.io/ipfs/', 'cloudflare-ipfs.com/ipfs/');
                              } else {
                                img.style.display = 'none';
                                const fallback = img.nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }
                            }}
                          />
                        ) : null}
                        <div 
                          className="w-10 h-10 bg-[#5A8FFF] rounded-full flex items-center justify-center text-white font-semibold border-2 border-[#0d0e14]"
                          style={{ display: token1.logoURI ? 'none' : 'flex' }}
                        >
                          {token1.symbol.charAt(0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-white font-semibold">
                          {token0.symbol} / {token1.symbol}
                        </div>
                        <div className="text-xs text-[#00FF88]">
                          You earn {poolExists && poolInfo 
                            ? `${((Number(poolInfo.feeNumerator) / Number(poolInfo.feeDenominator)) * 100).toFixed(2)}%` 
                            : '0.3%'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setStep(1)}
                      className="text-[#8e92bc] hover:text-white transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                )}

                <h2 className="text-lg sm:text-xl font-semibold text-white mb-2">Deposit tokens</h2>
                <p className="text-xs sm:text-sm text-[#8e92bc] mb-4 sm:mb-6">
                  {poolExists 
                    ? `Specify the token amounts for your liquidity contribution. The amounts will be automatically calculated to maintain the current pool ratio of ${poolRatio ? `1 ${token0?.symbol} = ${(1 / poolRatio).toFixed(6)} ${token1?.symbol}` : 'N/A'}.`
                    : 'Specify the token amounts for your liquidity contribution. When creating a new pool, you must set the starting exchange rate for both tokens. This rate will reflect the initial market price. Enter amounts that represent the desired initial price ratio.'
                  }
                </p>

                {/* Pool Ratio Display */}
                {poolExists && poolRatio !== null && (
                  <div className="mb-6 p-4 bg-[#0d0e14] rounded-xl border border-[#2c2d3a]">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-[#5a5d7a] mb-1">Current Pool Ratio</div>
                        <div className="text-sm font-medium text-white">
                          1 {token0?.symbol} = {(1 / poolRatio).toFixed(6)} {token1?.symbol}
                        </div>
                        <div className="text-xs text-[#5a5d7a] mt-1">
                          Pool reserves: {poolInfo?.reserve0?.toFixed(4) || '0'} {token0?.symbol} / {poolInfo?.reserve1?.toFixed(4) || '0'} {token1?.symbol}
                        </div>
                      </div>
                      <div className="text-xs text-[#5a5d7a]">
                        💡 Amounts will auto-calculate to match this ratio
                      </div>
                    </div>
                  </div>
                )}

                {/* New Pool Guidance */}
                {!poolExists && mint0 && mint1 && (
                  <div className="mb-6 p-4 bg-[#1a1b23] border border-[#22D1F8] rounded-xl">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#22D1F8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#22D1F8] mb-1">
                          Setting Initial Price for New Pool
                        </div>
                        <div className="text-xs text-[#22D1F8]/70 space-y-1">
                          <p>• The ratio of your deposit amounts will set the initial exchange rate</p>
                          <p>• Example: If you deposit 1000 {token0?.symbol} and 1000 {token1?.symbol}, the initial price will be 1:1</p>
                          <p>• Consider market prices when setting your initial ratio to avoid immediate arbitrage</p>
                          <p>• You can adjust amounts freely - the ratio you choose becomes the pool's starting price</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Amount Inputs */}
                <div className="space-y-4 mb-6">
                  {/* Token 0 Amount */}
                  <div>
                    <label className="block text-sm font-medium text-[#8e92bc] mb-2">
                      {token0?.symbol || 'Token 0'}
                    </label>
                    <div>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amount0}
                          onChange={(e) => {
                            const value = e.target.value;
                            // Only allow numbers and decimal point
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              lastEditedRef.current = 'amount0';
                              setAmount0(value);
                            }
                          }}
                          placeholder="0.0"
                          className="w-full bg-[#0d0e14] border border-[#2c2d3a] rounded-xl px-4 py-4 pr-24 text-white text-lg focus:outline-none focus:ring-2 focus:ring-secondary focus:ring-opacity-30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          onClick={() => {
                            lastEditedRef.current = 'amount0';
                            setAmount0(balance0.toString());
                            // Calculate amount1 after a brief delay to avoid loop
                            setTimeout(() => {
                              if (poolExists && poolRatio !== null) {
                                const calculatedAmount1 = balance0 / poolRatio;
                                if (!isNaN(calculatedAmount1) && calculatedAmount1 >= 0) {
                                  setAmount1(calculatedAmount1.toFixed(9));
                                }
                              }
                              lastEditedRef.current = null;
                            }, 100);
                          }}
                          className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-[#5A8FFF]/10 hover:bg-[#5A8FFF]/20 text-[#5A8FFF] text-xs font-medium rounded-lg border border-[#5A8FFF]/30 hover:border-[#5A8FFF]/50 transition-all duration-200"
                        >
                          MAX
                        </button>
                      </div>
                      <div className="text-xs text-[#5a5d7a] mt-2 ml-1">
                        Balance: {balance0.toFixed(4)} {token0?.symbol}
                      </div>
                    </div>
                  </div>

                  {/* Token 1 Amount */}
                  <div>
                    <label className="block text-sm font-medium text-[#8e92bc] mb-2">
                      {token1?.symbol || 'Token 1'}
                    </label>
                    <div>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amount1}
                          onChange={(e) => {
                            const value = e.target.value;
                            // Only allow numbers and decimal point
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              lastEditedRef.current = 'amount1';
                              setAmount1(value);
                            }
                          }}
                          placeholder="0.0"
                          className="w-full bg-[#0d0e14] border border-[#2c2d3a] rounded-xl px-4 py-4 pr-24 text-white text-lg focus:outline-none focus:ring-2 focus:ring-secondary focus:ring-opacity-30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          onClick={() => {
                            lastEditedRef.current = 'amount1';
                            setAmount1(balance1.toString());
                            // Calculate amount0 after a brief delay to avoid loop
                            setTimeout(() => {
                              if (poolExists && poolRatio !== null) {
                                const calculatedAmount0 = balance1 * poolRatio;
                                if (!isNaN(calculatedAmount0) && calculatedAmount0 >= 0) {
                                  setAmount0(calculatedAmount0.toFixed(9));
                                }
                              }
                              lastEditedRef.current = null;
                            }, 100);
                          }}
                          className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-[#5A8FFF]/10 hover:bg-[#5A8FFF]/20 text-[#5A8FFF] text-xs font-medium rounded-lg border border-[#5A8FFF]/30 hover:border-[#5A8FFF]/50 transition-all duration-200"
                        >
                          MAX
                        </button>
                      </div>
                      {amount1 && parseFloat(amount1) > 0 && (
                        <div className="text-xs text-[#5a5d7a] mt-2 ml-1">
                          ≈ ${(parseFloat(amount1) * 42.50).toFixed(2)} {/* Mock USD price - replace with real price */}
                        </div>
                      )}
                      <div className="text-xs text-[#5a5d7a] mt-1 ml-1">
                        Balance: {balance1.toFixed(4)} {token1?.symbol}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4">
                  <button
                    onClick={() => setStep(1)}
                    className="flex-1 bg-[#0d0e14] text-[#8e92bc] py-4 rounded-xl font-semibold hover:bg-[rgba(255,255,255,0.1)] transition-colors border border-[#2c2d3a]"
                  >
                    Back
                  </button>
                  {!publicKey ? (
                    <div className="flex-1 bg-[#5A8FFF] text-white py-4 rounded-xl font-semibold text-center">
                      Connect wallet
                    </div>
                  ) : (
                    <button
                      onClick={handleAddLiquidity}
                      disabled={isLoading || !amount0 || !amount1}
                      className="flex-1 bg-[#5A8FFF] text-white py-4 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                    >
                      {isLoading ? 'Adding...' : 'Add Liquidity'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast Notifications */}
      <ToastContainer>
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            type={toast.type}
            title={toast.title}
            message={toast.message}
            txSignature={toast.txSignature}
            duration={toast.duration}
            onClose={() => hideToast(toast.id)}
          />
        ))}
      </ToastContainer>

      {/* Remove Liquidity Modal */}
      {selectedPosition && (
        <RemoveLiquidityModal
          isOpen={isRemoveModalOpen}
          onClose={() => {
            setIsRemoveModalOpen(false);
            setSelectedPosition(null);
          }}
          poolMint={selectedPosition.poolMint}
          poolState={selectedPosition.poolState}
          mint0={selectedPosition.mint0}
          mint1={selectedPosition.mint1}
          token0Symbol={selectedPosition.token0Symbol}
          token1Symbol={selectedPosition.token1Symbol}
          onSuccess={(signature) => {
            showSuccess(
              'Liquidity Removed!',
              `Successfully removed liquidity from ${selectedPosition.token0Symbol}/${selectedPosition.token1Symbol} pool`,
              signature
            );
            // Refresh positions
            setTimeout(() => {
              discoverAllPositions();
            }, 2000);
          }}
          onError={(error) => {
            showError('Transaction Failed', error);
          }}
        />
      )}
    </div>
  );
}
