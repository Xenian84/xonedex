/**
 * V2 AMM Pool State Deserialization
 * Reads pool state from on-chain account data
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Buffer } from 'buffer';

/**
 * V2 AMM Pool State structure (matches Rust struct)
 * 
 * Layout:
 * - discriminator: 8 bytes
 * - total_amount_minted: u64 (8 bytes)
 * - fee_numerator: u64 (8 bytes)
 * - fee_denominator: u64 (8 bytes)
 * - protocol_treasury: Pubkey (32 bytes)
 * - protocol_fee_bps: u16 (2 bytes)
 */
export interface V2AmmPoolStateData {
  totalAmountMinted: BN;
  feeNumerator: BN;
  feeDenominator: BN;
  protocolTreasury: PublicKey;
  protocolFeeBps: number;
}

/**
 * Fetch and deserialize V2 AMM pool state from on-chain
 */
export async function fetchV2AmmPoolState(
  connection: Connection,
  poolState: PublicKey
): Promise<V2AmmPoolStateData | null> {
  try {
    const accountInfo = await connection.getAccountInfo(poolState);
    if (!accountInfo) {
      console.warn(`Pool state account not found: ${poolState.toString()}`);
      return null;
    }

    const data = accountInfo.data;
    
    // Minimum expected size for old format: 8 (discriminator) + 8 + 8 + 8 = 32 bytes
    // New format: 8 + 8 + 8 + 8 + 32 + 2 = 66 bytes
    const oldFormatSize = 8 + 8 + 8 + 8; // 32 bytes (backward compatible)
    const newFormatSize = 8 + 8 + 8 + 8 + 32 + 2; // 66 bytes (with treasury)
    
    if (data.length < oldFormatSize) {
      console.error(`Pool state account too small: expected at least ${oldFormatSize} bytes, got ${data.length}`);
      return null;
    }
    
    // Check if this is old format (32 bytes) or new format (66 bytes)
    const isNewFormat = data.length >= newFormatSize;
    
    // Deserialize PoolState
    // Discriminator: 8 bytes (skip)
    let offset = 8;
    
    // total_amount_minted: u64 (8 bytes, little-endian)
    const totalAmountMintedSlice = data.slice(offset, offset + 8);
    if (totalAmountMintedSlice.length !== 8) {
      console.error('Invalid data length for total_amount_minted');
      return null;
    }
    let totalAmountMinted: BN;
    try {
      // Ensure we have a proper Buffer - BN.js can be strict about this
      const buffer = Buffer.from(totalAmountMintedSlice);
      totalAmountMinted = new BN(buffer, 'le');
    } catch (e) {
      console.error('Failed to parse total_amount_minted:', e, 'Data:', Array.from(totalAmountMintedSlice));
      return null;
    }
    offset += 8;
    
    // fee_numerator: u64 (8 bytes, little-endian)
    const feeNumeratorSlice = data.slice(offset, offset + 8);
    if (feeNumeratorSlice.length !== 8) {
      console.error('Invalid data length for fee_numerator');
      return null;
    }
    let feeNumerator: BN;
    try {
      const buffer = Buffer.from(feeNumeratorSlice);
      feeNumerator = new BN(buffer, 'le');
    } catch (e) {
      console.error('Failed to parse fee_numerator:', e, 'Data:', Array.from(feeNumeratorSlice));
      return null;
    }
    offset += 8;
    
    // fee_denominator: u64 (8 bytes, little-endian)
    const feeDenominatorSlice = data.slice(offset, offset + 8);
    if (feeDenominatorSlice.length !== 8) {
      console.error('Invalid data length for fee_denominator');
      return null;
    }
    let feeDenominator: BN;
    try {
      const buffer = Buffer.from(feeDenominatorSlice);
      feeDenominator = new BN(buffer, 'le');
    } catch (e) {
      console.error('Failed to parse fee_denominator:', e, 'Data:', Array.from(feeDenominatorSlice));
      return null;
    }
    offset += 8;

    // Validate that fee_denominator is not zero (would cause division by zero)
    if (feeDenominator.isZero()) {
      console.error('Invalid pool state: fee_denominator is zero');
      return null;
    }

    // Parse new fields if available (backward compatible)
    let protocolTreasury: PublicKey;
    let protocolFeeBps: number;
    
    if (isNewFormat && data.length >= offset + 32 + 2) {
      // protocol_treasury: Pubkey (32 bytes)
      const treasurySlice = data.slice(offset, offset + 32);
      if (treasurySlice.length === 32) {
        try {
          protocolTreasury = new PublicKey(treasurySlice);
        } catch (e) {
          console.warn('Failed to parse protocol_treasury, using default:', e);
          protocolTreasury = PublicKey.default;
        }
      } else {
        protocolTreasury = PublicKey.default;
      }
      offset += 32;
      
      // protocol_fee_bps: u16 (2 bytes, little-endian)
      const feeBpsSlice = data.slice(offset, offset + 2);
      if (feeBpsSlice.length === 2) {
        try {
          const feeBpsBuffer = Buffer.from(feeBpsSlice);
          protocolFeeBps = feeBpsBuffer.readUInt16LE(0);
        } catch (e) {
          console.warn('Failed to parse protocol_fee_bps, using 0:', e);
          protocolFeeBps = 0;
        }
      } else {
        protocolFeeBps = 0;
      }
      offset += 2;
    } else {
      // Old format - defaults (backward compatible)
      protocolTreasury = PublicKey.default;
      protocolFeeBps = 0;
    }

    return {
      totalAmountMinted,
      feeNumerator,
      feeDenominator,
      protocolTreasury,
      protocolFeeBps,
    };
  } catch (error) {
    console.error('❌ Error fetching pool state:', error);
    console.error('Pool state address:', poolState.toString());
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return null;
  }
}
