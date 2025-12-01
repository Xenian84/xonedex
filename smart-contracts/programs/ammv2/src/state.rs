use anchor_lang::prelude::*;

#[account]
#[derive(Default)] // defaults to zeros -- which we want 
pub struct PoolState {
    pub total_amount_minted: u64, 
    pub fee_numerator: u64, 
    pub fee_denominator: u64,
    // Protocol treasury (Pubkey::default() = no treasury, all fees go to LPs)
    pub protocol_treasury: Pubkey,
    // Protocol fee in basis points (0-10000, where 10000 = 100%)
    // 0 = all fees go to LPs (backward compatible default)
    pub protocol_fee_bps: u16,
    
    // === NATIVE XNT POOL SUPPORT ===
    // If true, one side of the pool is native XNT (not wrapped)
    pub is_native_pool: bool,
    // Which mint position is native: 0 = mint0 is XNT, 1 = mint1 is XNT
    // Only valid if is_native_pool = true
    pub native_mint_index: u8,
    // Tracked native XNT balance (separate from rent reserve)
    // Only valid if is_native_pool = true
    pub native_reserve: u64,
}

impl PoolState {
    /// Deserialize PoolState with backward compatibility
    /// Handles both old format (32 bytes) and new format (66 bytes)
    pub fn try_deserialize(data: &mut &[u8]) -> Result<Self> {
        // Minimum size: discriminator (8) + 3 u64 fields (24) = 32 bytes
        if data.len() < 32 {
            return Err(anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound.into());
        }

        // Skip discriminator (8 bytes)
        let mut cursor = &data[8..];
        
        // Read required fields (always present)
        let total_amount_minted = u64::from_le_bytes(
            cursor[0..8].try_into().map_err(|_| anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound)?
        );
        cursor = &cursor[8..];
        
        let fee_numerator = u64::from_le_bytes(
            cursor[0..8].try_into().map_err(|_| anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound)?
        );
        cursor = &cursor[8..];
        
        let fee_denominator = u64::from_le_bytes(
            cursor[0..8].try_into().map_err(|_| anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound)?
        );
        cursor = &cursor[8..];

        // Check if protocol fields are present (v2 format: 32 + 2 = 34 bytes more)
        let (protocol_treasury, protocol_fee_bps) = if cursor.len() >= 34 {
            // V2 format: read protocol_treasury (32 bytes) and protocol_fee_bps (2 bytes)
            let treasury_bytes: [u8; 32] = cursor[0..32]
                .try_into()
                .map_err(|_| anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound)?;
            let protocol_treasury = Pubkey::try_from(treasury_bytes)
                .map_err(|_| anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound)?;
            
            let protocol_fee_bps = u16::from_le_bytes(
                cursor[32..34].try_into().map_err(|_| anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound)?
            );
            
            (protocol_treasury, protocol_fee_bps)
        } else {
            // V1 format: use defaults (backward compatible)
            (Pubkey::default(), 0u16)
        };
        
        // Advance cursor past protocol fields if present
        if cursor.len() >= 34 {
            cursor = &cursor[34..];
        }
        
        // Check if native pool fields are present (v3 format: 1 + 8 + 1 = 10 bytes more)
        let (is_native_pool, native_reserve, native_mint_index) = if cursor.len() >= 10 {
            // V3 format: read native pool fields
            let is_native_pool = cursor[0] != 0;
            
            let native_reserve = u64::from_le_bytes(
                cursor[1..9].try_into().map_err(|_| anchor_lang::error::ErrorCode::AccountDiscriminatorNotFound)?
            );
            
            let native_mint_index = cursor[9];
            
            (is_native_pool, native_reserve, native_mint_index)
        } else {
            // V1/V2 format: use defaults (backward compatible - SPL pool)
            (false, 0u64, 0u8)
        };

        Ok(PoolState {
            total_amount_minted,
            fee_numerator,
            fee_denominator,
            protocol_treasury,
            protocol_fee_bps,
            is_native_pool,
            native_reserve,
            native_mint_index,
        })
    }
}
