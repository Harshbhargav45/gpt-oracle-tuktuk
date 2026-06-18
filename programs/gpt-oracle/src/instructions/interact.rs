use crate::{instruction, Agent, AGENT, AGENT_DESC};
use anchor_lang::{prelude::*, Discriminator};
use solana_gpt_oracle::{cpi::accounts::InteractWithLlm, ContextAccount};

#[derive(Accounts)]
pub struct Interact<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Checked by CPI
    #[account(mut)]
    pub interaction: AccountInfo<'info>,

    #[account(
        seeds = [AGENT.as_bytes(), payer.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, Agent>,

    #[account(address = agent.context)]
    pub context_account: Account<'info, ContextAccount>,

    /// CHECK: The oracle program
    #[account(address = solana_gpt_oracle::ID)]
    pub oracle_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> Interact<'info> {
    pub fn interact_with_llm(&mut self) -> Result<()> {
        let cpi_program = self.oracle_program.to_account_info();
        let cpi_acc = InteractWithLlm {
            payer: self.payer.to_account_info(),
            context_account: self.context_account.to_account_info(),
            interaction: self.interaction.to_account_info(),
            system_program: self.system_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_acc);

        let desc: [u8; 8] = instruction::CallbackFromLlm::DISCRIMINATOR
            .try_into()
            .expect("discriminator must be exactly 8 bytes");

        solana_gpt_oracle::cpi::interact_with_llm(
            cpi_ctx,
            AGENT_DESC.to_string(),
            crate::ID,
            desc,
            None,
        )?;

        Ok(())
    }
}
