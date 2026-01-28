use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

pub const DOMAIN_FEEDBACK: &[u8] = b"8004_FEEDBACK_V1";
pub const DOMAIN_RESPONSE: &[u8] = b"8004_RESPONSE_V1";
pub const DOMAIN_REVOKE: &[u8] = b"8004_REVOKE_V1";

pub fn compute_feedback_leaf(
    asset: &Pubkey,
    client: &Pubkey,
    feedback_index: u64,
    feedback_hash: &[u8; 32],
    slot: u64,
) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 + 32 + 8 + 32 + 8);
    data.extend_from_slice(asset.as_ref());
    data.extend_from_slice(client.as_ref());
    data.extend_from_slice(&feedback_index.to_le_bytes());
    data.extend_from_slice(feedback_hash);
    data.extend_from_slice(&slot.to_le_bytes());
    keccak::hash(&data).0
}

pub fn compute_response_leaf(
    asset: &Pubkey,
    client: &Pubkey,
    feedback_index: u64,
    responder: &Pubkey,
    response_hash: &[u8; 32],
    slot: u64,
) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 + 32 + 8 + 32 + 32 + 8);
    data.extend_from_slice(asset.as_ref());
    data.extend_from_slice(client.as_ref());
    data.extend_from_slice(&feedback_index.to_le_bytes());
    data.extend_from_slice(responder.as_ref());
    data.extend_from_slice(response_hash);
    data.extend_from_slice(&slot.to_le_bytes());
    keccak::hash(&data).0
}

pub fn compute_revoke_leaf(
    asset: &Pubkey,
    client: &Pubkey,
    feedback_index: u64,
    feedback_hash: &[u8; 32],
    slot: u64,
) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 + 32 + 8 + 32 + 8);
    data.extend_from_slice(asset.as_ref());
    data.extend_from_slice(client.as_ref());
    data.extend_from_slice(&feedback_index.to_le_bytes());
    data.extend_from_slice(feedback_hash);
    data.extend_from_slice(&slot.to_le_bytes());
    keccak::hash(&data).0
}

pub fn chain_hash(prev_digest: &[u8; 32], domain: &[u8], leaf: &[u8; 32]) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 + domain.len() + 32);
    data.extend_from_slice(prev_digest);
    data.extend_from_slice(domain);
    data.extend_from_slice(leaf);
    keccak::hash(&data).0
}
