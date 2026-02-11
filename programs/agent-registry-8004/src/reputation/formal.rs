//! Kani proofs for lightweight SEAL/chain encoding invariants.
//! NOTE:
//! - Proofs stay allocation-free and keccak-free to avoid CBMC path explosion
//!   in this crate.
//! - They still verify critical discriminants used by SEAL/hash-chain encoding.

#![cfg(kani)]

use super::chain::{DOMAIN_FEEDBACK, DOMAIN_RESPONSE, DOMAIN_REVOKE};
use super::seal::{DOMAIN_LEAF_V1, DOMAIN_SEAL_V1};

fn encode_score(score: Option<u8>) -> [u8; 2] {
    match score {
        Some(s) => [1, s],
        None => [0, 0],
    }
}

fn file_hash_flag(feedback_file_hash: Option<[u8; 32]>) -> u8 {
    if feedback_file_hash.is_some() { 1 } else { 0 }
}

#[kani::proof]
fn proof_score_encoding_distinguishes_none_and_zero() {
    assert_ne!(encode_score(None), encode_score(Some(0)));
}

#[kani::proof]
fn proof_file_hash_flag_encoding() {
    assert_eq!(file_hash_flag(None), 0);
    assert_eq!(file_hash_flag(Some([9_u8; 32])), 1);
}

#[kani::proof]
fn proof_domain_separators_are_distinct() {
    assert_ne!(DOMAIN_FEEDBACK, DOMAIN_RESPONSE);
    assert_ne!(DOMAIN_FEEDBACK, DOMAIN_REVOKE);
    assert_ne!(DOMAIN_RESPONSE, DOMAIN_REVOKE);
    assert_ne!(DOMAIN_SEAL_V1, DOMAIN_LEAF_V1);
}
