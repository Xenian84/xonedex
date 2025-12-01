use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use spl_token_2022::instruction as token_2022_instruction;
use anchor_spl::token::spl_token::instruction as token_instruction;

/// Token program IDs
pub const TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const TOKEN_2022_PROGRAM_ID: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/// Token 2022 program ID as Pubkey
pub fn token_2022_program_id() -> anchor_lang::solana_program::pubkey::Pubkey {
    anchor_lang::solana_program::pubkey::Pubkey::try_from(TOKEN_2022_PROGRAM_ID).unwrap()
}

/// Check if a program ID is Token 2022
pub fn is_token_2022(program_id: &Pubkey) -> bool {
    program_id.to_string() == TOKEN_2022_PROGRAM_ID
}

/// Check if a program ID is standard Token
pub fn is_token(program_id: &Pubkey) -> bool {
    program_id.to_string() == TOKEN_PROGRAM_ID
}

/// Get the appropriate token program account info based on program ID
pub fn get_token_program_account<'info>(
    token_program: &'info AccountInfo<'info>,
    token_2022_program: &'info AccountInfo<'info>,
    mint_program_id: &Pubkey,
) -> &'info AccountInfo<'info> {
    if is_token_2022(mint_program_id) {
        token_2022_program
    } else {
        token_program
    }
}

/// Transfer tokens using the correct token program (Token or Token 2022)
pub fn transfer_tokens<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    // Both Token and Token 2022 support the standard transfer instruction
    let transfer_ix = if is_token_2022(token_program.key) {
        token_2022_instruction::transfer(
            token_program.key,
            from.key,
            to.key,
            authority.key,
            &[],
            amount,
        )?
    } else {
        token_instruction::transfer(
            token_program.key,
            from.key,
            to.key,
            authority.key,
            &[],
            amount,
        )?
    };
    
    invoke(
        &transfer_ix,
        &[from, to, authority, token_program],
    )?;
    
    Ok(())
}

/// Transfer tokens using the correct token program with PDA signer
pub fn transfer_tokens_signed<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Both Token and Token 2022 support the standard transfer instruction
    let transfer_ix = if is_token_2022(token_program.key) {
        token_2022_instruction::transfer(
            token_program.key,
            from.key,
            to.key,
            authority.key,
            &[],
            amount,
        )?
    } else {
        token_instruction::transfer(
            token_program.key,
            from.key,
            to.key,
            authority.key,
            &[],
            amount,
        )?
    };
    
    invoke_signed(
        &transfer_ix,
        &[from, to, authority, token_program],
        signer_seeds,
    )?;
    
    Ok(())
}

