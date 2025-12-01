use anchor_lang::prelude::*;
use anchor_spl::{
    token,
    token::{Token, TokenAccount, Transfer, Mint, CloseAccount},
};
use spl_token_2022::state::Account as Token2022AccountState;
use spl_token_2022::extension::StateWithExtensions;
use spl_token_2022::instruction as token_2022_instruction;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::system_program;

use crate::state::PoolState;
use crate::error::ErrorCode;
use crate::utils::{is_token_2022, get_token_program_account};

pub fn swap(
    ctx: Context<Swap>, 
    amount_in: u64, 
    min_amount_out: u64,
) -> Result<()> {

    // Helper function to unpack token account (works for both Token and Token2022 with extensions)
    fn unpack_token_account(account_info: &AccountInfo, name: &str) -> Result<Token2022AccountState> {
// msg!("Unpacking {}: owner={}, data_len={}", name, account_info.owner, account_info.data_len());
        
        let account = if account_info.data_len() == 165 {
            // Standard size - use regular unpack
            Token2022AccountState::unpack(&account_info.data.borrow())
                .map_err(|e| {
// msg!("❌ Failed to unpack {} (standard): {:?}", name, e);
                    e
                })?
        } else {
            // Has extensions - use StateWithExtensions
            let account_data = account_info.data.borrow();
            let state_with_ext = StateWithExtensions::<Token2022AccountState>::unpack(&account_data)
                .map_err(|e| {
// msg!("❌ Failed to unpack {} (with extensions): {:?}", name, e);
                    e
                })?;
            state_with_ext.base
        };
        
// msg!("✅ {} unpacked successfully", name);
        Ok(account)
    }

    // Unpack all token accounts
    let user_src_data = ctx.accounts.user_src.to_account_info();
    let user_src_account = unpack_token_account(&user_src_data, "user_src")?;
    
    let user_dst_data = ctx.accounts.user_dst.to_account_info();
    let user_dst_account = unpack_token_account(&user_dst_data, "user_dst")?;
    
    let vault_src_data = ctx.accounts.vault_src.to_account_info();
    let vault_src_account = unpack_token_account(&vault_src_data, "vault_src")?;
    
    let vault_dst_data = ctx.accounts.vault_dst.to_account_info();
    let vault_dst_account = unpack_token_account(&vault_dst_data, "vault_dst")?;

    // Validate user accounts owned by signer
    require!(user_src_account.owner == ctx.accounts.owner.key(), ErrorCode::NotEnoughBalance);
    require!(user_dst_account.owner == ctx.accounts.owner.key(), ErrorCode::NotEnoughBalance);
    
    // Validate vaults owned by pool authority
    require!(vault_src_account.owner == ctx.accounts.pool_authority.key(), ErrorCode::InvalidTreasury);
    require!(vault_dst_account.owner == ctx.accounts.pool_authority.key(), ErrorCode::InvalidTreasury);
    
    // Validate mint matches
    require!(user_src_account.mint == vault_src_account.mint, ErrorCode::InvalidTreasury);
    require!(user_dst_account.mint == vault_dst_account.mint, ErrorCode::InvalidTreasury);

    let src_balance = user_src_account.amount;
    require!(src_balance >= amount_in, ErrorCode::NotEnoughBalance);

    let u128_amount_in = amount_in as u128;

    // Load pool state with backward compatibility
    // Handles both old (32 bytes) and new (66 bytes) formats
    let pool_state = PoolState::try_deserialize(&mut &ctx.accounts.pool_state.to_account_info().data.borrow()[..])?;
    
    // Verify pool authority matches expected PDA
    let (expected_pool_authority, _) = Pubkey::find_program_address(
        &[b"authority", ctx.accounts.pool_state.key().as_ref()],
        ctx.program_id
    );
    require!(
        ctx.accounts.pool_authority.key() == expected_pool_authority,
        anchor_lang::error::ErrorCode::ConstraintSeeds
    );
    
    let src_vault_amount = vault_src_account.amount as u128;
    let dst_vault_amount = vault_dst_account.amount as u128;

    // Protocol fee always collected in XNT (native token)
    // Check if input or output is XNT to determine where to collect fee
    let native_mint = anchor_spl::token::spl_token::native_mint::id();
    let is_input_xnt = user_src_account.mint == native_mint;
    let is_output_xnt = user_dst_account.mint == native_mint;
    
    // Calculate swap output first (needed to determine XNT amount for protocol fee)
    // LP fee calculated on input amount (standard AMM fee)
    let lp_fee_amount = u128_amount_in
        .checked_mul(pool_state.fee_numerator as u128).unwrap()
        .checked_div(pool_state.fee_denominator as u128).unwrap();
    
    // Amount after LP fee (used in swap calculation)
    let amount_in_minus_fees = u128_amount_in - lp_fee_amount; 

    // Compute output amount using constant product equation 
    let invariant = src_vault_amount.checked_mul(dst_vault_amount).unwrap();
    let new_src_vault = src_vault_amount + amount_in_minus_fees; 
    let new_dst_vault = invariant.checked_div(new_src_vault).unwrap(); 
    let output_amount = dst_vault_amount.checked_sub(new_dst_vault).unwrap();

    // Calculate protocol fee in XNT (always collected in XNT)
    // Protocol fee = protocol_fee_bps% of XNT amount (input if swapping FROM XNT, output if swapping TO XNT)
    let xnt_amount_for_fee = if is_input_xnt {
        u128_amount_in // XNT input amount
    } else if is_output_xnt {
        output_amount // XNT output amount
    } else {
        0 // No XNT involved, no protocol fee
    };
    
    let protocol_fee_xnt = if pool_state.protocol_treasury != Pubkey::default() 
        && pool_state.protocol_fee_bps > 0 
        && xnt_amount_for_fee > 0 {
        // Protocol fee = protocol_fee_bps% of XNT amount
        xnt_amount_for_fee
            .checked_mul(pool_state.protocol_fee_bps as u128).unwrap()
            .checked_div(10000).unwrap()
    } else {
        0
    };

    // Check if treasury ATA exists and is valid (before deducting fees)
    let treasury_ata_valid = pool_state.protocol_treasury != Pubkey::default()
        && protocol_fee_xnt > 0
        && !ctx.accounts.protocol_treasury_ata.data_is_empty()
        && *ctx.accounts.protocol_treasury_ata.owner == ctx.accounts.token_program.key();

    // Adjust output if protocol fee is deducted from XNT output
    // Only deduct if treasury ATA is valid (otherwise user gets full amount)
    let final_output_amount = if is_output_xnt && treasury_ata_valid {
        // Deduct protocol fee from XNT output
        output_amount.checked_sub(protocol_fee_xnt).unwrap()
    } else {
        output_amount
    };
    
    // Adjust input if protocol fee is deducted from XNT input
    // Only deduct if treasury ATA is valid (otherwise user sends full amount)
    let final_amount_to_vault = if is_input_xnt && treasury_ata_valid {
        // Deduct protocol fee from XNT input before sending to vault
        u128_amount_in.checked_sub(protocol_fee_xnt).unwrap()
    } else {
        u128_amount_in
    };

    // Revert if not enough out (after protocol fee deduction)
    require!(final_output_amount >= min_amount_out as u128, ErrorCode::NotEnoughOut);

    // Detect token programs by checking the owner of the token accounts
    // Token accounts are owned by their respective token programs (Token or Token 2022)
    // If account is owned by Token 2022 Program, use Token 2022 for transfers
    // If account is owned by standard Token Program, use standard Token for transfers
    let src_token_account_owner = ctx.accounts.user_src.to_account_info().owner;
    let dst_token_account_owner = ctx.accounts.user_dst.to_account_info().owner;
    
    // Also check vault owners to ensure consistency
    let src_vault_owner = ctx.accounts.vault_src.to_account_info().owner;
    let dst_vault_owner = ctx.accounts.vault_dst.to_account_info().owner;
    
    // Use vault owners for determining token program (more reliable)
    let src_mint_program = src_vault_owner;
    let dst_mint_program = dst_vault_owner;
    
    // Verify token_2022_program if needed
    if is_token_2022(&src_mint_program) || is_token_2022(&dst_mint_program) {
        require!(
            ctx.accounts.token_2022_program.key().to_string() == crate::utils::TOKEN_2022_PROGRAM_ID,
            ErrorCode::InvalidTreasury
        );
    }
    
    // Helper function to get the correct token program account info
    // We'll inline this in each transfer call to avoid lifetime issues

    // output_amount -> user_dst
    let pool_state_key = ctx.accounts.pool_state.key();
    let (_, bump) = Pubkey::find_program_address(
        &[b"authority", pool_state_key.as_ref()],
        ctx.program_id
    );
    let pda_sign = &[b"authority", pool_state_key.as_ref(), &[bump]];
    
    // Transfer output to user (after protocol fee deduction if XNT output and treasury valid)
    // Note: Token 2022 transfer fees are handled automatically by the program
    let dst_program = if is_token_2022(&dst_mint_program) {
        ctx.accounts.token_2022_program.to_account_info()
    } else {
        ctx.accounts.token_program.to_account_info()
    };
    crate::utils::transfer_tokens_signed(
        ctx.accounts.vault_dst.to_account_info(),
        ctx.accounts.user_dst.to_account_info(),
        ctx.accounts.pool_authority.to_account_info(),
        dst_program,
        final_output_amount as u64,
        &[pda_sign],
    )?;
    
    // Protocol fee ALWAYS sent as NATIVE XNT (not wrapped) directly to treasury wallet
    // For regular pools with wrapped XNT, we transfer wrapped XNT to treasury's wrapped XNT account,
    // but the treasury should unwrap it. However, the preferred approach is to use native pools.
    
    // If protocol fee deducted from output (Token → XNT swap)
    if is_output_xnt && protocol_fee_xnt > 0 && pool_state.protocol_treasury != Pubkey::default() {
        // Transfer wrapped XNT fee to treasury's wrapped XNT account
        // Treasury will receive wrapped XNT, which can be unwrapped to native XNT
        // NOTE: For true native XNT only, use native pools instead of regular pools
        let dst_program_fee = if is_token_2022(&dst_mint_program) {
            ctx.accounts.token_2022_program.to_account_info()
        } else {
            ctx.accounts.token_program.to_account_info()
        };
        crate::utils::transfer_tokens_signed(
            ctx.accounts.vault_dst.to_account_info(),
            ctx.accounts.protocol_treasury_ata.to_account_info(),
            ctx.accounts.pool_authority.to_account_info(),
            dst_program_fee,
            protocol_fee_xnt as u64,
            &[pda_sign],
        )?;
        
// msg!("💰 Protocol fee: {} wrapped XNT sent to treasury (can be unwrapped to native XNT)", protocol_fee_xnt);
    }

    // Transfer protocol fee from input if swapping FROM XNT
    if is_input_xnt && protocol_fee_xnt > 0 && pool_state.protocol_treasury != Pubkey::default() {
        // Transfer wrapped XNT fee from user to treasury's wrapped XNT account
        // Treasury will receive wrapped XNT, which can be unwrapped to native XNT
        // NOTE: For true native XNT only, use native pools instead of regular pools
        let src_program_fee = if is_token_2022(&src_mint_program) {
            ctx.accounts.token_2022_program.to_account_info()
        } else {
            ctx.accounts.token_program.to_account_info()
        };
        crate::utils::transfer_tokens(
            ctx.accounts.user_src.to_account_info(),
            ctx.accounts.protocol_treasury_ata.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            src_program_fee,
            protocol_fee_xnt as u64,
        )?;
        
// msg!("💰 Protocol fee: {} wrapped XNT sent to treasury (can be unwrapped to native XNT)", protocol_fee_xnt);
    }
    
    // Transfer input to vault (after protocol fee deduction if XNT input)
    // Note: Token 2022 transfer fees are handled automatically by the program
    let src_program = if is_token_2022(&src_mint_program) {
        ctx.accounts.token_2022_program.to_account_info()
    } else {
        ctx.accounts.token_program.to_account_info()
    };
    crate::utils::transfer_tokens(
        ctx.accounts.user_src.to_account_info(),
        ctx.accounts.vault_src.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        src_program,
        final_amount_to_vault as u64,
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct Swap<'info> {

    // pool token accounts 
    // Use UncheckedAccount and manual deserialization for backward compatibility
    #[account(mut)]
    /// CHECK: Pool state - manually deserialized for backward compatibility
    pub pool_state: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: Pool authority PDA - verified in handler
    pub pool_authority: AccountInfo<'info>,
    /// CHECK: Vault can be Token or Token2022, validated in handler
    #[account(mut)]
    pub vault_src: UncheckedAccount<'info>,
    /// CHECK: Vault can be Token or Token2022, validated in handler
    #[account(mut)]
    pub vault_dst: UncheckedAccount<'info>,
    
    // user token accounts 
    /// CHECK: User token account, validated in handler
    #[account(mut)]
    pub user_src: UncheckedAccount<'info>,
    /// CHECK: User token account, validated in handler
    #[account(mut)]
    pub user_dst: UncheckedAccount<'info>, 
    pub owner: Signer<'info>,

    // Protocol treasury ATA (optional - only used if treasury is configured)
    // Use UncheckedAccount because it may be created in the same transaction
    // We'll verify it exists and is valid in the handler before using it
    #[account(mut)]
    /// CHECK: Protocol treasury ATA - verified in handler, may not exist yet
    pub protocol_treasury_ata: UncheckedAccount<'info>,

    // other 
    pub token_program: Program<'info, Token>,
    /// CHECK: Token 2022 program - verified in handler
    pub token_2022_program: UncheckedAccount<'info>,
}
