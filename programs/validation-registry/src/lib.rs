use anchor_lang::prelude::*;

declare_id!("2masQXYbHKXMrTV9aNLTWS4NMbNHfJhgcsLBtP6N5j6x");

#[program]
pub mod validation_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
