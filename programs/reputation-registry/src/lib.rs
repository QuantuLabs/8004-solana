use anchor_lang::prelude::*;

declare_id!("9WcFLL3Fsqs96JxuewEt9iqRwULtCZEsPT717hPbsQAa");

#[program]
pub mod reputation_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
