use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized: only the Oracle Identity may call this instruction")]
    UnauthorizedCallback,

    #[msg("Custom error message")]
    CustomError,
}
