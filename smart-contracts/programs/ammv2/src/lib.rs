use anchor_lang::prelude::*;

pub mod error; 
pub mod state; 
pub mod instructions;
pub mod utils;

use instructions::*;

declare_id!("AMMEDavgL7M5tbrxoXmtmxM7iArJb98KkoBW1EtFFJ2");

#[program]
pub mod ammv2 {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>, 
        fee_numerator: u64,
        fee_denominator: u64,
        protocol_treasury: Option<Pubkey>,
        protocol_fee_bps: Option<u16>,
    ) -> Result<()> {
        init_pool::handler(ctx, fee_numerator, fee_denominator, protocol_treasury, protocol_fee_bps)
    }

    pub fn remove_liquidity(
        ctx: Context<LiquidityOperation>, 
        burn_amount: u64,
    ) -> Result<()> {
        liquidity::remove_liquidity(ctx, burn_amount)
    }

    pub fn add_liquidity(
        ctx: Context<LiquidityOperation>, 
        amount_liq0: u64, 
        amount_liq1: u64, 
    ) -> Result<()> {
        liquidity::add_liquidity(ctx, amount_liq0, amount_liq1)
    }

    pub fn swap(
        ctx: Context<Swap>, 
        amount_in: u64, 
        min_amount_out: u64,
    ) -> Result<()> {
        swap::swap(ctx, amount_in, min_amount_out)
    }
    
    // === NATIVE XNT POOL INSTRUCTIONS ===
    
    pub fn initialize_native_pool(
        ctx: Context<InitializeNativePool>,
        fee_numerator: u64,
        fee_denominator: u64,
        protocol_treasury: Pubkey,
        protocol_fee_bps: u16,
        native_mint_index: u8,
    ) -> Result<()> {
        native_pool::initialize_native_pool(
            ctx,
            fee_numerator,
            fee_denominator,
            protocol_treasury,
            protocol_fee_bps,
            native_mint_index,
        )
    }
    
    pub fn add_native_liquidity(
        ctx: Context<AddNativeLiquidity>,
        xnt_amount: u64,
        token_amount: u64,
        min_lp_tokens: u64,
    ) -> Result<()> {
        native_pool::add_native_liquidity(ctx, xnt_amount, token_amount, min_lp_tokens)
    }
    
    pub fn remove_native_liquidity(
        ctx: Context<RemoveNativeLiquidity>,
        lp_amount: u64,
    ) -> Result<()> {
        native_pool::remove_native_liquidity(ctx, lp_amount)
    }
    
    pub fn swap_native(
        ctx: Context<SwapNative>,
        amount_in: u64,
        min_amount_out: u64,
        is_xnt_to_token: bool,
    ) -> Result<()> {
        native_pool::swap_native(ctx, amount_in, min_amount_out, is_xnt_to_token)
    }
    
    /// Reconcile native reserve with actual PDA balance
    /// Use this to fix any reserve drift
    pub fn reconcile_native_reserve(ctx: Context<ReconcileNativeReserve>) -> Result<()> {
        native_pool::reconcile_native_reserve(ctx)
    }
    
    /// Emergency pause for native pool
    pub fn pause_native_pool(ctx: Context<PauseNativePool>) -> Result<()> {
        native_pool::pause_native_pool(ctx)
    }
    
    pub fn recover_stuck_native_xnt(ctx: Context<RecoverStuckNativeXnt>) -> Result<()> {
        native_pool::recover_stuck_native_xnt(ctx)
    }
}
