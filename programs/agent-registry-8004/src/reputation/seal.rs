//! SEAL v1 - Solana Event Authenticity Layer
//! Deterministic on-chain hash computation for trustless feedback integrity.
//!
//! This module provides the core hash computation functions that enable
//! trustless verification of feedback content. The hash is computed on-chain
//! from the feedback parameters, ensuring the client cannot lie about content.
//!
//! # Architecture
//!
//! ```text
//! CLIENT provides:
//!   feedbackFileHash = keccak256(file content) [OPTIONAL]
//!
//! PROGRAM computes ON-CHAIN (SEAL v1):
//!   sealHash = keccak256(canonical binary format of feedback content)
//!
//! LEAF (binds seal to context):
//!   leaf = keccak256(DOMAIN_LEAF_V1 || asset || client || index || sealHash || slot)
//!
//! CHAIN (proof of inclusion):
//!   digest = keccak256(prev_digest || DOMAIN_FEEDBACK || leaf)
//! ```

use anchor_lang::solana_program::keccak;

/// Domain separator for SEAL v1 content hash (exactly 16 bytes)
pub const DOMAIN_SEAL_V1: &[u8; 16] = b"8004_SEAL_V1____";

/// Domain separator for LEAF v1 (exactly 16 bytes)
pub const DOMAIN_LEAF_V1: &[u8; 16] = b"8004_LEAF_V1____";

/// Compute SEAL hash from feedback content (on-chain, deterministic).
///
/// This function computes a canonical hash of the feedback content that can be
/// independently verified by any client using the same inputs.
///
/// # Binary Format (canonical)
///
/// FIXED FIELDS (28 bytes total, known offsets):
/// - offset 0:  DOMAIN_SEAL_V1 (16 bytes)
/// - offset 16: value (8 bytes, i64 LE)
/// - offset 24: value_decimals (1 byte)
/// - offset 25: score_flag (1 byte: 0=None, 1=Some)
/// - offset 26: score_value (1 byte, 0 if flag=0)
/// - offset 27: file_hash_flag (1 byte: 0=None, 1=Some)
///
/// DYNAMIC FIELDS (after offset 28, strict order):
/// - file_hash (32 bytes, only if flag=1)
/// - tag1_len (2 bytes, u16 LE) + tag1_bytes (UTF-8)
/// - tag2_len (2 bytes, u16 LE) + tag2_bytes (UTF-8)
/// - endpoint_len (2 bytes, u16 LE) + endpoint_bytes (UTF-8)
/// - feedback_uri_len (2 bytes, u16 LE) + feedback_uri_bytes (UTF-8)
///
/// # Arguments
///
/// * `value` - Metric value (i64, may be negative)
/// * `value_decimals` - Decimal precision (0-6)
/// * `score` - Quality score (0-100, optional)
/// * `tag1` - Category tag (validated externally)
/// * `tag2` - Period/network tag (validated externally)
/// * `endpoint` - Agent endpoint that was called (validated externally)
/// * `feedback_uri` - URI to feedback file (validated externally)
/// * `feedback_file_hash` - Optional hash of the feedback file content
///
/// # Returns
///
/// 32-byte Keccak256 hash of the canonical binary representation.
pub fn compute_seal_hash(
    value: i64,
    value_decimals: u8,
    score: Option<u8>,
    tag1: &str,
    tag2: &str,
    endpoint: &str,
    feedback_uri: &str,
    feedback_file_hash: Option<[u8; 32]>,
) -> [u8; 32] {
    // Pre-calculate capacity for efficiency
    let capacity = 28 // fixed header
        + if feedback_file_hash.is_some() { 32 } else { 0 }
        + 2 + tag1.len()
        + 2 + tag2.len()
        + 2 + endpoint.len()
        + 2 + feedback_uri.len();

    let mut data = Vec::with_capacity(capacity);

    // === FIXED FIELDS (28 bytes, known offsets) ===

    // offset 0: Domain separator (16 bytes)
    data.extend_from_slice(DOMAIN_SEAL_V1);

    // offset 16: Value (8 bytes, i64 LE)
    data.extend_from_slice(&value.to_le_bytes());

    // offset 24: Value decimals (1 byte)
    data.push(value_decimals);

    // offset 25-26: Score (2 bytes, fixed layout)
    match score {
        Some(s) => {
            data.push(1); // flag = present
            data.push(s); // value
        }
        None => {
            data.push(0); // flag = absent
            data.push(0); // placeholder for alignment
        }
    }

    // offset 27: File hash flag (1 byte)
    data.push(if feedback_file_hash.is_some() { 1 } else { 0 });

    // === DYNAMIC FIELDS (after offset 28, strict order) ===

    // File hash (32 bytes if present)
    if let Some(hash) = feedback_file_hash {
        data.extend_from_slice(&hash);
    }

    // Strings: u16 LE length prefix + UTF-8 bytes
    for s in [tag1, tag2, endpoint, feedback_uri] {
        let bytes = s.as_bytes();
        data.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        data.extend_from_slice(bytes);
    }

    keccak::hash(&data).0
}

/// Compute feedback leaf with SEAL v1 domain separator.
///
/// This binds the seal hash to the feedback context (asset, client, index, slot).
/// The domain separator ensures this leaf cannot collide with other leaf types.
///
/// # Format
///
/// ```text
/// leaf = keccak256(
///     DOMAIN_LEAF_V1 (16 bytes) ||
///     asset (32 bytes) ||
///     client (32 bytes) ||
///     feedback_index (4 bytes, u32 LE) ||
///     seal_hash (32 bytes) ||
///     slot (8 bytes, u64 LE)
/// )
/// ```
///
/// # Note
///
/// Uses u32 for feedback_index (sufficient for ~4 billion feedbacks per agent).
/// This differs from the legacy leaf which used u64.
pub fn compute_feedback_leaf_v1(
    asset: &[u8; 32],
    client: &[u8; 32],
    feedback_index: u32,
    seal_hash: &[u8; 32],
    slot: u64,
) -> [u8; 32] {
    let mut data = Vec::with_capacity(16 + 32 + 32 + 4 + 32 + 8);

    // Domain separator
    data.extend_from_slice(DOMAIN_LEAF_V1);

    // Context binding
    data.extend_from_slice(asset);
    data.extend_from_slice(client);
    data.extend_from_slice(&feedback_index.to_le_bytes());
    data.extend_from_slice(seal_hash);
    data.extend_from_slice(&slot.to_le_bytes());

    keccak::hash(&data).0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test Vector 1: Minimal (score=None, fileHash=None)
    #[test]
    fn test_seal_hash_minimal() {
        let hash = compute_seal_hash(
            9977,  // value
            2,     // decimals
            None,  // score
            "uptime",
            "day",
            "",
            "ipfs://QmTest123",
            None, // no file hash
        );

        // Hash should be deterministic - same inputs produce same output
        let hash2 = compute_seal_hash(9977, 2, None, "uptime", "day", "", "ipfs://QmTest123", None);
        assert_eq!(hash, hash2);

        // Hash should be 32 bytes
        assert_eq!(hash.len(), 32);

        // Hash should not be all zeros
        assert_ne!(hash, [0u8; 32]);
    }

    /// Test Vector 2: Full (score=Some, fileHash=Some)
    #[test]
    fn test_seal_hash_full() {
        let file_hash = [0x01u8; 32];
        let hash = compute_seal_hash(
            -100, // negative value
            0,
            Some(85),
            "x402-resource-delivered",
            "exact-svm",
            "https://api.agent.com/mcp",
            "ar://abc123",
            Some(file_hash),
        );

        // Same inputs should produce same hash
        let hash2 = compute_seal_hash(
            -100,
            0,
            Some(85),
            "x402-resource-delivered",
            "exact-svm",
            "https://api.agent.com/mcp",
            "ar://abc123",
            Some(file_hash),
        );
        assert_eq!(hash, hash2);

        // Different from minimal hash
        let minimal = compute_seal_hash(9977, 2, None, "uptime", "day", "", "ipfs://QmTest123", None);
        assert_ne!(hash, minimal);
    }

    /// Test Vector 3: Empty strings
    #[test]
    fn test_seal_hash_empty_strings() {
        let hash = compute_seal_hash(
            0,       // zero value
            0,       // zero decimals
            Some(0), // edge case: score = 0
            "",      // empty tag1
            "",      // empty tag2
            "",      // empty endpoint
            "",      // empty uri
            None,
        );

        assert_eq!(hash.len(), 32);
        assert_ne!(hash, [0u8; 32]);
    }

    /// Test Vector 4: UTF-8 non-ASCII
    #[test]
    fn test_seal_hash_utf8() {
        let hash = compute_seal_hash(
            1_000_000,
            6,
            None,
            "質量",           // Chinese characters
            "émoji🎉",        // Accented + emoji
            "https://例え.jp/api",
            "ipfs://QmTest",
            None,
        );

        // Same UTF-8 input should produce same hash
        let hash2 = compute_seal_hash(
            1_000_000,
            6,
            None,
            "質量",
            "émoji🎉",
            "https://例え.jp/api",
            "ipfs://QmTest",
            None,
        );
        assert_eq!(hash, hash2);
    }

    /// Test leaf computation
    #[test]
    fn test_feedback_leaf_v1() {
        let asset = [0xAAu8; 32];
        let client = [0xBBu8; 32];
        let seal_hash = [0xCCu8; 32];

        let leaf = compute_feedback_leaf_v1(&asset, &client, 0, &seal_hash, 12345);

        // Same inputs should produce same leaf
        let leaf2 = compute_feedback_leaf_v1(&asset, &client, 0, &seal_hash, 12345);
        assert_eq!(leaf, leaf2);

        // Different index should produce different leaf
        let leaf3 = compute_feedback_leaf_v1(&asset, &client, 1, &seal_hash, 12345);
        assert_ne!(leaf, leaf3);

        // Different slot should produce different leaf
        let leaf4 = compute_feedback_leaf_v1(&asset, &client, 0, &seal_hash, 12346);
        assert_ne!(leaf, leaf4);
    }

    /// Verify score=None vs score=Some(0) produce different hashes
    #[test]
    fn test_score_none_vs_zero() {
        let hash_none = compute_seal_hash(100, 0, None, "tag", "", "", "", None);
        let hash_zero = compute_seal_hash(100, 0, Some(0), "tag", "", "", "", None);
        assert_ne!(hash_none, hash_zero);
    }

    /// Verify file hash presence affects the seal hash
    #[test]
    fn test_file_hash_presence() {
        let hash_without = compute_seal_hash(100, 0, None, "", "", "", "", None);
        let hash_with = compute_seal_hash(100, 0, None, "", "", "", "", Some([0x00u8; 32]));
        assert_ne!(hash_without, hash_with);
    }

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// Cross-validation test - prints hex for comparison with TypeScript
    #[test]
    fn test_cross_validation_vectors() {
        // Vector 1: Minimal
        let hash1 = compute_seal_hash(9977, 2, None, "uptime", "day", "", "ipfs://QmTest123", None);
        println!("Vector 1 (minimal): {}", to_hex(&hash1));

        // Vector 2: Full
        let file_hash = [0x01u8; 32];
        let hash2 = compute_seal_hash(
            -100, 0, Some(85),
            "x402-resource-delivered", "exact-svm",
            "https://api.agent.com/mcp", "ar://abc123",
            Some(file_hash),
        );
        println!("Vector 2 (full):    {}", to_hex(&hash2));

        // Vector 3: Empty strings
        let hash3 = compute_seal_hash(0, 0, Some(0), "", "", "", "", None);
        println!("Vector 3 (empty):   {}", to_hex(&hash3));

        // Vector 4: UTF-8 non-ASCII
        let hash4 = compute_seal_hash(1_000_000, 6, None, "質量", "émoji🎉", "https://例え.jp/api", "ipfs://QmTest", None);
        println!("Vector 4 (UTF-8):   {}", to_hex(&hash4));

        // Vector 5: Leaf computation
        let asset = [0xAAu8; 32];
        let client = [0xBBu8; 32];
        let leaf = compute_feedback_leaf_v1(&asset, &client, 0, &hash1, 12345);
        println!("Leaf (from V1):     {}", to_hex(&leaf));
    }
}
