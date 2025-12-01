/**
 * Swap Store - Manages swap-specific state and actions
 * Based on Raydium's useSwapStore pattern
 */

import { create } from 'zustand';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import { buildV2AmmSwapTransaction } from '../utils/v2AmmSwap';
import { buildUnifiedSwapTransaction } from '../utils/unifiedSwap';
import { buildUnwrapXNTTransaction } from '../utils/unwrapXNT';
import { getCurrentRPC } from '../config/x1';
import { useNetworkStore } from './useNetworkStore';

const SWAP_SLIPPAGE_KEY = '_xonedex_swap_slippage_';

interface SwapStore {
  slippage: number; // Slippage tolerance (0.005 = 0.5%)
  
  // Actions
  setSlippage: (slippage: number) => void;
  swapTokenAct: (props: SwapTokenActProps) => Promise<string | undefined>;
  unWrapXNTAct: (props: UnWrapXNTActProps) => Promise<string | undefined>;
}

interface SwapTokenActProps {
  connection: Connection;
  owner: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  inputMint: PublicKey | string; // Can be PublicKey or string (including NATIVE_XNT_MARKER)
  outputMint: PublicKey | string; // Can be PublicKey or string (including NATIVE_XNT_MARKER)
  amountIn: BN;
  minAmountOut: BN;
  priorityFeeInLamports?: number; // Optional priority fee
  onSuccess?: (signature: string) => void;
  onError?: (error: Error) => void;
  onFinally?: () => void;
}

interface UnWrapXNTActProps {
  connection: Connection;
  owner: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  onSuccess?: (signature: string) => void;
  onError?: (error: Error) => void;
  onFinally?: () => void;
}

// Initialize slippage from localStorage
const getInitialSlippage = (): number => {
  if (typeof window === 'undefined') return 0.005;
  
  try {
    const stored = localStorage.getItem(SWAP_SLIPPAGE_KEY);
    if (stored) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Failed to read slippage from localStorage:', error);
  }
  
  return 0.005; // Default 0.5%
};

export const useSwapStore = create<SwapStore>((set, get) => ({
  slippage: getInitialSlippage(),

  setSlippage: (slippage: number) => {
    set({ slippage });
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(SWAP_SLIPPAGE_KEY, slippage.toString());
      } catch (error) {
        console.warn('Failed to save slippage to localStorage:', error);
      }
    }
  },

  swapTokenAct: async ({
    connection,
    owner,
    signTransaction,
    inputMint,
    outputMint,
    amountIn,
    minAmountOut,
    priorityFeeInLamports = 0,
    onSuccess,
    onError,
    onFinally,
  }) => {
    try {
      // Build the swap transaction (auto-detects native vs regular pools)
      const transaction = await buildUnifiedSwapTransaction(
        connection,
        owner,
        inputMint,
        outputMint,
        amountIn,
        minAmountOut,
        get().slippage * 10000 // Convert to basis points
      );

      if (!transaction) {
        throw new Error('Failed to build swap transaction');
      }
      
      // Add priority fee if specified
      // TODO: Integrate priority fee into unified builder
      if (priorityFeeInLamports > 0) {
        console.log('Priority fee support for native pools coming soon');
      }

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const rawTransaction = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      // Set up transaction confirmation listener for auto-refresh
      // This will trigger refresh when transaction confirms, even if timeout occurs
      let confirmationListener: number | null = null;
      try {
        confirmationListener = connection.onSignature(
          signature,
          (result) => {
            if (result.err === null) {
              // Transaction confirmed successfully - trigger refresh callback
              console.log('✅ Transaction confirmed, pool will refresh automatically');
            }
          },
          'confirmed'
        );
      } catch (e) {
        console.warn('Failed to setup confirmation listener:', e);
      }

      // Wait for confirmation - use simple approach that was working before
      // X1 network can be slow, so we handle timeouts gracefully
      try {
        await connection.confirmTransaction(signature, 'confirmed');
        
        // Remove listener if confirmation succeeded normally
        if (confirmationListener !== null) {
          try {
            connection.removeSignatureListener(confirmationListener);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      } catch (confirmError: any) {
        // Handle timeout errors gracefully - transaction may still succeed
        const errorMessage = confirmError?.message || confirmError?.toString() || '';
        const isTimeout = errorMessage.includes('Transaction was not confirmed') ||
                         errorMessage.includes('TransactionExpiredTimeoutError') ||
                         confirmError?.name === 'TransactionExpiredTimeoutError';
        
        if (isTimeout) {
          // Transaction timed out but may still succeed - let listener handle it
          console.log('⏱️ Confirmation timeout - transaction may still be processing');
          console.log('⏱️ Signature listener will handle confirmation when it arrives');
          // Don't throw error - let the signature listener handle confirmation
          // Return signature so UI doesn't show error
          return signature;
        }
        
        // Other errors - clean up and throw
        if (confirmationListener !== null) {
          try {
            connection.removeSignatureListener(confirmationListener);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        throw confirmError;
      }

      onSuccess?.(signature);
      return signature;
    } catch (error: any) {
      // Extract meaningful error message from various error formats
      let errorMessage = 'Swap failed. Please try again.';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (error?.msg) {
        errorMessage = error.msg;
      } else if (error?.err) {
        // Solana transaction errors often have err property
        errorMessage = typeof error.err === 'string' 
          ? error.err 
          : JSON.stringify(error.err);
      } else if (error?.toString && error.toString() !== '[object Object]') {
        errorMessage = error.toString();
      } else {
        // Last resort: try to stringify the error
        try {
          errorMessage = JSON.stringify(error);
        } catch {
          errorMessage = 'Unknown error occurred';
        }
      }
      
      // Check for InstructionError with custom error codes
      let enhancedMessage = errorMessage;
      if (error?.err || error?.InstructionError) {
        const instructionError = error.err || error.InstructionError;
        if (Array.isArray(instructionError) && instructionError.length >= 2) {
          const [instructionIndex, errorDetails] = instructionError;
          if (errorDetails?.Custom !== undefined) {
            const customErrorCode = errorDetails.Custom;
            // Map Anchor error codes to human-readable messages
            // Anchor error codes start at 6000, but we're seeing codes in 3000s
            // These might be offset or from a different error system
            // Map common error codes to helpful messages
            const errorCodeMap: { [key: number]: string } = {
              3000: 'Insufficient balance in source account',
              3001: 'Not enough output tokens received (slippage protection)',
              3002: 'Swap amount specified is zero',
              3003: 'Invalid protocol treasury account - Treasury ATA may not exist or have wrong owner/mint',
              3004: 'Swap is currently disabled for this pool',
              3005: 'Invalid pool state',
              3006: 'Calculation overflow',
              3007: 'Division by zero',
              3012: 'Vault destination account constraint failed - Check vault_dst owner/mint matches pool authority and user_dst mint',
            };
            const errorMsg = errorCodeMap[customErrorCode] || `Program error code: ${customErrorCode}`;
            enhancedMessage = `${errorMsg} (Error code: ${customErrorCode}, Instruction: ${instructionIndex})`;
            console.error(`❌ Program error code ${customErrorCode}: ${errorMsg}`);
          }
        }
      }
      
      const err = new Error(enhancedMessage);
      console.error('❌ Swap error:', error); // Log full error for debugging
      console.error('❌ Error details:', JSON.stringify(error, null, 2)); // Log full error details
      if (error?.logs) {
        console.error('❌ Program logs:', error.logs);
      }
      onError?.(err);
      throw err;
    } finally {
      onFinally?.();
    }
  },

  unWrapXNTAct: async ({
    connection,
    owner,
    signTransaction,
    onSuccess,
    onError,
    onFinally,
  }) => {
    try {
      // Build the unwrap transaction
      const transaction = await buildUnwrapXNTTransaction(connection, owner);

      if (!transaction) {
        throw new Error('Failed to build unwrap transaction');
      }

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const rawTransaction = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      // Wait for confirmation with longer timeout for X1 network
      try {
        await Promise.race([
          connection.confirmTransaction(signature, 'confirmed'),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Confirmation timeout')), 60000) // Increased to 60 seconds for X1
          )
        ]);
      } catch (timeoutError: any) {
        // Handle both our custom timeout and Solana's built-in 30s timeout
        const isTimeout = timeoutError.message === 'Confirmation timeout' || 
                         timeoutError.message?.includes('Transaction was not confirmed') ||
                         timeoutError.message?.includes('TransactionExpiredTimeoutError') ||
                         timeoutError.name === 'TransactionExpiredTimeoutError' ||
                         timeoutError.constructor?.name === 'TransactionExpiredTimeoutError';
        
        if (isTimeout) {
          console.log('⏱️ Confirmation timeout, verifying transaction status...');
          console.log('⏱️ Timeout error:', timeoutError.message || timeoutError.name);
          
          // Wait a bit more for transaction to propagate on X1 network
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          try {
            // Check transaction status with multiple attempts
            let tx = null;
            for (let i = 0; i < 3; i++) {
              tx = await connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
              });
              if (tx) break;
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            if (tx?.meta?.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`);
            }
            
            if (tx && !tx.meta?.err) {
              // Transaction exists and succeeded!
              console.log('✅ Transaction confirmed successfully (verified after timeout)');
              onSuccess?.(signature);
              return signature;
            }
            
            // Transaction not found yet, but might still be processing
            // Don't throw error - let the signature listener handle it when it confirms
            console.warn('⚠️ Transaction not found yet, but may still be processing. Signature listener will handle confirmation.');
            // Keep the listener active - it will trigger refresh when transaction confirms
            return signature;
          } catch (verifyError: any) {
            // If verification fails, provide helpful error with signature
            if (verifyError.message.includes('Transaction failed')) {
              throw verifyError;
            }
            const explorerUrl = useNetworkStore.getState().config.explorerUrl;
            throw new Error(`Transaction confirmation timed out. Please check manually: ${explorerUrl}/tx/${signature}. Error: ${verifyError.message}`);
          }
        }
        throw timeoutError;
      }

      onSuccess?.(signature);
      return signature;
    } catch (error: any) {
      // Extract meaningful error message from various error formats
      let errorMessage = 'Unwrap failed. Please try again.';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (error?.msg) {
        errorMessage = error.msg;
      } else if (error?.err) {
        // Solana transaction errors often have err property
        errorMessage = typeof error.err === 'string' 
          ? error.err 
          : JSON.stringify(error.err);
      } else if (error?.toString && error.toString() !== '[object Object]') {
        errorMessage = error.toString();
      } else {
        // Last resort: try to stringify the error
        try {
          errorMessage = JSON.stringify(error);
        } catch {
          errorMessage = 'Unknown error occurred';
        }
      }
      
      const err = new Error(errorMessage);
      console.error('❌ Unwrap error:', error); // Log full error for debugging
      onError?.(err);
      throw err;
    } finally {
      onFinally?.();
    }
  },
}));

