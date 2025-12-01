/**
 * Swap pair caching utility
 * Stores and retrieves token pairs from localStorage
 */

const CACHE_KEY = '_xonedex_swap_pair_';

export interface SwapPairCache {
  inputMint: string;
  outputMint: string;
}

export function getSwapPairCache(): SwapPairCache {
  if (typeof window === 'undefined') {
    return { inputMint: '', outputMint: '' };
  }
  
  try {
    const cache = localStorage.getItem(CACHE_KEY);
    return cache ? JSON.parse(cache) : { inputMint: '', outputMint: '' };
  } catch (error) {
    console.warn('Failed to read swap pair cache:', error);
    return { inputMint: '', outputMint: '' };
  }
}

export function setSwapPairCache(params: Partial<SwapPairCache>): void {
  if (typeof window === 'undefined') return;
  
  try {
    const currentCache = getSwapPairCache();
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        ...currentCache,
        ...params
      })
    );
  } catch (error) {
    console.warn('Failed to save swap pair cache:', error);
  }
}

