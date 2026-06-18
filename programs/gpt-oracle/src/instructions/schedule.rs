use anchor_lang::{
    prelude::*,
    solana_program::instruction::Instruction,
    InstructionData,
};
use solana_gpt_oracle::ContextAccount;

use crate::{Agent, AGENT, QUEUE_AUTHORITY_SEED};

const TUKTUK_QUEUE_TASK_DISCRIMINATOR: [u8; 8] = [177, 95, 195, 252, 241, 2, 178, 88];

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TriggerV0 {
    Now,
    Timestamp(i64),
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct CompiledInstructionV0 {
    pub program_id_index: u8,
    pub accounts: Vec<u8>,
    pub data: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct CompiledTransactionV0 {
    pub num_rw_signers: u8,
    pub num_ro_signers: u8,
    pub num_rw: u8,
    pub accounts: Vec<Pubkey>,
    pub instructions: Vec<CompiledInstructionV0>,
    pub signer_seeds: Vec<Vec<Vec<u8>>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TransactionSourceV0 {
    CompiledV0(CompiledTransactionV0),
    RemoteV0 { url: String, signer: Pubkey },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct QueueTaskArgsV0 {
    pub id: u16,
    pub trigger: TriggerV0,
    pub transaction: TransactionSourceV0,
    pub crank_reward: Option<u64>,
    pub free_tasks: u8,
    pub description: String,
}

fn compile_transaction(ix: Instruction) -> CompiledTransactionV0 {
    let mut accounts: Vec<Pubkey> = vec![ix.program_id];
    for meta in &ix.accounts {
        if !accounts.contains(&meta.pubkey) {
            accounts.push(meta.pubkey);
        }
    }

    let account_indices: Vec<u8> = ix
        .accounts
        .iter()
        .map(|m| accounts.iter().position(|a| a == &m.pubkey).unwrap() as u8)
        .collect();

    let compiled_ix = CompiledInstructionV0 {
        program_id_index: 0,
        accounts: account_indices,
        data: ix.data,
    };

    CompiledTransactionV0 {
        num_rw_signers: 0,
        num_ro_signers: 0,
        num_rw: 0,
        accounts,
        instructions: vec![compiled_ix],
        signer_seeds: vec![],
    }
}

#[derive(Accounts)]
pub struct Schedule<'info> {
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

    /// CHECK: Checked by CPI
    #[account(mut)]
    pub task_queue: UncheckedAccount<'info>,

    /// CHECK: Checked by CPI
    #[account(mut)]
    pub task_queue_authority: UncheckedAccount<'info>,

    /// CHECK: Checked by CPI
    #[account(mut)]
    pub task: UncheckedAccount<'info>,

    /// CHECK: PDA signer
    #[account(
        mut,
        seeds = [QUEUE_AUTHORITY_SEED],
        bump,
    )]
    pub queue_authority: AccountInfo<'info>,

    /// CHECK: TukTuk program
    pub tuktuk_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> Schedule<'info> {
    pub fn schedule(&self, task_id: u16, bumps: &ScheduleBumps) -> Result<()> {
        let interact_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(self.payer.key(), false),
                AccountMeta::new(self.interaction.key(), false),
                AccountMeta::new_readonly(self.agent.key(), false),
                AccountMeta::new_readonly(self.context_account.key(), false),
                AccountMeta::new_readonly(
                    Pubkey::new_from_array(solana_gpt_oracle::ID.to_bytes()),
                    false,
                ),
                AccountMeta::new_readonly(System::id(), false),
            ],
            data: crate::instruction::InteractWithLlm {}.data(),
        };

        let compiled_tx = compile_transaction(interact_ix);

        let args = QueueTaskArgsV0 {
            id: task_id,
            trigger: TriggerV0::Now,
            transaction: TransactionSourceV0::CompiledV0(compiled_tx),
            crank_reward: Some(5_000_000),
            free_tasks: 0,
            description: "interact_with_llm".to_string(),
        };

        let mut data = TUKTUK_QUEUE_TASK_DISCRIMINATOR.to_vec();
        data.extend(args.try_to_vec()?);

        let ix = Instruction {
            program_id: self.tuktuk_program.key(),
            accounts: vec![
                AccountMeta::new(self.payer.key(), true),
                AccountMeta::new_readonly(self.queue_authority.key(), true),
                AccountMeta::new_readonly(self.task_queue_authority.key(), false),
                AccountMeta::new(self.task_queue.key(), false),
                AccountMeta::new(self.task.key(), false),
                AccountMeta::new_readonly(System::id(), false),
            ],
            data,
        };

        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                self.payer.to_account_info(),
                self.queue_authority.to_account_info(),
                self.task_queue_authority.to_account_info(),
                self.task_queue.to_account_info(),
                self.task.to_account_info(),
                self.system_program.to_account_info(),
            ],
            &[&[QUEUE_AUTHORITY_SEED, &[bumps.queue_authority]]],
        )?;

        Ok(())
    }
}
