use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token},
};
use anchor_spl::token::spl_token::instruction::initialize_account3 as initialize_account3_token;
use spl_token_2022::instruction::initialize_account3 as initialize_account3_token2022;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use crate::state::PoolState;
use crate::error::ErrorCode;
use crate::utils::{is_token_2022, is_token};

pub fn handler(
    ctx: Context<InitializePool>, 
    fee_numerator: u64,
    fee_denominator: u64,
    protocol_treasury: Option<Pubkey>,
    protocol_fee_bps: Option<u16>,
) -> Result<()> {
    // Verify token programs match mint program IDs
    // Mints are owned by their respective token programs
    let mint0_program = ctx.accounts.mint0.to_account_info().owner;
    let mint1_program = ctx.accounts.mint1.to_account_info().owner;
    
    // Verify mint0 uses either Token or Token 2022
    require!(
        is_token(&mint0_program) || is_token_2022(&mint0_program),
        ErrorCode::InvalidTreasury // Reuse error code for now
    );
    require!(
        is_token(&mint1_program) || is_token_2022(&mint1_program),
        ErrorCode::InvalidTreasury
    );
    
    // Verify token_2022_program if needed
    if is_token_2022(&mint0_program) || is_token_2022(&mint1_program) {
        require!(
            ctx.accounts.token_2022_program.key().to_string() == crate::utils::TOKEN_2022_PROGRAM_ID,
            ErrorCode::InvalidTreasury
        );
    }
    
    // Verify mints are valid Mint accounts
    // Check that they're owned by a valid token program (already verified above)
    // For Token 2022 mints, the structure is compatible but may have extensions
    // We just verify the account exists and is owned by a token program
    require!(
        ctx.accounts.mint0.to_account_info().data_len() >= 82, // Minimum size for a Mint account
        ErrorCode::InvalidTreasury
    );
    require!(
        ctx.accounts.mint1.to_account_info().data_len() >= 82, // Minimum size for a Mint account
        ErrorCode::InvalidTreasury
    );

    // Initialize vaults with the correct token program via CPI
    // Note: Anchor's init allocates space but doesn't initialize the account data
    // We need to call initialize_account3 BEFORE Anchor's init runs, but that's not possible
    // So we'll manually write the account data and set the owner
    let pool_state_key = ctx.accounts.pool_state.key();
    
    // Derive PDA addresses and bumps manually
    let (vault0_pda, vault0_bump) = Pubkey::find_program_address(
        &[b"vault0", pool_state_key.as_ref()],
        ctx.program_id,
    );
    let (vault1_pda, vault1_bump) = Pubkey::find_program_address(
        &[b"vault1", pool_state_key.as_ref()],
        ctx.program_id,
    );
    
    require!(
        vault0_pda == ctx.accounts.vault0.key(),
        ErrorCode::InvalidTreasury
    );
    require!(
        vault1_pda == ctx.accounts.vault1.key(),
        ErrorCode::InvalidTreasury
    );
    
    let vault0_seeds = &[
        b"vault0",
        pool_state_key.as_ref(),
        &[vault0_bump],
    ];
    let vault1_seeds = &[
        b"vault1",
        pool_state_key.as_ref(),
        &[vault1_bump],
    ];
    
    // Determine which token program to use for each vault
// msg!("mint0_program: {:?}", mint0_program);
// msg!("mint1_program: {:?}", mint1_program);
// msg!("is_token_2022 mint0: {}", is_token_2022(&mint0_program));
// msg!("is_token_2022 mint1: {}", is_token_2022(&mint1_program));
    
    let vault0_token_program_id = if is_token_2022(&mint0_program) {
        ctx.accounts.token_2022_program.key()
    } else {
        ctx.accounts.token_program.key()
    };
    
    let vault1_token_program_id = if is_token_2022(&mint1_program) {
        ctx.accounts.token_2022_program.key()
    } else {
        ctx.accounts.token_program.key()
    };
    
// msg!("vault0_token_program_id: {:?}", vault0_token_program_id);
// msg!("vault1_token_program_id: {:?}", vault1_token_program_id);
    
    // Calculate rent for TokenAccount (165 bytes)
    let rent = anchor_lang::solana_program::rent::Rent::get()?;
    let rent_lamports = rent.minimum_balance(165);
    
    // Allocate and initialize vault0 using System Program + Token Program CPI
    {
        let vault0_info = ctx.accounts.vault0.to_account_info();
        let vault0_lamports = vault0_info.lamports();
        let vault0_owner = vault0_info.owner;
        let vault0_data_len = vault0_info.data_len();
        
        // Case 1: Account doesn't exist - use transfer + allocate + assign pattern
        if vault0_lamports == 0 {
// msg!("Creating vault0");
            
            // Step 1: Transfer lamports for rent
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.vault0.to_account_info(),
                    },
                ),
                rent_lamports,
            )?;
            
            // Step 2: Allocate space (requires invoke_signed for PDA)
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::allocate(
                    ctx.accounts.vault0.key,
                    165,
                ),
                &[ctx.accounts.vault0.to_account_info()],
                &[vault0_seeds],
            )?;
            
            // Step 3: Assign to token program (requires invoke_signed for PDA)
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::assign(
                    ctx.accounts.vault0.key,
                    &vault0_token_program_id,
                ),
                &[ctx.accounts.vault0.to_account_info()],
                &[vault0_seeds],
            )?;
            
            // Step 4: Initialize as TokenAccount (use correct function for Token vs Token2022)
            let init_account_ix = if is_token_2022(&mint0_program) {
                initialize_account3_token2022(
                    &vault0_token_program_id,
                    ctx.accounts.vault0.key,
                    ctx.accounts.mint0.key,
                    ctx.accounts.pool_authority.key,
                )?
            } else {
                initialize_account3_token(
                    &vault0_token_program_id,
                    ctx.accounts.vault0.key,
                    ctx.accounts.mint0.key,
                    ctx.accounts.pool_authority.key,
                )?
            };
            
            let token_program_account = if is_token_2022(&mint0_program) {
                ctx.accounts.token_2022_program.to_account_info()
            } else {
                ctx.accounts.token_program.to_account_info()
            };
            
            invoke(
                &init_account_ix,
                &[
                    ctx.accounts.vault0.to_account_info(),
                    ctx.accounts.mint0.to_account_info(),
                    ctx.accounts.pool_authority.to_account_info(),
                    token_program_account,
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
            
// msg!("vault0 initialized");
        }
        // Case 2: Account exists but owned by System Program (from failed previous attempt)
        // Need to: allocate space (while still owned by System), then assign to Token Program
        else if vault0_owner == &anchor_lang::solana_program::system_program::ID {
            // First allocate space if needed (must be done while owned by System Program)
            if vault0_data_len == 0 {
                let allocate_ix = system_instruction::allocate(
                    ctx.accounts.vault0.key,
                    165,
                );
                invoke_signed(
                    &allocate_ix,
                    &[ctx.accounts.vault0.to_account_info()],
                    &[vault0_seeds],
                )?;
            }
            
            // Then assign ownership to Token Program
            let assign_ix = system_instruction::assign(
                ctx.accounts.vault0.key,
                &vault0_token_program_id,
            );
            invoke_signed(
                &assign_ix,
                &[ctx.accounts.vault0.to_account_info()],
                &[vault0_seeds],
            )?;
            
            // Now initialize it (use correct function for Token vs Token2022)
            let init_account_ix = if is_token_2022(&mint0_program) {
                initialize_account3_token2022(
                    &vault0_token_program_id,
                    ctx.accounts.vault0.key,
                    ctx.accounts.mint0.key,
                    ctx.accounts.pool_authority.key,
                )?
            } else {
                initialize_account3_token(
                    &vault0_token_program_id,
                    ctx.accounts.vault0.key,
                    ctx.accounts.mint0.key,
                    ctx.accounts.pool_authority.key,
                )?
            };
            
            let token_program_account = if is_token_2022(&mint0_program) {
                ctx.accounts.token_2022_program.to_account_info()
            } else {
                ctx.accounts.token_program.to_account_info()
            };
            
            invoke(
                &init_account_ix,
                &[
                    ctx.accounts.vault0.to_account_info(),
                    ctx.accounts.mint0.to_account_info(),
                    ctx.accounts.pool_authority.to_account_info(),
                    token_program_account,
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
        }
        // Case 3: Account already owned by correct Token Program - already initialized
        else if vault0_owner == &vault0_token_program_id {
// msg!("vault0 already initialized");
        }
        // Case 4: Owned by unexpected program - error
        else {
// msg!("vault0 owned by unexpected program: {:?}", vault0_owner);
            return Err(ErrorCode::InvalidTreasury.into());
        }
    }
    
    // Allocate and initialize vault1 using System Program + Token Program CPI
    {
        let vault1_info = ctx.accounts.vault1.to_account_info();
        let vault1_lamports = vault1_info.lamports();
        let vault1_owner = vault1_info.owner;
        let vault1_data_len = vault1_info.data_len();
        
        // Case 1: Account doesn't exist - use transfer + allocate + assign pattern
        if vault1_lamports == 0 {
// msg!("Creating vault1");
            
            // Step 1: Transfer lamports for rent
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.vault1.to_account_info(),
                    },
                ),
                rent_lamports,
            )?;
            
            // Step 2: Allocate space (requires invoke_signed for PDA)
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::allocate(
                    ctx.accounts.vault1.key,
                    165,
                ),
                &[ctx.accounts.vault1.to_account_info()],
                &[vault1_seeds],
            )?;
            
            // Step 3: Assign to token program (requires invoke_signed for PDA)
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::assign(
                    ctx.accounts.vault1.key,
                    &vault1_token_program_id,
                ),
                &[ctx.accounts.vault1.to_account_info()],
                &[vault1_seeds],
            )?;
            
            // Step 4: Initialize as TokenAccount (use correct function for Token vs Token2022)
            let init_account_ix = if is_token_2022(&mint1_program) {
                initialize_account3_token2022(
                    &vault1_token_program_id,
                    ctx.accounts.vault1.key,
                    ctx.accounts.mint1.key,
                    ctx.accounts.pool_authority.key,
                )?
            } else {
                initialize_account3_token(
                    &vault1_token_program_id,
                    ctx.accounts.vault1.key,
                    ctx.accounts.mint1.key,
                    ctx.accounts.pool_authority.key,
                )?
            };
            
            let token_program_account = if is_token_2022(&mint1_program) {
                ctx.accounts.token_2022_program.to_account_info()
            } else {
                ctx.accounts.token_program.to_account_info()
            };
            
            invoke(
                &init_account_ix,
                &[
                    ctx.accounts.vault1.to_account_info(),
                    ctx.accounts.mint1.to_account_info(),
                    ctx.accounts.pool_authority.to_account_info(),
                    token_program_account,
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
            
// msg!("vault1 initialized");
        }
        // Case 2: Account exists but owned by System Program (from failed previous attempt)
        else if vault1_owner == &anchor_lang::solana_program::system_program::ID {
            // First allocate space if needed
            if vault1_data_len == 0 {
                let allocate_ix = system_instruction::allocate(
                    ctx.accounts.vault1.key,
                    165,
                );
                invoke_signed(
                    &allocate_ix,
                    &[ctx.accounts.vault1.to_account_info()],
                    &[vault1_seeds],
                )?;
            }
            
            // Then assign ownership to Token Program
            let assign_ix = system_instruction::assign(
                ctx.accounts.vault1.key,
                &vault1_token_program_id,
            );
            invoke_signed(
                &assign_ix,
                &[ctx.accounts.vault1.to_account_info()],
                &[vault1_seeds],
            )?;
            
            // Now initialize it (use correct function for Token vs Token2022)
            let init_account_ix = if is_token_2022(&mint1_program) {
                initialize_account3_token2022(
                    &vault1_token_program_id,
                    ctx.accounts.vault1.key,
                    ctx.accounts.mint1.key,
                    ctx.accounts.pool_authority.key,
                )?
            } else {
                initialize_account3_token(
                    &vault1_token_program_id,
                    ctx.accounts.vault1.key,
                    ctx.accounts.mint1.key,
                    ctx.accounts.pool_authority.key,
                )?
            };
            
            let token_program_account = if is_token_2022(&mint1_program) {
                ctx.accounts.token_2022_program.to_account_info()
            } else {
                ctx.accounts.token_program.to_account_info()
            };
            
            invoke(
                &init_account_ix,
                &[
                    ctx.accounts.vault1.to_account_info(),
                    ctx.accounts.mint1.to_account_info(),
                    ctx.accounts.pool_authority.to_account_info(),
                    token_program_account,
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
        }
        // Case 3: Account already owned by correct Token Program - already initialized
        else if vault1_owner == &vault1_token_program_id {
// msg!("vault1 already initialized");
        }
        // Case 4: Owned by unexpected program - error
        else {
// msg!("vault1 owned by unexpected program: {:?}", vault1_owner);
            return Err(ErrorCode::InvalidTreasury.into());
        }
    }

    let pool_state = &mut ctx.accounts.pool_state;
    pool_state.fee_numerator = fee_numerator;
    pool_state.fee_denominator = fee_denominator;
    pool_state.total_amount_minted = 0;
    
    // Set protocol treasury (defaults to Pubkey::default() if None)
    // Pubkey::default() means no treasury - all fees go to LPs (backward compatible)
    pool_state.protocol_treasury = protocol_treasury.unwrap_or(Pubkey::default());
    
    // Set protocol fee in basis points (defaults to 0 if None)
    // 0 means all fees go to LPs (backward compatible)
    let fee_bps = protocol_fee_bps.unwrap_or(0);
    require!(fee_bps <= 10000, ErrorCode::InvalidProtocolFee);
    pool_state.protocol_fee_bps = fee_bps;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    // pool for token_x -> token_y 
    // Use UncheckedAccount for mints to support both Token and Token 2022
    /// CHECK: Validated in handler - can be Token or Token 2022
    pub mint0: UncheckedAccount<'info>,
    /// CHECK: Validated in handler - can be Token or Token 2022
    pub mint1: UncheckedAccount<'info>,

    #[account(
        init, 
        payer=payer, 
        seeds=[b"pool_state", mint0.key().as_ref(), mint1.key().as_ref()], 
        bump,
        space = 8 + 8 + 8 + 8 + 32 + 2, // discriminator + total_amount_minted + fee_numerator + fee_denominator + protocol_treasury + protocol_fee_bps = 66 bytes
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    // authority so 1 acc pass in can derive all other pdas 
    #[account(seeds=[b"authority", pool_state.key().as_ref()], bump)]
    pub pool_authority: AccountInfo<'info>,

    // account to hold token X
    // Use UncheckedAccount - manually allocated and initialized in handler
    /// CHECK: Manually allocated and initialized in handler with correct token program
    #[account(mut)]
    pub vault0: UncheckedAccount<'info>,
    // account to hold token Y
    /// CHECK: Manually allocated and initialized in handler with correct token program
    #[account(mut)]
    pub vault1: UncheckedAccount<'info>, 

    // pool mint : used to track relative contribution amount of LPs
    #[account(
        init, 
        payer=payer,
        seeds=[b"pool_mint", pool_state.key().as_ref()], 
        bump, 
        mint::decimals = 9,
        mint::authority = pool_authority
    )] 
    pub pool_mint: Box<Account<'info, Mint>>, 
    #[account(mut)]
    pub payer: Signer<'info>,

    // accounts required to init a new mint
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Token 2022 program - verified in handler
    pub token_2022_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}
