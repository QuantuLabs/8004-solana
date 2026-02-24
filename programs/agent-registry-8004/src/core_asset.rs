use anchor_lang::prelude::*;
use mpl_core::accounts::BaseAssetV1;

use crate::error::RegistryError;

/// Read the authoritative owner from a Metaplex Core asset account.
pub fn get_core_owner(asset_info: &AccountInfo) -> Result<Pubkey> {
    require!(*asset_info.owner == mpl_core::ID, RegistryError::InvalidAsset);

    let data = asset_info.try_borrow_data()?;
    let asset = BaseAssetV1::from_bytes(&data).map_err(|_| RegistryError::InvalidAsset)?;

    Ok(asset.owner)
}

/// Verify that `expected_owner` currently owns the Core asset.
pub fn verify_core_owner(asset_info: &AccountInfo, expected_owner: &Pubkey) -> Result<()> {
    let actual_owner = get_core_owner(asset_info)?;
    require!(actual_owner == *expected_owner, RegistryError::Unauthorized);
    Ok(())
}
