/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/atom_engine.json`.
 */
export type AtomEngine = {
  "address": "AToMNmthLzvTy3D2kz2obFmbVCsTCmYpDw1ptWUJdeU8",
  "metadata": {
    "name": "atomEngine",
    "version": "0.2.2",
    "spec": "0.1.0",
    "description": "ATOM Engine - AI Agent Trust & Reputation Metrics for Solana"
  },
  "instructions": [
    {
      "name": "getSummary",
      "docs": [
        "Get summary for an agent (CPI-callable, returns Summary struct)",
        "Other programs can call this via CPI to get reputation data"
      ],
      "discriminator": [
        159,
        2,
        226,
        186,
        90,
        59,
        255,
        104
      ],
      "accounts": [
        {
          "name": "asset"
        },
        {
          "name": "stats",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "summary"
        }
      }
    },
    {
      "name": "initializeConfig",
      "docs": [
        "Initialize the ATOM config (authority only, once)"
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "programData",
          "docs": [
            "Program data account for upgrade authority verification",
            "SECURITY: Only program deployer can initialize"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  140,
                  150,
                  177,
                  101,
                  134,
                  30,
                  94,
                  175,
                  237,
                  65,
                  167,
                  16,
                  7,
                  57,
                  194,
                  175,
                  136,
                  253,
                  66,
                  76,
                  73,
                  118,
                  28,
                  98,
                  43,
                  225,
                  136,
                  144,
                  174,
                  180,
                  99,
                  169
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                2,
                168,
                246,
                145,
                78,
                136,
                161,
                176,
                226,
                16,
                21,
                62,
                247,
                99,
                174,
                43,
                0,
                194,
                185,
                61,
                22,
                193,
                36,
                210,
                192,
                83,
                122,
                16,
                4,
                128,
                0,
                0
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "agentRegistryProgram",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initializeStats",
      "docs": [
        "Initialize stats for a new agent (only asset holder can initialize)"
      ],
      "discriminator": [
        144,
        201,
        117,
        76,
        127,
        118,
        176,
        16
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Agent owner (must be the Metaplex Core asset holder)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "asset"
        },
        {
          "name": "collection"
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "revokeStats",
      "docs": [
        "Revoke a feedback entry from the ring buffer",
        "Called via CPI from agent-registry during revoke_feedback",
        "SECURITY: Caller verified via PDA signer (registry_authority) in context constraints",
        "",
        "# Arguments",
        "* `client_pubkey` - The pubkey of the client who gave the feedback",
        "",
        "# Returns",
        "RevokeResult with original_score, had_impact, and new stats",
        "",
        "# Soft Fail Behavior",
        "If feedback is not found (too old, ejected from ring buffer) or already revoked,",
        "returns `had_impact: false` instead of erroring. This is intentional for UX."
      ],
      "discriminator": [
        86,
        178,
        106,
        195,
        51,
        236,
        38,
        104
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "asset"
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "registryAuthority",
          "docs": [
            "Registry authority PDA - must be signed by agent-registry program",
            "Seeds: [\"atom_cpi_authority\"] derived from agent-registry program"
          ],
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientPubkey",
          "type": "pubkey"
        }
      ],
      "returns": {
        "defined": {
          "name": "revokeResult"
        }
      }
    },
    {
      "name": "updateConfig",
      "docs": [
        "Update config parameters (authority only)",
        "NOTE: compute.rs currently uses compile-time params; config is metadata-only until wired.",
        "SECURITY: Added parameter bounds validation"
      ],
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "alphaFast",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "alphaSlow",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "alphaVolatility",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "alphaArrival",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "weightSybil",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "weightBurst",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "weightStagnation",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "weightShock",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "weightVolatility",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "weightArrival",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "diversityThreshold",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "burstThreshold",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "shockThreshold",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "volatilityThreshold",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "paused",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "updateStats",
      "docs": [
        "Update stats for an agent (called via CPI from agent-registry during feedback)",
        "Stats must already exist (created during agent registration via initialize_stats)",
        "SECURITY: Caller verified via PDA signer (registry_authority) in context constraints",
        "Returns UpdateResult for enriched events in agent-registry"
      ],
      "discriminator": [
        145,
        138,
        9,
        150,
        178,
        31,
        158,
        244
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "asset"
        },
        {
          "name": "collection"
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  116,
                  111,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "registryAuthority",
          "docs": [
            "Registry authority PDA - must be signed by agent-registry program",
            "Seeds: [\"atom_cpi_authority\"] derived from agent-registry program"
          ],
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "score",
          "type": "u8"
        }
      ],
      "returns": {
        "defined": {
          "name": "updateResult"
        }
      }
    }
  ],
  "accounts": [
    {
      "name": "atomConfig",
      "discriminator": [
        239,
        137,
        245,
        161,
        255,
        250,
        190,
        145
      ]
    },
    {
      "name": "atomStats",
      "discriminator": [
        190,
        187,
        50,
        59,
        203,
        39,
        136,
        244
      ]
    }
  ],
  "events": [
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "statsInitialized",
      "discriminator": [
        93,
        122,
        104,
        161,
        105,
        216,
        131,
        61
      ]
    },
    {
      "name": "statsRevoked",
      "discriminator": [
        79,
        79,
        219,
        18,
        199,
        64,
        242,
        47
      ]
    },
    {
      "name": "statsUpdated",
      "discriminator": [
        50,
        144,
        62,
        38,
        140,
        148,
        117,
        62
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidScore",
      "msg": "Invalid score: must be 0-100"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Unauthorized: only authority can perform this action"
    },
    {
      "code": 6002,
      "name": "unauthorizedCaller",
      "msg": "Unauthorized caller: only agent-registry can update stats"
    },
    {
      "code": 6003,
      "name": "configAlreadyInitialized",
      "msg": "Config already initialized"
    },
    {
      "code": 6004,
      "name": "paused",
      "msg": "Engine is paused"
    },
    {
      "code": 6005,
      "name": "statsNotInitialized",
      "msg": "Stats not initialized: call initialize_stats first"
    },
    {
      "code": 6006,
      "name": "notAssetOwner",
      "msg": "Not asset owner: only the Metaplex Core asset holder can initialize stats"
    },
    {
      "code": 6007,
      "name": "invalidAsset",
      "msg": "Invalid asset: cannot read owner from asset data"
    },
    {
      "code": 6008,
      "name": "invalidCollection",
      "msg": "Invalid collection: must be owned by Metaplex Core program"
    },
    {
      "code": 6009,
      "name": "assetNotInCollection",
      "msg": "Asset not in a collection: UpdateAuthority must be Collection type"
    },
    {
      "code": 6010,
      "name": "collectionMismatch",
      "msg": "Collection mismatch: asset belongs to a different collection"
    },
    {
      "code": 6011,
      "name": "invalidAssetType",
      "msg": "Invalid asset type: expected Metaplex Core AssetV1"
    },
    {
      "code": 6012,
      "name": "invalidConfigParameter",
      "msg": "Invalid config parameter: value out of allowed bounds"
    },
    {
      "code": 6013,
      "name": "feedbackNotFound",
      "msg": "Feedback not found in ring buffer (may be too old)"
    },
    {
      "code": 6014,
      "name": "alreadyRevoked",
      "msg": "Feedback already revoked"
    }
  ],
  "types": [
    {
      "name": "atomConfig",
      "docs": [
        "Configuration account for ATOM engine"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Authority that can update config"
            ],
            "type": "pubkey"
          },
          {
            "name": "agentRegistryProgram",
            "docs": [
              "Agent registry program (authorized CPI caller)"
            ],
            "type": "pubkey"
          },
          {
            "name": "alphaFast",
            "type": "u16"
          },
          {
            "name": "alphaSlow",
            "type": "u16"
          },
          {
            "name": "alphaVolatility",
            "type": "u16"
          },
          {
            "name": "alphaArrival",
            "type": "u16"
          },
          {
            "name": "alphaQuality",
            "type": "u16"
          },
          {
            "name": "alphaQualityUp",
            "type": "u16"
          },
          {
            "name": "alphaQualityDown",
            "type": "u16"
          },
          {
            "name": "alphaBurstUp",
            "type": "u16"
          },
          {
            "name": "alphaBurstDown",
            "type": "u16"
          },
          {
            "name": "weightSybil",
            "type": "u8"
          },
          {
            "name": "weightBurst",
            "type": "u8"
          },
          {
            "name": "weightStagnation",
            "type": "u8"
          },
          {
            "name": "weightShock",
            "type": "u8"
          },
          {
            "name": "weightVolatility",
            "type": "u8"
          },
          {
            "name": "weightArrival",
            "type": "u8"
          },
          {
            "name": "diversityThreshold",
            "type": "u8"
          },
          {
            "name": "burstThreshold",
            "type": "u8"
          },
          {
            "name": "shockThreshold",
            "type": "u16"
          },
          {
            "name": "volatilityThreshold",
            "type": "u16"
          },
          {
            "name": "arrivalFastThreshold",
            "type": "u16"
          },
          {
            "name": "tierPlatinumQuality",
            "type": "u16"
          },
          {
            "name": "tierPlatinumRisk",
            "type": "u8"
          },
          {
            "name": "tierPlatinumConfidence",
            "type": "u16"
          },
          {
            "name": "tierGoldQuality",
            "type": "u16"
          },
          {
            "name": "tierGoldRisk",
            "type": "u8"
          },
          {
            "name": "tierGoldConfidence",
            "type": "u16"
          },
          {
            "name": "tierSilverQuality",
            "type": "u16"
          },
          {
            "name": "tierSilverRisk",
            "type": "u8"
          },
          {
            "name": "tierSilverConfidence",
            "type": "u16"
          },
          {
            "name": "tierBronzeQuality",
            "type": "u16"
          },
          {
            "name": "tierBronzeRisk",
            "type": "u8"
          },
          {
            "name": "tierBronzeConfidence",
            "type": "u16"
          },
          {
            "name": "coldStartMin",
            "type": "u16"
          },
          {
            "name": "coldStartMax",
            "type": "u16"
          },
          {
            "name": "coldStartPenaltyHeavy",
            "type": "u16"
          },
          {
            "name": "coldStartPenaltyPerFeedback",
            "type": "u16"
          },
          {
            "name": "uniquenessBonus",
            "type": "u16"
          },
          {
            "name": "loyaltyBonus",
            "type": "u16"
          },
          {
            "name": "loyaltyMinSlotDelta",
            "type": "u32"
          },
          {
            "name": "bonusMaxBurstPressure",
            "type": "u8"
          },
          {
            "name": "inactiveDecayPerEpoch",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "atomStats",
      "docs": [
        "Raw reputation metrics for an agent",
        "Seeds: [\"atom_stats\", asset.key()]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "collection",
            "docs": [
              "Collection this agent belongs to (offset 8 - primary filter)"
            ],
            "type": "pubkey"
          },
          {
            "name": "asset",
            "docs": [
              "Asset (agent NFT) this stats belongs to"
            ],
            "type": "pubkey"
          },
          {
            "name": "firstFeedbackSlot",
            "docs": [
              "Slot of first feedback received"
            ],
            "type": "u64"
          },
          {
            "name": "lastFeedbackSlot",
            "docs": [
              "Slot of most recent feedback"
            ],
            "type": "u64"
          },
          {
            "name": "feedbackCount",
            "docs": [
              "Total number of feedbacks received"
            ],
            "type": "u64"
          },
          {
            "name": "emaScoreFast",
            "docs": [
              "Fast EMA of scores (α=0.30), scale 0-10000"
            ],
            "type": "u16"
          },
          {
            "name": "emaScoreSlow",
            "docs": [
              "Slow EMA of scores (α=0.05), scale 0-10000"
            ],
            "type": "u16"
          },
          {
            "name": "emaVolatility",
            "docs": [
              "Smoothed absolute deviation |fast - slow|, scale 0-10000"
            ],
            "type": "u16"
          },
          {
            "name": "emaArrivalLog",
            "docs": [
              "EMA of ilog2(slot_delta), scale 0-1500"
            ],
            "type": "u16"
          },
          {
            "name": "peakEma",
            "docs": [
              "Historical peak of ema_score_slow"
            ],
            "type": "u16"
          },
          {
            "name": "maxDrawdown",
            "docs": [
              "Maximum drawdown (peak - current), scale 0-10000"
            ],
            "type": "u16"
          },
          {
            "name": "epochCount",
            "docs": [
              "Number of distinct epochs with activity"
            ],
            "type": "u16"
          },
          {
            "name": "currentEpoch",
            "docs": [
              "Current epoch number (slot / EPOCH_SLOTS)"
            ],
            "type": "u16"
          },
          {
            "name": "minScore",
            "docs": [
              "Minimum score ever received (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "maxScore",
            "docs": [
              "Maximum score ever received (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "firstScore",
            "docs": [
              "First score received (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "lastScore",
            "docs": [
              "Most recent score received (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "hllPacked",
            "docs": [
              "HyperLogLog registers for unique client estimation (~6.5% error)"
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "hllSalt",
            "docs": [
              "Random salt for HLL to prevent cross-agent grinding attacks"
            ],
            "type": "u64"
          },
          {
            "name": "recentCallers",
            "docs": [
              "Ring buffer of recent caller fingerprints (requires 25+ wallets for bypass)"
            ],
            "type": {
              "array": [
                "u64",
                24
              ]
            }
          },
          {
            "name": "burstPressure",
            "docs": [
              "EMA of repeat caller pressure (0-255)"
            ],
            "type": "u8"
          },
          {
            "name": "updatesSinceHllChange",
            "docs": [
              "Updates since last HLL register change"
            ],
            "type": "u8"
          },
          {
            "name": "negPressure",
            "docs": [
              "Negative momentum pressure (0-255)"
            ],
            "type": "u8"
          },
          {
            "name": "evictionCursor",
            "docs": [
              "Round Robin eviction cursor for ring buffer"
            ],
            "type": "u8"
          },
          {
            "name": "ringBaseSlot",
            "docs": [
              "Slot when current ring buffer window started (for MRT calculation)"
            ],
            "type": "u64"
          },
          {
            "name": "qualityVelocity",
            "docs": [
              "Accumulated quality change magnitude this epoch"
            ],
            "type": "u16"
          },
          {
            "name": "velocityEpoch",
            "docs": [
              "Epoch when velocity tracking started"
            ],
            "type": "u16"
          },
          {
            "name": "freezeEpochs",
            "docs": [
              "Epochs remaining in quality freeze (0 = not frozen)"
            ],
            "type": "u8"
          },
          {
            "name": "qualityFloor",
            "docs": [
              "Floor quality during freeze (0-100, used as quality_score/100)"
            ],
            "type": "u8"
          },
          {
            "name": "bypassCount",
            "docs": [
              "Number of bypassed writes in current window"
            ],
            "type": "u8"
          },
          {
            "name": "bypassScoreAvg",
            "docs": [
              "Sum of bypassed scores (for averaging when merging)"
            ],
            "type": "u8"
          },
          {
            "name": "bypassFingerprints",
            "docs": [
              "Fingerprints of bypassed entries (for revoke support)",
              "Stores last 10 bypassed FPs so they can still be revoked (matches MRT_MAX_BYPASS)"
            ],
            "type": {
              "array": [
                "u64",
                10
              ]
            }
          },
          {
            "name": "bypassFpCursor",
            "docs": [
              "Cursor for round-robin in bypass_fingerprints"
            ],
            "type": "u8"
          },
          {
            "name": "loyaltyScore",
            "docs": [
              "Cached loyalty score"
            ],
            "type": "u16"
          },
          {
            "name": "qualityScore",
            "docs": [
              "Cached quality score (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "riskScore",
            "docs": [
              "Last computed risk score (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "diversityRatio",
            "docs": [
              "Last computed diversity ratio (0-255)"
            ],
            "type": "u8"
          },
          {
            "name": "trustTier",
            "docs": [
              "Last computed trust tier (0-4: Unrated/Bronze/Silver/Gold/Platinum)"
            ],
            "type": "u8"
          },
          {
            "name": "tierCandidate",
            "docs": [
              "Tier candidate waiting for promotion (0-4)"
            ],
            "type": "u8"
          },
          {
            "name": "tierCandidateEpoch",
            "docs": [
              "Epoch when candidature started (for vesting calculation)"
            ],
            "type": "u16"
          },
          {
            "name": "tierConfirmed",
            "docs": [
              "Confirmed tier after vesting period (replaces trust_tier for logic)"
            ],
            "type": "u8"
          },
          {
            "name": "flags",
            "docs": [
              "Bit flags for edge cases"
            ],
            "type": "u8"
          },
          {
            "name": "confidence",
            "docs": [
              "Confidence in metrics (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "schemaVersion",
            "docs": [
              "Schema version for future migrations"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "docs": [
        "Emitted when config is initialized"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "agentRegistryProgram",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "configUpdated",
      "docs": [
        "Emitted when config is updated"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "revokeResult",
      "docs": [
        "Result of revoke_stats for enriched events",
        "Returned to caller so agent-registry can emit detailed FeedbackRevoked event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "originalScore",
            "docs": [
              "Original score from the revoked feedback (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "hadImpact",
            "docs": [
              "True if revoke had impact (false = feedback not found or already revoked)"
            ],
            "type": "bool"
          },
          {
            "name": "newTrustTier",
            "docs": [
              "Trust tier after revoke (0-4)"
            ],
            "type": "u8"
          },
          {
            "name": "newQualityScore",
            "docs": [
              "Quality score after revoke (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "newConfidence",
            "docs": [
              "Confidence after revoke (0-10000)"
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "statsInitialized",
      "docs": [
        "Emitted when stats are initialized for a new agent"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "collection",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "statsRevoked",
      "docs": [
        "Emitted when a feedback is revoked"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "docs": [
              "Asset (agent NFT) public key"
            ],
            "type": "pubkey"
          },
          {
            "name": "client",
            "docs": [
              "Client who gave the feedback"
            ],
            "type": "pubkey"
          },
          {
            "name": "originalScore",
            "docs": [
              "Original score from the revoked feedback (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "hadImpact",
            "docs": [
              "True if revoke had impact on stats (false = not found or already revoked)"
            ],
            "type": "bool"
          },
          {
            "name": "newTrustTier",
            "docs": [
              "Trust tier after revoke (0-4)"
            ],
            "type": "u8"
          },
          {
            "name": "newQualityScore",
            "docs": [
              "Quality score after revoke (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "newConfidence",
            "docs": [
              "Confidence after revoke (0-10000)"
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "statsUpdated",
      "docs": [
        "Emitted when stats are updated for an agent"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "docs": [
              "Asset (agent NFT) public key"
            ],
            "type": "pubkey"
          },
          {
            "name": "feedbackIndex",
            "docs": [
              "Feedback index"
            ],
            "type": "u64"
          },
          {
            "name": "score",
            "docs": [
              "Score received (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "trustTier",
            "docs": [
              "Computed trust tier (0-4)"
            ],
            "type": "u8"
          },
          {
            "name": "riskScore",
            "docs": [
              "Computed risk score (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "qualityScore",
            "docs": [
              "Quality score (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "confidence",
            "docs": [
              "Confidence (0-10000)"
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "summary",
      "docs": [
        "Summary returned by get_summary instruction (CPI-friendly)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "collection",
            "docs": [
              "Collection this agent belongs to"
            ],
            "type": "pubkey"
          },
          {
            "name": "asset",
            "docs": [
              "Asset (agent) this summary is for"
            ],
            "type": "pubkey"
          },
          {
            "name": "trustTier",
            "docs": [
              "Trust tier (0=Unrated, 1=Bronze, 2=Silver, 3=Gold, 4=Platinum)"
            ],
            "type": "u8"
          },
          {
            "name": "qualityScore",
            "docs": [
              "Quality score (0-10000, represents 0.00-100.00)"
            ],
            "type": "u16"
          },
          {
            "name": "riskScore",
            "docs": [
              "Risk score (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "confidence",
            "docs": [
              "Confidence in metrics (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "feedbackCount",
            "docs": [
              "Total feedback count"
            ],
            "type": "u64"
          },
          {
            "name": "uniqueClients",
            "docs": [
              "Estimated unique clients (HLL)"
            ],
            "type": "u64"
          },
          {
            "name": "diversityRatio",
            "docs": [
              "Diversity ratio (0-255)"
            ],
            "type": "u8"
          },
          {
            "name": "emaScoreFast",
            "docs": [
              "Fast EMA of scores (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "emaScoreSlow",
            "docs": [
              "Slow EMA of scores (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "loyaltyScore",
            "docs": [
              "Loyalty score"
            ],
            "type": "u16"
          },
          {
            "name": "firstFeedbackSlot",
            "docs": [
              "First feedback slot"
            ],
            "type": "u64"
          },
          {
            "name": "lastFeedbackSlot",
            "docs": [
              "Last feedback slot"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateResult",
      "docs": [
        "Result of update_stats for enriched events",
        "Returned to caller so agent-registry can emit detailed NewFeedback event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "trustTier",
            "docs": [
              "Trust tier after update (0-4)"
            ],
            "type": "u8"
          },
          {
            "name": "qualityScore",
            "docs": [
              "Quality score after update (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "confidence",
            "docs": [
              "Confidence after update (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "riskScore",
            "docs": [
              "Risk score after update (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "diversityRatio",
            "docs": [
              "Diversity ratio after update (0-255)"
            ],
            "type": "u8"
          },
          {
            "name": "hllChanged",
            "docs": [
              "True if HLL register changed (likely new unique client)"
            ],
            "type": "bool"
          }
        ]
      }
    }
  ]
};
