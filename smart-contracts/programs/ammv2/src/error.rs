use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Src Balance < LP Deposit Amount.")]
    NotEnoughBalance,
    #[msg("Pool Mint Amount < 0 on LP Deposit")]
    NoPoolMintOutput,
    #[msg("Trying to burn too much")]
    BurnTooMuch,
    #[msg("Not enough out")]
    NotEnoughOut,
    #[msg("Invalid protocol fee: must be between 0 and 10000 basis points")]
    InvalidProtocolFee,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
    
    // Native Pool Errors
    #[msg("This operation is only for native XNT pools")]
    NotNativePool,
    #[msg("Invalid input parameters")]
    InvalidInput,
    #[msg("Insufficient liquidity in pool")]
    InsufficientLiquidity,
    #[msg("Math operation overflow")]
    MathOverflow,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Insufficient rent reserve - would make pool rent-ineligible")]
    InsufficientRentReserve,
    #[msg("Invalid account data - failed to deserialize")]
    InvalidAccountData,
}
