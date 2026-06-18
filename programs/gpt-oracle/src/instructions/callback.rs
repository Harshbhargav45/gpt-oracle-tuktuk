use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Callback {}

impl<'info> Callback {
    pub fn callback_from_llm(&mut self, response: String) -> Result<()> {
        msg!("GPT Response: {:?}", response);
        Ok(())
    }
}
