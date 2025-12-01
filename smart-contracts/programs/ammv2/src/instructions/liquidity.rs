use anchor_lang::prelude::*;
use anchor_spl::{
    token,
    token::{Mint, MintTo, Token, TokenAccount, Transfer, Burn},
};
use anchor_spl::token::spl_token::state::Account as TokenAccountState;
use spl_token_2022::state::Account as Token2022AccountState;
use spl_token_2022::extension::StateWithExtensions;
use anchor_lang::solana_program::program_pack::Pack;

use crate::state::PoolState;
use crate::error::ErrorCode;
use crate::utils::{is_token_2022, get_token_program_account};

pub fn add_liquidity(
    ctx: Context<LiquidityOperation>, 
    amount_liq0: u64, // amount of token0 
    // amount of token1
        // note: only needed on pool init deposit 
        // ... can derive it once exchange is up
    amount_liq1: u64, 
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
    
    // Deserialize user accounts
    let user0_data = ctx.accounts.user0.to_account_info();
    let user0_account = unpack_token_account(&user0_data, "user0")?;
    
    let user1_data = ctx.accounts.user1.to_account_info();
    let user1_account = unpack_token_account(&user1_data, "user1")?;
    
    // Deserialize vaults
    let vault0_data = ctx.accounts.vault0.to_account_info();
    let vault0_account = unpack_token_account(&vault0_data, "vault0")?;
    
    let vault1_data = ctx.accounts.vault1.to_account_info();
    let vault1_account = unpack_token_account(&vault1_data, "vault1")?;
    
    // Validate owner
    require!(user0_account.owner == ctx.accounts.owner.key(), ErrorCode::NotEnoughBalance);
    require!(user1_account.owner == ctx.accounts.owner.key(), ErrorCode::NotEnoughBalance);
    
    // Validate mint matches (user0 mint should match vault0 mint)
    require!(user0_account.mint == vault0_account.mint, ErrorCode::InvalidTreasury);
    require!(user1_account.mint == vault1_account.mint, ErrorCode::InvalidTreasury);
    
    let user_balance0 = user0_account.amount; 
    let user_balance1 = user1_account.amount;
    let vault_balance0 = vault0_account.amount;
    let vault_balance1 = vault1_account.amount;

    // ensure enough balance 
    require!(amount_liq0 <= user_balance0, ErrorCode::NotEnoughBalance);
    require!(amount_liq1 <= user_balance1, ErrorCode::NotEnoughBalance);
    let pool_state = &mut ctx.accounts.pool_state; 
    
    let deposit0 = amount_liq0;
    // vars to fill out during if statement  
    let deposit1; 
    let amount_to_mint;
    
    // initial deposit
// msg!("vaults: {} {}", vault_balance0, vault_balance1);
// msg!("init deposits: {} {}", amount_liq0, amount_liq1);

    if vault_balance0 == 0 && vault_balance1 == 0 {
        // bit shift (a + b)/2
        amount_to_mint = (amount_liq0 + amount_liq1) >> 1; 
        deposit1 = amount_liq1;
    } else { 
        // require equal amount deposit based on pool exchange rate 
        let exchange10 = vault_balance1.checked_div(vault_balance0).unwrap();
        let amount_deposit_1 = amount_liq0.checked_mul(exchange10).unwrap();
// msg!("new deposits: {} {} {}", exchange10, amount_liq0, amount_deposit_1);

        // enough funds + user is ok with it in single check 
        require!(amount_deposit_1 <= amount_liq1, ErrorCode::NotEnoughBalance);
        deposit1 = amount_deposit_1; // update liquidity amount ! 

        // mint = relative to the entire pool + total amount minted 
        // u128 so we can do multiply first without overflow 
        // then div and recast back 
        amount_to_mint = (
            (deposit1 as u128)
            .checked_mul(pool_state.total_amount_minted as u128).unwrap()
            .checked_div(vault_balance1 as u128).unwrap()
        ) as u64;

// msg!("pmint: {}", amount_to_mint);
    }

    // saftey checks 
    require!(amount_to_mint > 0, ErrorCode::NoPoolMintOutput);

    // Detect token programs by checking the token account's owner
    // Token accounts are owned by their respective token programs (Token or Token 2022)
    // If account is owned by Token 2022 Program, use Token 2022 for transfers
    // If account is owned by standard Token Program, use standard Token for transfers
    let user0_account_owner = ctx.accounts.user0.to_account_info().owner;
    let user1_account_owner = ctx.accounts.user1.to_account_info().owner;
    
    let mint0_program = user0_account_owner;
    let mint1_program = user1_account_owner;
    
    // Verify token_2022_program if needed
    if is_token_2022(&mint0_program) || is_token_2022(&mint1_program) {
        require!(
            ctx.accounts.token_2022_program.key().to_string() == crate::utils::TOKEN_2022_PROGRAM_ID,
            ErrorCode::InvalidTreasury
        );
    }
    
    // Get appropriate token program accounts for user tokens

    // give pool_mints (pool mint always uses standard Token program)
    pool_state.total_amount_minted += amount_to_mint;
    let mint_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(), 
        MintTo {
            to: ctx.accounts.user_pool_ata.to_account_info(),
            mint: ctx.accounts.pool_mint.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        }
    );
    let bump = ctx.bumps.pool_authority;
    let pool_key = ctx.accounts.pool_state.key();
    let pda_sign = &[b"authority", pool_key.as_ref(), &[bump]];
    token::mint_to(
        mint_ctx.with_signer(&[pda_sign]), 
        amount_to_mint
    )?;
    
    // deposit user funds into vaults (using appropriate token program)
    // Note: Token 2022 transfer fees are handled automatically by the program
    let token0_program = if is_token_2022(&mint0_program) {
        ctx.accounts.token_2022_program.to_account_info()
    } else {
        ctx.accounts.token_program.to_account_info()
    };
    crate::utils::transfer_tokens(
        ctx.accounts.user0.to_account_info(),
        ctx.accounts.vault0.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        token0_program,
        deposit0,
    )?;

    let token1_program = if is_token_2022(&mint1_program) {
        ctx.accounts.token_2022_program.to_account_info()
    } else {
        ctx.accounts.token_program.to_account_info()
    };
    crate::utils::transfer_tokens(
        ctx.accounts.user1.to_account_info(),
        ctx.accounts.vault1.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        token1_program,
        deposit1,
    )?;

    Ok(())
}

pub fn remove_liquidity(
    ctx: Context<LiquidityOperation>, 
    burn_amount: u64,
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
    
    // Deserialize user_pool_ata (LP tokens are always Token Program)
    let user_pool_ata_data = ctx.accounts.user_pool_ata.to_account_info();
    let user_pool_ata_account = unpack_token_account(&user_pool_ata_data, "user_pool_ata")?;
    
    // Validate owner and mint
    require!(user_pool_ata_account.owner == ctx.accounts.owner.key(), ErrorCode::NotEnoughBalance);
    require!(user_pool_ata_account.mint == ctx.accounts.pool_mint.key(), ErrorCode::InvalidTreasury);
    
    let pool_mint_balance = user_pool_ata_account.amount; 
    require!(burn_amount <= pool_mint_balance, ErrorCode::NotEnoughBalance);

    let pool_key = ctx.accounts.pool_state.key();
    let state = &mut ctx.accounts.pool_state;
    require!(state.total_amount_minted >= burn_amount, ErrorCode::BurnTooMuch);
    
    // Deserialize vaults
    let vault0_data = ctx.accounts.vault0.to_account_info();
    let vault0_account = unpack_token_account(&vault0_data, "vault0 (remove_liquidity)")?;
    
    let vault1_data = ctx.accounts.vault1.to_account_info();
    let vault1_account = unpack_token_account(&vault1_data, "vault1 (remove_liquidity)")?;
    
    let vault0_amount = vault0_account.amount as u128;
    let vault1_amount = vault1_account.amount as u128;
    let u128_burn_amount = burn_amount as u128;

    // compute how much to give back 
    let [amount0, amount1] = [
        u128_burn_amount
            .checked_mul(vault0_amount).unwrap()
            .checked_div(state.total_amount_minted as u128).unwrap() as u64,
        u128_burn_amount
            .checked_mul(vault1_amount).unwrap()
            .checked_div(state.total_amount_minted as u128).unwrap() as u64
    ];

    // Detect token programs by checking the token account's owner
    // Token accounts are owned by their respective token programs (Token or Token 2022)
    // Vault accounts are owned by the Token Program that created their mints
    let vault0_account_owner = ctx.accounts.vault0.to_account_info().owner;
    let vault1_account_owner = ctx.accounts.vault1.to_account_info().owner;
    
    let mint0_program = vault0_account_owner;
    let mint1_program = vault1_account_owner;
    
    // Verify token_2022_program if needed
    if is_token_2022(&mint0_program) || is_token_2022(&mint1_program) {
        require!(
            ctx.accounts.token_2022_program.key().to_string() == crate::utils::TOKEN_2022_PROGRAM_ID,
            ErrorCode::InvalidTreasury
        );
    }
    
    // deposit user funds into vaults (using appropriate token program)
    // Note: Token 2022 transfer fees are handled automatically by the program
    let bump = ctx.bumps.pool_authority;
    let pda_sign = &[b"authority", pool_key.as_ref(), &[bump]];
    
    let token0_program = if is_token_2022(&mint0_program) {
        ctx.accounts.token_2022_program.to_account_info()
    } else {
        ctx.accounts.token_program.to_account_info()
    };
    crate::utils::transfer_tokens_signed(
        ctx.accounts.vault0.to_account_info(),
        ctx.accounts.user0.to_account_info(),
        ctx.accounts.pool_authority.to_account_info(),
        token0_program,
        amount0,
        &[pda_sign],
    )?;

    let token1_program = if is_token_2022(&mint1_program) {
        ctx.accounts.token_2022_program.to_account_info()
    } else {
        ctx.accounts.token_program.to_account_info()
    };
    crate::utils::transfer_tokens_signed(
        ctx.accounts.vault1.to_account_info(),
        ctx.accounts.user1.to_account_info(),
        ctx.accounts.pool_authority.to_account_info(),
        token1_program,
        amount1,
        &[pda_sign],
    )?;

    // burn pool tokens (pool mint always uses standard Token program)
    token::burn(CpiContext::new(
        ctx.accounts.token_program.to_account_info(), 
        Burn { 
            mint: ctx.accounts.pool_mint.to_account_info(), 
            from: ctx.accounts.user_pool_ata.to_account_info(), 
            authority:  ctx.accounts.owner.to_account_info(),
        }
    ), burn_amount)?;

    state.total_amount_minted -= burn_amount; 

    Ok(())
}

#[derive(Accounts)]
pub struct LiquidityOperation<'info> {

    // pool token accounts 
    #[account(mut)]
    pub pool_state: Box<Account<'info, PoolState>>,
    
    #[account(seeds=[b"authority", pool_state.key().as_ref()], bump)]
    pub pool_authority: AccountInfo<'info>,
    /// CHECK: Vault can be Token or Token2022, validated in handler
    #[account(mut, seeds=[b"vault0", pool_state.key().as_ref()], bump)]
    pub vault0: UncheckedAccount<'info>, 
    /// CHECK: Vault can be Token or Token2022, validated in handler
    #[account(mut, seeds=[b"vault1", pool_state.key().as_ref()], bump)]
    pub vault1: UncheckedAccount<'info>,
    #[account(mut, seeds=[b"pool_mint", pool_state.key().as_ref()], bump)]
    pub pool_mint: Box<Account<'info, Mint>>,  
    
    // user token accounts - can be Token or Token2022
    /// CHECK: User token account, validated in handler
    #[account(mut)]
    pub user0: UncheckedAccount<'info>, 
    /// CHECK: User token account, validated in handler
    #[account(mut)]
    pub user1: UncheckedAccount<'info>, 
    /// CHECK: User LP token account, validated in handler
    #[account(mut)]
    pub user_pool_ata: UncheckedAccount<'info>, 
    pub owner: Signer<'info>,

    // other 
    pub token_program: Program<'info, Token>,
    /// CHECK: Token 2022 program - verified in handler
    pub token_2022_program: UncheckedAccount<'info>,
}
