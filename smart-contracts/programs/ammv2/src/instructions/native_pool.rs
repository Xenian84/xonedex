use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn};
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::spl_token::instruction::initialize_account3 as initialize_account3_token;
use spl_token_2022::instruction::initialize_account3 as initialize_account3_token2022;
use crate::state::PoolState;
use crate::error::ErrorCode;
use crate::utils::{is_token, is_token_2022};

// Placeholder for native mint detection (System Program ID)
// We use this to indicate "this is native XNT, not an SPL token"
pub const NATIVE_MINT_PLACEHOLDER: Pubkey = Pubkey::new_from_array([0; 32]);

/// Initialize a new native XNT pool (XNT + SPL Token)
pub fn initialize_native_pool(
    ctx: Context<InitializeNativePool>,
    fee_numerator: u64,
    fee_denominator: u64,
    protocol_treasury: Pubkey,
    protocol_fee_bps: u16,
    native_mint_index: u8, // 0 = XNT is token0, 1 = XNT is token1
) -> Result<()> {
    require!(native_mint_index <= 1, ErrorCode::InvalidInput);
    require!(fee_denominator > 0, ErrorCode::InvalidInput);
    require!(protocol_fee_bps <= 10000, ErrorCode::InvalidInput); // Max 100%

    // Validate token_mint is owned by Token or Token2022 program
    let token_mint_owner = ctx.accounts.token_mint.to_account_info().owner;
    require!(
        is_token(&token_mint_owner) || is_token_2022(&token_mint_owner),
        ErrorCode::InvalidTreasury
    );
    
    // Verify token_2022_program if needed
    if is_token_2022(&token_mint_owner) {
        require!(
            ctx.accounts.token_2022_program.key().to_string() == crate::utils::TOKEN_2022_PROGRAM_ID,
            ErrorCode::InvalidTreasury
        );
    }
    
    // Validate mint data size (minimum 82 bytes for a mint account)
    require!(
        ctx.accounts.token_mint.to_account_info().data_len() >= 82,
        ErrorCode::InvalidTreasury
    );

    let pool_state_key = ctx.accounts.pool_state.key();
    
    // Derive vault PDA
    let (vault_pda, vault_bump) = Pubkey::find_program_address(
        &[b"vault", pool_state_key.as_ref()],
        ctx.program_id,
    );
    
    require!(
        vault_pda == ctx.accounts.token_vault.key(),
        ErrorCode::InvalidTreasury
    );
    
    let vault_seeds = &[
        b"vault",
        pool_state_key.as_ref(),
        &[vault_bump],
    ];
    
    // Determine which token program to use
    let vault_token_program_id = if is_token_2022(&token_mint_owner) {
        ctx.accounts.token_2022_program.key()
    } else {
        ctx.accounts.token_program.key()
    };
    
// msg!("token_mint_program: {:?}", token_mint_owner);
// msg!("is_token_2022: {}", is_token_2022(&token_mint_owner));
// msg!("vault_token_program_id: {:?}", vault_token_program_id);
    
    // Calculate rent for TokenAccount (165 bytes)
    let rent = anchor_lang::solana_program::rent::Rent::get()?;
    let rent_lamports = rent.minimum_balance(165);
    
    // Create and initialize token vault
    {
        let vault_info = ctx.accounts.token_vault.to_account_info();
        let vault_lamports = vault_info.lamports();
        
        if vault_lamports == 0 {
// msg!("Creating token vault");
            
            // Step 1: Transfer lamports for rent
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.token_vault.to_account_info(),
                    },
                ),
                rent_lamports,
            )?;
            
            // Step 2: Allocate space
            invoke_signed(
                &system_instruction::allocate(
                    ctx.accounts.token_vault.key,
                    165,
                ),
                &[ctx.accounts.token_vault.to_account_info()],
                &[vault_seeds],
            )?;
            
            // Step 3: Assign to token program
            invoke_signed(
                &system_instruction::assign(
                    ctx.accounts.token_vault.key,
                    &vault_token_program_id,
                ),
                &[ctx.accounts.token_vault.to_account_info()],
                &[vault_seeds],
            )?;
            
            // Step 4: Initialize as TokenAccount
            let init_account_ix = if is_token_2022(&token_mint_owner) {
                initialize_account3_token2022(
                    &vault_token_program_id,
                    ctx.accounts.token_vault.key,
                    ctx.accounts.token_mint.key,
                    ctx.accounts.pool_authority.key,
                )?
            } else {
                initialize_account3_token(
                    &vault_token_program_id,
                    ctx.accounts.token_vault.key,
                    ctx.accounts.token_mint.key,
                    ctx.accounts.pool_authority.key,
                )?
            };
            
            let token_program_account = if is_token_2022(&token_mint_owner) {
                ctx.accounts.token_2022_program.to_account_info()
            } else {
                ctx.accounts.token_program.to_account_info()
            };
            
            anchor_lang::solana_program::program::invoke(
                &init_account_ix,
                &[
                    ctx.accounts.token_vault.to_account_info(),
                    ctx.accounts.token_mint.to_account_info(),
                    ctx.accounts.pool_authority.to_account_info(),
                    token_program_account,
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
            
// msg!("token_vault initialized");
        }
    }

    let pool_state = &mut ctx.accounts.pool_state;
    pool_state.total_amount_minted = 0;
    pool_state.fee_numerator = fee_numerator;
    pool_state.fee_denominator = fee_denominator;
    pool_state.protocol_treasury = protocol_treasury;
    pool_state.protocol_fee_bps = protocol_fee_bps;
    
    // Native pool specific fields
    pool_state.is_native_pool = true;
    pool_state.native_reserve = 0; // Will be set when liquidity is added
    pool_state.native_mint_index = native_mint_index;
    
// msg!("✅ Native XNT pool initialized");
// msg!("   Fee: {}/{} ({:.2}%)", fee_numerator, fee_denominator, 
//         (fee_numerator as f64 / fee_denominator as f64) * 100.0);
// msg!("   Protocol fee: {} bps ({:.2}%)", protocol_fee_bps, protocol_fee_bps as f64 / 100.0);
// msg!("   Native position: {}", if native_mint_index == 0 { "token0 (XNT)" } else { "token1 (XNT)" });
    
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeNativePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// The pool state account - stores pool configuration and reserves
    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<PoolState>(),
        seeds = [b"pool", token_mint.key().as_ref()],
        bump
    )]
    pub pool_state: Account<'info, PoolState>,
    
    /// The SPL token mint (supports both Token and Token2022)
    /// CHECK: We manually validate this is a valid mint (Token or Token2022)
    pub token_mint: UncheckedAccount<'info>,
    
    /// Token vault account - stores the SPL tokens
    /// CHECK: We manually initialize this as a token account
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    
    /// LP (liquidity provider) token mint
    #[account(
        init,
        payer = payer,
        seeds = [b"lp_mint", pool_state.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = pool_authority
    )]
    pub lp_mint: Account<'info, Mint>,
    
    /// Pool authority PDA (can sign on behalf of pool)
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [b"authority", pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    /// CHECK: Token-2022 program
    pub token_2022_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Add liquidity to a native XNT pool
pub fn add_native_liquidity(
    ctx: Context<AddNativeLiquidity>,
    xnt_amount: u64,
    token_amount: u64,
    min_lp_tokens: u64,
) -> Result<()> {
// msg!("🔵 add_native_liquidity called");
// msg!("  xnt_amount: {}", xnt_amount);
// msg!("  token_amount: {}", token_amount);
    
    // Get pool state key BEFORE taking mutable borrow
    let pool_state_key = ctx.accounts.pool_state.key();
    let pool_state = &mut ctx.accounts.pool_state;
    
// msg!("  pool_state.is_native_pool: {}", pool_state.is_native_pool);
    
    require!(pool_state.is_native_pool, ErrorCode::NotNativePool);
    require!(xnt_amount > 0 && token_amount > 0, ErrorCode::InvalidInput);
    
    // Determine which token program to use
    let token_vault_info = ctx.accounts.token_vault.to_account_info();
    let is_token_2022 = *token_vault_info.owner == spl_token_2022::ID;
    
    // Get token vault balance
    let token_vault_data = token_vault_info.try_borrow_data()?;
    let token_vault_balance = u64::from_le_bytes(
        token_vault_data[64..72]
            .try_into()
            .map_err(|_| ErrorCode::InvalidAccountData)?
    );
    drop(token_vault_data);
    
    // Calculate LP tokens to mint
    let lp_to_mint = if pool_state.total_amount_minted == 0 {
        // First liquidity provider - use geometric mean
        ((xnt_amount as u128 * token_amount as u128).integer_sqrt() as u64)
            .checked_sub(1000) // Minimum liquidity locked
            .ok_or(ErrorCode::InsufficientLiquidity)?
    } else {
        // Subsequent providers - proportional to existing reserves
        let native_reserve = pool_state.native_reserve;
        
        let lp_from_xnt = (xnt_amount as u128)
            .checked_mul(pool_state.total_amount_minted as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(native_reserve as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;
            
        let lp_from_token = (token_amount as u128)
            .checked_mul(pool_state.total_amount_minted as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(token_vault_balance as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;
        
        // Use minimum to maintain ratio
        std::cmp::min(lp_from_xnt, lp_from_token)
    };
    
    require!(lp_to_mint >= min_lp_tokens, ErrorCode::SlippageExceeded);
    
    // Transfer native XNT to pool PDA
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        anchor_lang::system_program::Transfer {
            from: ctx.accounts.user.to_account_info(),
            to: ctx.accounts.pool_pda.to_account_info(),
        },
    );
    anchor_lang::system_program::transfer(cpi_context, xnt_amount)?;
    
    // Transfer SPL tokens to vault (use correct instruction based on token type)
    if is_token_2022 {
        // Use Token2022 instruction
        let transfer_ix = spl_token_2022::instruction::transfer(
            &spl_token_2022::ID,
            ctx.accounts.user_token_account.to_account_info().key,
            ctx.accounts.token_vault.to_account_info().key,
            ctx.accounts.user.to_account_info().key,
            &[],
            token_amount,
        )?;
        
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.user_token_account.to_account_info(),
                ctx.accounts.token_vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.token_2022_program.to_account_info(),
            ],
        )?;
    } else {
        // Use standard Token Program instruction
        let transfer_ix = spl_token::instruction::transfer(
            &spl_token::ID,
            ctx.accounts.user_token_account.to_account_info().key,
            ctx.accounts.token_vault.to_account_info().key,
            ctx.accounts.user.to_account_info().key,
            &[],
            token_amount,
        )?;
        
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.user_token_account.to_account_info(),
                ctx.accounts.token_vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;
    }
    
    // Mint LP tokens to user
    let authority_seeds = &[
        b"authority",
        pool_state_key.as_ref(),
        &[ctx.bumps.pool_authority],
    ];
    let signer_seeds = &[&authority_seeds[..]];
    
    let mint_accounts = token::MintTo {
        mint: ctx.accounts.lp_mint.to_account_info(),
        to: ctx.accounts.user_lp_account.to_account_info(),
        authority: ctx.accounts.pool_authority.to_account_info(),
    };
    let mint_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        mint_accounts,
        signer_seeds,
    );
    token::mint_to(mint_ctx, lp_to_mint)?;
    
    // Update pool state - calculate new values first
    let new_native_reserve = pool_state.native_reserve
        .checked_add(xnt_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    let new_total_minted = pool_state.total_amount_minted
        .checked_add(lp_to_mint)
        .ok_or(ErrorCode::MathOverflow)?;
    
    // CRITICAL: Manually serialize to ensure changes are persisted (Anchor auto-serialization buggy for custom layouts)
    {
        let pool_state_info = ctx.accounts.pool_state.to_account_info();
        let mut data = pool_state_info.try_borrow_mut_data()?;
        
        // Write total_amount_minted at offset 8
        data[8..16].copy_from_slice(&new_total_minted.to_le_bytes());
        
        // Write native_reserve at offset 68 (8 + 8 + 8 + 8 + 32 + 2 + 1 + 1)
        let reserve_offset = 68;
        data[reserve_offset..reserve_offset + 8].copy_from_slice(&new_native_reserve.to_le_bytes());
    } // Drop data here
    
    // Update Rust struct too (for consistency in same transaction)
    ctx.accounts.pool_state.native_reserve = new_native_reserve;
    ctx.accounts.pool_state.total_amount_minted = new_total_minted;
    
// msg!("✅ Added native liquidity: {} XNT + {} tokens → {} LP", xnt_amount, token_amount, lp_to_mint);
// msg!("   native_reserve updated to: {}", new_native_reserve);
    
    Ok(())
}

#[derive(Accounts)]
pub struct AddNativeLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub pool_state: Account<'info, PoolState>,
    
    /// Pool PDA that holds native XNT
    /// CHECK: This is a PDA
    #[account(
        mut,
        seeds = [b"pool_pda", pool_state.key().as_ref()],
        bump
    )]
    pub pool_pda: UncheckedAccount<'info>,
    
    /// Token vault - can be Token or Token2022
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    
    /// User's token account - can be Token or Token2022
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,
    
    /// User's LP token account - can be freshly created
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub user_lp_account: UncheckedAccount<'info>,
    
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [b"authority", pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    /// CHECK: Token-2022 program (optional, used for Token2022 tokens)
    pub token_2022_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Swap in a native XNT pool (XNT ↔ Token)
pub fn swap_native(
    ctx: Context<SwapNative>,
    amount_in: u64,
    min_amount_out: u64,
    is_xnt_to_token: bool,
) -> Result<()> {
    // Get pool state key and data_len BEFORE taking mutable borrow
    let pool_state_key = ctx.accounts.pool_state.key();
    let pool_state_data_len = ctx.accounts.pool_state.to_account_info().data_len();
    let pool_state = &mut ctx.accounts.pool_state;
    
    require!(pool_state.is_native_pool, ErrorCode::NotNativePool);
    require!(amount_in > 0, ErrorCode::InvalidInput);
    
    // Determine which token program to use
    let token_vault_info = ctx.accounts.token_vault.to_account_info();
    let is_token_2022 = *token_vault_info.owner == spl_token_2022::ID;
    
    // Get token vault balance
    let token_vault_data = token_vault_info.try_borrow_data()?;
    let token_vault_balance = u64::from_le_bytes(
        token_vault_data[64..72]
            .try_into()
            .map_err(|_| ErrorCode::InvalidAccountData)?
    );
    drop(token_vault_data);
    
    let (reserve_in, reserve_out) = if is_xnt_to_token {
        // XNT → Token
        (pool_state.native_reserve, token_vault_balance)
    } else {
        // Token → XNT
        (token_vault_balance, pool_state.native_reserve)
    };
    
    // Calculate LP fee (total fee - protocol fee)
    // LP fee = fee_numerator/fee_denominator (e.g., 3/1000 = 0.3%)
    // Protocol fee is separate and calculated as protocol_fee_bps% of XNT amount
    
    // Calculate swap output using LP fee only (protocol fee handled separately)
    let amount_out = calculate_swap_output(
        amount_in,
        reserve_in,
        reserve_out,
        pool_state.fee_numerator,
        pool_state.fee_denominator,
    )?;
    
    // Calculate protocol fee in XNT
    // Protocol fee = protocol_fee_bps% of XNT amount involved in swap
    let xnt_amount_for_fee = if is_xnt_to_token {
        amount_in // XNT input
    } else {
        amount_out // XNT output
    };
    
    let protocol_fee_xnt = if pool_state.protocol_treasury != Pubkey::default() 
        && pool_state.protocol_fee_bps > 0 
        && xnt_amount_for_fee > 0 {
        (xnt_amount_for_fee as u128)
            .checked_mul(pool_state.protocol_fee_bps as u128)
            .and_then(|x| x.checked_div(10000))
            .and_then(|x| u64::try_from(x).ok())
            .unwrap_or(0)
    } else {
        0
    };
    
    // Adjust amounts based on protocol fee
    let final_amount_out = if is_xnt_to_token {
        // XNT → Token: protocol fee deducted from input, output stays same
        amount_out
    } else {
        // Token → XNT: protocol fee deducted from output
        amount_out.checked_sub(protocol_fee_xnt).ok_or(ErrorCode::MathOverflow)?
    };
    
    let final_amount_in = if is_xnt_to_token {
        // XNT → Token: protocol fee deducted from input
        amount_in.checked_sub(protocol_fee_xnt).ok_or(ErrorCode::MathOverflow)?
    } else {
        // Token → XNT: input stays same
        amount_in
    };
    
    require!(final_amount_out >= min_amount_out, ErrorCode::SlippageExceeded);
    
    if is_xnt_to_token {
        // XNT → Token swap
        
        // 1. Transfer protocol fee to treasury (if applicable)
        if protocol_fee_xnt > 0 && pool_state.protocol_treasury != Pubkey::default() {
            let treasury_transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
                ctx.accounts.user.key,
                &pool_state.protocol_treasury,
                protocol_fee_xnt,
            );
            
            anchor_lang::solana_program::program::invoke(
                &treasury_transfer_ix,
                &[
                    ctx.accounts.user.to_account_info(),
                    ctx.accounts.protocol_treasury.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
            
// msg!("💰 Protocol fee: {} XNT sent to treasury", protocol_fee_xnt);
        }
        
        // 2. Transfer XNT from user to pool PDA (after protocol fee deduction)
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.pool_pda.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, final_amount_in)?;
        
        // 3. Transfer tokens from vault to user (use correct instruction based on token type)
        let authority_seeds = &[
            b"authority",
            pool_state_key.as_ref(),
            &[ctx.bumps.pool_authority],
        ];
        let signer_seeds = &[&authority_seeds[..]];
        
        if is_token_2022 {
            let transfer_ix = spl_token_2022::instruction::transfer(
                &spl_token_2022::ID,
                ctx.accounts.token_vault.to_account_info().key,
                ctx.accounts.user_token_account.to_account_info().key,
                ctx.accounts.pool_authority.to_account_info().key,
                &[],
                amount_out,
            )?;
            
            anchor_lang::solana_program::program::invoke_signed(
                &transfer_ix,
                &[
                    ctx.accounts.token_vault.to_account_info(),
                    ctx.accounts.user_token_account.to_account_info(),
                    ctx.accounts.pool_authority.to_account_info(),
                    ctx.accounts.token_2022_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        } else {
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                ctx.accounts.token_vault.to_account_info().key,
                ctx.accounts.user_token_account.to_account_info().key,
                ctx.accounts.pool_authority.to_account_info().key,
                &[],
                amount_out,
            )?;
            
            anchor_lang::solana_program::program::invoke_signed(
                &transfer_ix,
                &[
                    ctx.accounts.token_vault.to_account_info(),
                    ctx.accounts.user_token_account.to_account_info(),
                    ctx.accounts.pool_authority.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }
        
        // 4. Update native reserve with manual serialization (use final_amount_in after protocol fee)
        let new_native_reserve = pool_state.native_reserve
            .checked_add(final_amount_in)
            .ok_or(ErrorCode::MathOverflow)?;
        
        {
            let pool_state_info = ctx.accounts.pool_state.to_account_info();
            let mut data = pool_state_info.try_borrow_mut_data()?;
            let reserve_offset = 68;
            data[reserve_offset..reserve_offset + 8].copy_from_slice(&new_native_reserve.to_le_bytes());
        }
        
        ctx.accounts.pool_state.native_reserve = new_native_reserve;
        
// msg!("✅ Swapped {} XNT → {} tokens (protocol fee: {} XNT)", final_amount_in, final_amount_out, protocol_fee_xnt);
    } else {
        // Token → XNT swap
        
        // 1. Transfer tokens from user to vault (use correct instruction based on token type)
        if is_token_2022 {
            let transfer_ix = spl_token_2022::instruction::transfer(
                &spl_token_2022::ID,
                ctx.accounts.user_token_account.to_account_info().key,
                ctx.accounts.token_vault.to_account_info().key,
                ctx.accounts.user.to_account_info().key,
                &[],
                amount_in,
            )?;
            
            anchor_lang::solana_program::program::invoke(
                &transfer_ix,
                &[
                    ctx.accounts.user_token_account.to_account_info(),
                    ctx.accounts.token_vault.to_account_info(),
                    ctx.accounts.user.to_account_info(),
                    ctx.accounts.token_2022_program.to_account_info(),
                ],
            )?;
        } else {
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                ctx.accounts.user_token_account.to_account_info().key,
                ctx.accounts.token_vault.to_account_info().key,
                ctx.accounts.user.to_account_info().key,
                &[],
                amount_in,
            )?;
            
            anchor_lang::solana_program::program::invoke(
                &transfer_ix,
                &[
                    ctx.accounts.user_token_account.to_account_info(),
                    ctx.accounts.token_vault.to_account_info(),
                    ctx.accounts.user.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                ],
            )?;
        }
        
        // 2. CRITICAL: Check rent safety before transferring XNT out
        let rent = Rent::get()?;
        let pool_pda_info = ctx.accounts.pool_pda.to_account_info();
        let rent_minimum = rent.minimum_balance(pool_state_data_len);
        let current_lamports = pool_pda_info.lamports();
        
        require!(
            current_lamports.checked_sub(amount_out).unwrap_or(0) >= rent_minimum,
            ErrorCode::InsufficientRentReserve
        );
        
        // 3. Transfer protocol fee to treasury (if applicable) - deduct from XNT output
        if protocol_fee_xnt > 0 && pool_state.protocol_treasury != Pubkey::default() {
            let authority_seeds = &[
                b"pool_pda",
                pool_state_key.as_ref(),
                &[ctx.bumps.pool_pda],
            ];
            let signer_seeds = &[&authority_seeds[..]];
            
            let treasury_transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
                ctx.accounts.pool_pda.key,
                &pool_state.protocol_treasury,
                protocol_fee_xnt,
            );
            
            anchor_lang::solana_program::program::invoke_signed(
                &treasury_transfer_ix,
                &[
                    ctx.accounts.pool_pda.to_account_info(),
                    ctx.accounts.protocol_treasury.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
            
// msg!("💰 Protocol fee: {} XNT sent to treasury", protocol_fee_xnt);
        }
        
        // 4. Transfer XNT from pool PDA to user using System Program CPI (after protocol fee deduction)
        let authority_seeds = &[
            b"pool_pda",
            pool_state_key.as_ref(),
            &[ctx.bumps.pool_pda],
        ];
        let signer_seeds = &[&authority_seeds[..]];
        
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            ctx.accounts.pool_pda.key,
            ctx.accounts.user.key,
            final_amount_out,
        );
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.pool_pda.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        // 5. Update native reserve with manual serialization (deduct full amount_out including protocol fee)
        let new_native_reserve = pool_state.native_reserve
            .checked_sub(amount_out) // Deduct full amount_out (includes protocol fee)
            .ok_or(ErrorCode::MathOverflow)?;
        
        {
            let pool_state_info = ctx.accounts.pool_state.to_account_info();
            let mut data = pool_state_info.try_borrow_mut_data()?;
            let reserve_offset = 68;
            data[reserve_offset..reserve_offset + 8].copy_from_slice(&new_native_reserve.to_le_bytes());
        }
        
        ctx.accounts.pool_state.native_reserve = new_native_reserve;
        
// msg!("✅ Swapped {} tokens → {} XNT (protocol fee: {} XNT)", amount_in, final_amount_out, protocol_fee_xnt);
    }
    
    Ok(())
}

#[derive(Accounts)]
pub struct SwapNative<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub pool_state: Account<'info, PoolState>,
    
    /// Pool PDA that holds native XNT
    /// CHECK: This is a PDA
    #[account(
        mut,
        seeds = [b"pool_pda", pool_state.key().as_ref()],
        bump
    )]
    pub pool_pda: UncheckedAccount<'info>,
    
    /// Token vault - can be Token or Token2022
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    
    /// User's token account - can be Token or Token2022
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,
    
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [b"authority", pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    /// CHECK: Token-2022 program (optional, used for Token2022 tokens)
    pub token_2022_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    
    /// Protocol treasury account (for protocol fee collection)
    /// CHECK: This account is only used in CPI calls, may be default if no treasury
    #[account(mut)]
    pub protocol_treasury: UncheckedAccount<'info>,
}

// === HELPER FUNCTIONS ===

/// Calculate swap output using constant product formula (x * y = k)
/// Includes fee deduction
fn calculate_swap_output(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_numerator: u64,
    fee_denominator: u64,
) -> Result<u64> {
    require!(reserve_in > 0 && reserve_out > 0, ErrorCode::InsufficientLiquidity);
    
    // Deduct fee from input amount
    let amount_in_with_fee = (amount_in as u128)
        .checked_mul((fee_denominator - fee_numerator) as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(fee_denominator as u128)
        .ok_or(ErrorCode::MathOverflow)? as u64;
    
    // Calculate output: (amount_in_with_fee * reserve_out) / (reserve_in + amount_in_with_fee)
    let numerator = (amount_in_with_fee as u128)
        .checked_mul(reserve_out as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    
    let denominator = (reserve_in as u128)
        .checked_add(amount_in_with_fee as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    
    let amount_out = numerator
        .checked_div(denominator)
        .ok_or(ErrorCode::MathOverflow)? as u64;
    
    Ok(amount_out)
}

/// Reconcile native reserve with actual PDA balance
/// Call this periodically or if drift is suspected
pub fn remove_native_liquidity(ctx: Context<RemoveNativeLiquidity>, lp_amount: u64) -> Result<()> {
    let pool_state = &ctx.accounts.pool_state;
    
    require!(pool_state.is_native_pool, ErrorCode::NotNativePool);
    require!(lp_amount > 0, ErrorCode::InvalidInput);
    
    let total_supply = pool_state.total_amount_minted;
    require!(total_supply > 0, ErrorCode::InsufficientLiquidity);
    
// msg!("🔴 remove_native_liquidity called");
// msg!("  lp_amount: {}", lp_amount);
// msg!("  total_supply: {}", total_supply);
// msg!("  native_reserve: {}", pool_state.native_reserve);
    
    // Get token vault balance
    let token_vault_balance = {
        let token_vault_info = ctx.accounts.token_vault.to_account_info();
        let token_vault_data = token_vault_info.try_borrow_data()?;
        use anchor_lang::solana_program::program_pack::Pack;
        let token_account = spl_token::state::Account::unpack(&token_vault_data)?;
        token_account.amount
    };
    
    // Calculate amounts to return (pro-rata)
    let xnt_amount = (pool_state.native_reserve as u128)
        .checked_mul(lp_amount as u128)
        .and_then(|x| x.checked_div(total_supply as u128))
        .and_then(|x| u64::try_from(x).ok())
        .ok_or(ErrorCode::MathOverflow)?;
    
    let token_amount = (token_vault_balance as u128)
        .checked_mul(lp_amount as u128)
        .and_then(|x| x.checked_div(total_supply as u128))
        .and_then(|x| u64::try_from(x).ok())
        .ok_or(ErrorCode::MathOverflow)?;
    
// msg!("  xnt_to_return: {}", xnt_amount);
// msg!("  token_to_return: {}", token_amount);
    
    // Burn LP tokens (user is the authority, already a signer)
    let burn_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token::Burn {
            mint: ctx.accounts.lp_mint.to_account_info(),
            from: ctx.accounts.user_lp_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::burn(burn_ctx, lp_amount)?;
    
    // Transfer native XNT back to user using System Program CPI (raw invoke_signed)
    let pool_state_key = pool_state.key();
    let authority_seeds = &[
        b"pool_pda",
        pool_state_key.as_ref(),
        &[ctx.bumps.pool_pda],
    ];
    let signer_seeds = &[&authority_seeds[..]];
    
    // Build System Program transfer instruction manually
    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        ctx.accounts.pool_pda.key,
        ctx.accounts.user.key,
        xnt_amount,
    );
    
    anchor_lang::solana_program::program::invoke_signed(
        &transfer_ix,
        &[
            ctx.accounts.pool_pda.to_account_info(),
            ctx.accounts.user.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer_seeds,
    )?;
    
    // Transfer SPL tokens back to user (detect Token vs Token2022)
    let token_vault_owner = ctx.accounts.token_vault.to_account_info().owner;
    let is_token_2022 = *token_vault_owner == spl_token_2022::ID;
    
    // Use pool_authority seeds for token transfers (not pool_pda seeds)
    let authority_seeds_for_tokens = &[
        b"authority",
        pool_state_key.as_ref(),
        &[ctx.bumps.pool_authority],
    ];
    let signer_seeds_for_tokens = &[&authority_seeds_for_tokens[..]];
    
    if is_token_2022 {
        let transfer_ix = spl_token_2022::instruction::transfer(
            &spl_token_2022::ID,
            ctx.accounts.token_vault.to_account_info().key,
            ctx.accounts.user_token_account.to_account_info().key,
            ctx.accounts.pool_authority.to_account_info().key,
            &[],
            token_amount,
        )?;
        
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.token_vault.to_account_info(),
                ctx.accounts.user_token_account.to_account_info(),
                ctx.accounts.pool_authority.to_account_info(),
                ctx.accounts.token_2022_program.to_account_info(),
            ],
            signer_seeds_for_tokens, // Use pool_authority seeds, not pool_pda seeds!
        )?;
    } else {
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            signer_seeds_for_tokens, // Use pool_authority seeds, not pool_pda seeds!
        );
        token::transfer(transfer_ctx, token_amount)?;
    }
    
    // Update pool state with manual serialization
    let new_native_reserve = pool_state.native_reserve
        .checked_sub(xnt_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    let new_total_minted = pool_state.total_amount_minted
        .checked_sub(lp_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    
    {
        let pool_state_info = ctx.accounts.pool_state.to_account_info();
        let mut data = pool_state_info.try_borrow_mut_data()?;
        
        data[8..16].copy_from_slice(&new_total_minted.to_le_bytes());
        data[68..76].copy_from_slice(&new_native_reserve.to_le_bytes());
    }
    
    ctx.accounts.pool_state.native_reserve = new_native_reserve;
    ctx.accounts.pool_state.total_amount_minted = new_total_minted;
    
// msg!("✅ Removed native liquidity: {} LP → {} XNT + {} tokens", lp_amount, xnt_amount, token_amount);
// msg!("   native_reserve updated to: {}", new_native_reserve);
    
    Ok(())
}

#[derive(Accounts)]
pub struct RemoveNativeLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub pool_state: Account<'info, PoolState>,
    
    /// Pool PDA that holds native XNT
    /// CHECK: This is a PDA
    #[account(
        mut,
        seeds = [b"pool_pda", pool_state.key().as_ref()],
        bump
    )]
    pub pool_pda: UncheckedAccount<'info>,
    
    /// Token vault
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub token_vault: UncheckedAccount<'info>,
    
    /// User's token account
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,
    
    /// User's LP token account
    /// CHECK: We manually verify this is a valid token account
    #[account(mut)]
    pub user_lp_account: UncheckedAccount<'info>,
    
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [b"authority", pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    /// CHECK: Token-2022 program
    pub token_2022_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn recover_stuck_native_xnt(ctx: Context<RecoverStuckNativeXnt>) -> Result<()> {
    let pool_state = &ctx.accounts.pool_state;
    let pool_pda_info = ctx.accounts.pool_pda.to_account_info();
    
    require!(pool_state.is_native_pool, ErrorCode::NotNativePool);
    require!(pool_state.total_amount_minted == 0, ErrorCode::InvalidInput);
    
// msg!("🔴 Recovering stuck native XNT");
// msg!("   Pool PDA lamports: {}", pool_pda_info.lamports());
// msg!("   Total LP supply: {}", pool_state.total_amount_minted);
    
    // Calculate rent-exempt minimum for pool_state account (not pool_pda)
    let rent = Rent::get()?;
    let pool_state_data_len = ctx.accounts.pool_state.to_account_info().data_len();
    let rent_minimum = rent.minimum_balance(pool_state_data_len);
    
    // Get all lamports except rent
    let total_lamports = pool_pda_info.lamports();
    let recoverable_xnt = total_lamports
        .checked_sub(rent_minimum)
        .ok_or(ErrorCode::InsufficientRentReserve)?;
    
// msg!("   Recoverable XNT: {} ({} lamports)", recoverable_xnt, recoverable_xnt);
    
    // Transfer to recovery address using pool_pda seeds
    let pool_state_key = pool_state.key();
    let authority_seeds = &[
        b"pool_pda",
        pool_state_key.as_ref(),
        &[ctx.bumps.pool_pda],
    ];
    let signer_seeds = &[&authority_seeds[..]];
    
    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        ctx.accounts.pool_pda.key,
        ctx.accounts.recovery_address.key,
        recoverable_xnt,
    );
    
    anchor_lang::solana_program::program::invoke_signed(
        &transfer_ix,
        &[
            ctx.accounts.pool_pda.to_account_info(),
            ctx.accounts.recovery_address.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer_seeds,
    )?;
    
// msg!("✅ Recovered {} XNT to {}", recoverable_xnt, ctx.accounts.recovery_address.key);
    
    Ok(())
}

#[derive(Accounts)]
pub struct RecoverStuckNativeXnt<'info> {
    #[account(mut)]
    pub pool_state: Account<'info, PoolState>,
    
    /// Pool PDA that holds native XNT
    /// CHECK: This is a PDA
    #[account(
        mut,
        seeds = [b"pool_pda", pool_state.key().as_ref()],
        bump
    )]
    pub pool_pda: UncheckedAccount<'info>,
    
    /// Address to recover XNT to (should be user's wallet)
    /// CHECK: We trust the user to provide their own address
    #[account(mut)]
    pub recovery_address: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn reconcile_native_reserve(ctx: Context<ReconcileNativeReserve>) -> Result<()> {
    let pool_state = &mut ctx.accounts.pool_state;
    let pool_pda_info = ctx.accounts.pool_pda.to_account_info();
    
    require!(pool_state.is_native_pool, ErrorCode::NotNativePool);
    
    // Calculate actual tradeable XNT (total - rent reserve)
    let rent = Rent::get()?;
    let data_len = pool_pda_info.data_len();
    let total_lamports = pool_pda_info.lamports();
    let rent_minimum = rent.minimum_balance(data_len);
    
// msg!("🔍 Reconcile debug:");
// msg!("   Pool PDA data_len: {} bytes", data_len);
// msg!("   Total lamports: {}", total_lamports);
// msg!("   Rent minimum: {}", rent_minimum);
    
    let actual_tradeable = total_lamports
        .checked_sub(rent_minimum)
        .ok_or(ErrorCode::InsufficientRentReserve)?;
    
    // Log drift if any
    if pool_state.native_reserve != actual_tradeable {
// msg!("⚠️  Reserve drift detected!");
// msg!("   Tracked: {} XNT", pool_state.native_reserve);
// msg!("   Actual:  {} XNT", actual_tradeable);
// msg!("   Diff:    {} XNT", 
//             (actual_tradeable as i128 - pool_state.native_reserve as i128).abs());
    }
    
    // Update to actual balance
    pool_state.native_reserve = actual_tradeable;
    
// msg!("✅ Reserve reconciled: {} XNT", actual_tradeable);
    
    Ok(())
}

#[derive(Accounts)]
pub struct ReconcileNativeReserve<'info> {
    #[account(mut)]
    pub pool_state: Account<'info, PoolState>,
    
    /// Pool PDA that holds native XNT
    /// CHECK: This is a PDA
    #[account(
        seeds = [b"pool_pda", pool_state.key().as_ref()],
        bump
    )]
    pub pool_pda: UncheckedAccount<'info>,
}

/// Emergency pause for native pool (admin only)
pub fn pause_native_pool(ctx: Context<PauseNativePool>) -> Result<()> {
    let pool_state = &mut ctx.accounts.pool_state;
    
    require!(pool_state.is_native_pool, ErrorCode::NotNativePool);
    
    // TODO: Add admin check when admin system is implemented
    // For now, anyone can call (will add proper admin in production)
    
// msg!("🛑 Native pool PAUSED!");
    
    // Note: We'd need to add is_paused field to PoolState
    // For now, just log. Full implementation requires state update.
    
    Ok(())
}

#[derive(Accounts)]
pub struct PauseNativePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub pool_state: Account<'info, PoolState>,
}

// Integer square root helper
trait IntegerSquareRoot {
    fn integer_sqrt(self) -> Self;
}

impl IntegerSquareRoot for u128 {
    fn integer_sqrt(self) -> Self {
        if self == 0 {
            return 0;
        }
        let mut x = self;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + self / x) / 2;
        }
        x
    }
}

