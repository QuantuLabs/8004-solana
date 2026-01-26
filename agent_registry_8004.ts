/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/agent_registry_8004.json`.
 */
export type AgentRegistry8004 = {
  "address": "6MuHv4dY4p9E4hSCEPr9dgbCSpMhq8x1vrUexbMVjfw1",
  "metadata": {
    "name": "agentRegistry8004",
    "version": "0.5.0",
    "spec": "0.1.0",
    "description": "8004 AI Agent Identity & Reputation Registry (Consolidated)"
  },
  "instructions": [
    {
      "name": "appendResponse",
      "docs": [
        "Append response to feedback"
      ],
      "discriminator": [
        162,
        210,
        186,
        50,
        180,
        4,
        47,
        104
      ],
      "accounts": [
        {
          "name": "responder",
          "docs": [
            "Responder must be agent owner or agent wallet"
          ],
          "signer": true
        },
        {
          "name": "agentAccount",
          "docs": [
            "Agent account for authorization check"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "assetKey"
              }
            ]
          }
        },
        {
          "name": "asset",
          "docs": [
            "Core asset (for PDA derivation)"
          ]
        }
      ],
      "args": [
        {
          "name": "assetKey",
          "type": "pubkey"
        },
        {
          "name": "clientAddress",
          "type": "pubkey"
        },
        {
          "name": "feedbackIndex",
          "type": "u64"
        },
        {
          "name": "responseUri",
          "type": "string"
        },
        {
          "name": "responseHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "createBaseRegistry",
      "docs": [
        "Create a new base registry (authority only)"
      ],
      "discriminator": [
        150,
        191,
        7,
        52,
        251,
        227,
        60,
        23
      ],
      "accounts": [
        {
          "name": "rootConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
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
          "name": "registryConfig",
          "docs": [
            "New base registry config"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "collection"
              }
            ]
          }
        },
        {
          "name": "collection",
          "docs": [
            "New collection to create"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": []
    },
    {
      "name": "createUserRegistry",
      "docs": [
        "Create a user registry (anyone can create their own shard)"
      ],
      "discriminator": [
        244,
        141,
        67,
        250,
        234,
        104,
        58,
        135
      ],
      "accounts": [
        {
          "name": "collectionAuthority",
          "docs": [
            "PDA authority for all user collections"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  111,
                  108,
                  108,
                  101,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "registryConfig",
          "docs": [
            "User registry config"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "collection"
              }
            ]
          }
        },
        {
          "name": "collection",
          "docs": [
            "New collection to create (program PDA is authority)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "owner",
          "docs": [
            "User who creates and owns this registry"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "collectionName",
          "type": "string"
        },
        {
          "name": "collectionUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "deleteMetadataPda",
      "docs": [
        "Delete agent metadata PDA and recover rent (key_hash = SHA256(key)[0..16])"
      ],
      "discriminator": [
        228,
        190,
        195,
        255,
        61,
        221,
        26,
        152
      ],
      "accounts": [
        {
          "name": "metadataEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116,
                  95,
                  109,
                  101,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              },
              {
                "kind": "arg",
                "path": "keyHash"
              }
            ]
          }
        },
        {
          "name": "agentAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset - verifies ownership"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "Owner must be the asset owner (verified in instruction)",
            "Receives rent back when PDA is closed"
          ],
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "keyHash",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        }
      ]
    },
    {
      "name": "enableAtom",
      "docs": [
        "Enable ATOM for an agent (one-way)"
      ],
      "discriminator": [
        202,
        27,
        88,
        88,
        150,
        1,
        240,
        97
      ],
      "accounts": [
        {
          "name": "agentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset for ownership verification"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "Agent owner (must match Core asset owner)"
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "giveFeedback",
      "docs": [
        "Give feedback to an agent"
      ],
      "discriminator": [
        145,
        136,
        123,
        3,
        215,
        165,
        98,
        41
      ],
      "accounts": [
        {
          "name": "client",
          "writable": true,
          "signer": true
        },
        {
          "name": "agentAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset"
        },
        {
          "name": "collection"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "atomConfig",
          "docs": [
            "AtomConfig PDA (owned by atom-engine)"
          ],
          "optional": true
        },
        {
          "name": "atomStats",
          "docs": [
            "AtomStats PDA - OPTIONAL initialization",
            "If uninitialized, feedback works without ATOM Engine"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "atomEngineProgram",
          "optional": true
        },
        {
          "name": "registryAuthority",
          "optional": true,
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
                  112,
                  105,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "score",
          "type": "u8"
        },
        {
          "name": "tag1",
          "type": "string"
        },
        {
          "name": "tag2",
          "type": "string"
        },
        {
          "name": "endpoint",
          "type": "string"
        },
        {
          "name": "feedbackUri",
          "type": "string"
        },
        {
          "name": "feedbackHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "feedbackIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Initialize the registry with root config and first base registry"
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "rootConfig",
          "docs": [
            "Global root config pointing to current base registry"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
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
          "name": "registryConfig",
          "docs": [
            "First base registry config (base #0)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "collection"
              }
            ]
          }
        },
        {
          "name": "collection",
          "docs": [
            "First collection (created by CPI to Metaplex Core)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData",
          "docs": [
            "Program data account for upgrade authority verification"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  79,
                  165,
                  45,
                  89,
                  251,
                  145,
                  89,
                  188,
                  251,
                  113,
                  195,
                  53,
                  82,
                  253,
                  175,
                  168,
                  9,
                  47,
                  54,
                  194,
                  19,
                  14,
                  192,
                  128,
                  177,
                  126,
                  140,
                  90,
                  175,
                  0,
                  205,
                  100
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
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": []
    },
    {
      "name": "initializeValidationConfig",
      "docs": [
        "Initialize the ValidationConfig (global validation registry state)"
      ],
      "discriminator": [
        138,
        209,
        223,
        183,
        48,
        227,
        146,
        152
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  105,
                  111,
                  110,
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
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "ownerOf",
      "docs": [
        "Get agent owner"
      ],
      "discriminator": [
        165,
        85,
        46,
        249,
        100,
        61,
        249,
        112
      ],
      "accounts": [
        {
          "name": "agentAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset (for PDA derivation)"
          ]
        }
      ],
      "args": [],
      "returns": "pubkey"
    },
    {
      "name": "register",
      "docs": [
        "Register agent in a specific registry (base or user)"
      ],
      "discriminator": [
        211,
        124,
        67,
        15,
        211,
        194,
        178,
        240
      ],
      "accounts": [
        {
          "name": "registryConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "collection"
              }
            ]
          }
        },
        {
          "name": "agentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "New asset to create"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "collection",
          "docs": [
            "Collection for this registry"
          ],
          "writable": true
        },
        {
          "name": "userCollectionAuthority",
          "docs": [
            "Optional: PDA authority for user collections"
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  111,
                  108,
                  108,
                  101,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "agentUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "registerWithOptions",
      "docs": [
        "Register agent with explicit ATOM setting (default is true)"
      ],
      "discriminator": [
        177,
        175,
        96,
        41,
        59,
        166,
        13,
        6
      ],
      "accounts": [
        {
          "name": "registryConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "collection"
              }
            ]
          }
        },
        {
          "name": "agentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "New asset to create"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "collection",
          "docs": [
            "Collection for this registry"
          ],
          "writable": true
        },
        {
          "name": "userCollectionAuthority",
          "docs": [
            "Optional: PDA authority for user collections"
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  111,
                  108,
                  108,
                  101,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "agentUri",
          "type": "string"
        },
        {
          "name": "atomEnabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "requestValidation",
      "docs": [
        "Request validation for an agent"
      ],
      "discriminator": [
        72,
        26,
        53,
        67,
        228,
        30,
        144,
        53
      ],
      "accounts": [
        {
          "name": "config",
          "docs": [
            "ValidationConfig for tracking global counters"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  105,
                  111,
                  110,
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
          "name": "requester",
          "docs": [
            "Agent owner (requester)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "docs": [
            "Payer for the validation request account (can be different from requester)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "agentAccount",
          "docs": [
            "Agent account (to verify ownership and get asset)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "assetKey"
              }
            ]
          }
        },
        {
          "name": "asset",
          "docs": [
            "Agent asset (Metaplex Core)"
          ]
        },
        {
          "name": "validationRequest",
          "docs": [
            "Validation request PDA (to be created)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "assetKey"
              },
              {
                "kind": "arg",
                "path": "validatorAddress"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "validator"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "assetKey",
          "type": "pubkey"
        },
        {
          "name": "validatorAddress",
          "type": "pubkey"
        },
        {
          "name": "nonce",
          "type": "u32"
        },
        {
          "name": "requestUri",
          "type": "string"
        },
        {
          "name": "requestHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "respondToValidation",
      "docs": [
        "Validator responds to a validation request",
        "ERC-8004: Enables progressive validation - validators can update responses"
      ],
      "discriminator": [
        64,
        212,
        244,
        6,
        65,
        134,
        212,
        122
      ],
      "accounts": [
        {
          "name": "config",
          "docs": [
            "ValidationConfig for tracking global counters"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  105,
                  111,
                  110,
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
          "name": "validator",
          "docs": [
            "Validator (signer)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "agentAccount",
          "docs": [
            "Agent account (to verify no self-validation)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "assetKey"
              }
            ]
          }
        },
        {
          "name": "asset",
          "docs": [
            "Agent asset (Metaplex Core)"
          ]
        },
        {
          "name": "validationRequest",
          "docs": [
            "Validation request PDA (existing, to be updated)",
            "ERC-8004: Enables progressive validation - validators can update responses"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "assetKey"
              },
              {
                "kind": "arg",
                "path": "validatorAddress"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "assetKey",
          "type": "pubkey"
        },
        {
          "name": "validatorAddress",
          "type": "pubkey"
        },
        {
          "name": "nonce",
          "type": "u32"
        },
        {
          "name": "response",
          "type": "u8"
        },
        {
          "name": "responseUri",
          "type": "string"
        },
        {
          "name": "responseHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "tag",
          "type": "string"
        }
      ]
    },
    {
      "name": "revokeFeedback",
      "docs": [
        "Revoke feedback"
      ],
      "discriminator": [
        211,
        37,
        230,
        82,
        118,
        216,
        137,
        206
      ],
      "accounts": [
        {
          "name": "client",
          "writable": true,
          "signer": true
        },
        {
          "name": "agentAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "atomConfig",
          "docs": [
            "AtomConfig PDA (owned by atom-engine)"
          ],
          "optional": true
        },
        {
          "name": "atomStats",
          "docs": [
            "AtomStats PDA - OPTIONAL initialization",
            "If uninitialized, revoke works without ATOM Engine"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "atomEngineProgram",
          "optional": true
        },
        {
          "name": "registryAuthority",
          "optional": true,
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
                  112,
                  105,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "feedbackIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "rotateBaseRegistry",
      "docs": [
        "Rotate to a new base registry (authority only)"
      ],
      "discriminator": [
        106,
        216,
        250,
        57,
        65,
        122,
        221,
        109
      ],
      "accounts": [
        {
          "name": "rootConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  116,
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
          "name": "newRegistry",
          "docs": [
            "New registry to rotate to (must be Base type)"
          ]
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "setAgentUri",
      "docs": [
        "Set agent URI"
      ],
      "discriminator": [
        43,
        254,
        168,
        104,
        192,
        51,
        39,
        46
      ],
      "accounts": [
        {
          "name": "registryConfig",
          "docs": [
            "Registry config for this collection"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "collection"
              }
            ]
          }
        },
        {
          "name": "agentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset for URI update"
          ],
          "writable": true
        },
        {
          "name": "collection",
          "docs": [
            "Collection account (required by Core for assets in collection)"
          ],
          "writable": true
        },
        {
          "name": "userCollectionAuthority",
          "docs": [
            "User collection authority PDA (required for user registries)",
            "Optional: only needed when registry_type == User"
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  111,
                  108,
                  108,
                  101,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "newUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "setAgentWallet",
      "docs": [
        "Set agent wallet with Ed25519 signature verification"
      ],
      "discriminator": [
        154,
        87,
        251,
        23,
        51,
        12,
        4,
        150
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Agent owner (must be Core asset owner)"
          ],
          "signer": true
        },
        {
          "name": "agentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset - ownership verified in instruction"
          ]
        },
        {
          "name": "instructionsSysvar",
          "docs": [
            "Instructions sysvar for Ed25519 signature introspection"
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "newWallet",
          "type": "pubkey"
        },
        {
          "name": "deadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "setMetadataPda",
      "docs": [
        "Set agent metadata as individual PDA (key_hash = SHA256(key)[0..16])"
      ],
      "discriminator": [
        236,
        60,
        23,
        48,
        138,
        69,
        196,
        153
      ],
      "accounts": [
        {
          "name": "metadataEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116,
                  95,
                  109,
                  101,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              },
              {
                "kind": "arg",
                "path": "keyHash"
              }
            ]
          }
        },
        {
          "name": "agentAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset - verifies ownership"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "Owner must be the asset owner (verified in instruction)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "keyHash",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "key",
          "type": "string"
        },
        {
          "name": "value",
          "type": "bytes"
        },
        {
          "name": "immutable",
          "type": "bool"
        }
      ]
    },
    {
      "name": "syncOwner",
      "docs": [
        "Sync agent owner from Core asset"
      ],
      "discriminator": [
        46,
        5,
        232,
        198,
        59,
        158,
        160,
        119
      ],
      "accounts": [
        {
          "name": "agentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset - ownership is read from asset data"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "transferAgent",
      "docs": [
        "Transfer agent with automatic owner sync"
      ],
      "discriminator": [
        137,
        80,
        56,
        147,
        107,
        99,
        39,
        192
      ],
      "accounts": [
        {
          "name": "agentAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
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
          "name": "asset",
          "docs": [
            "Core asset to transfer"
          ],
          "writable": true
        },
        {
          "name": "collection",
          "docs": [
            "Collection (required by Core transfer)"
          ],
          "writable": true
        },
        {
          "name": "owner",
          "docs": [
            "Current owner (must sign)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "newOwner",
          "docs": [
            "New owner receiving the asset"
          ]
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": []
    },
    {
      "name": "updateUserRegistryMetadata",
      "docs": [
        "Update user registry collection metadata (owner only)"
      ],
      "discriminator": [
        121,
        57,
        38,
        142,
        118,
        18,
        204,
        28
      ],
      "accounts": [
        {
          "name": "collectionAuthority",
          "docs": [
            "PDA authority for signing"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  99,
                  111,
                  108,
                  108,
                  101,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "registryConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "collection"
              }
            ]
          }
        },
        {
          "name": "collection",
          "docs": [
            "Collection to update"
          ],
          "writable": true
        },
        {
          "name": "owner",
          "docs": [
            "Owner of this user registry"
          ],
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "mplCoreProgram",
          "docs": [
            "Metaplex Core program"
          ],
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        }
      ],
      "args": [
        {
          "name": "newName",
          "type": {
            "option": "string"
          }
        },
        {
          "name": "newUri",
          "type": {
            "option": "string"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "agentAccount",
      "discriminator": [
        241,
        119,
        69,
        140,
        233,
        9,
        112,
        50
      ]
    },
    {
      "name": "metadataEntryPda",
      "discriminator": [
        48,
        145,
        12,
        249,
        176,
        141,
        197,
        187
      ]
    },
    {
      "name": "registryConfig",
      "discriminator": [
        23,
        118,
        10,
        246,
        173,
        231,
        243,
        156
      ]
    },
    {
      "name": "rootConfig",
      "discriminator": [
        42,
        216,
        8,
        82,
        19,
        209,
        223,
        246
      ]
    },
    {
      "name": "validationConfig",
      "discriminator": [
        169,
        98,
        16,
        22,
        71,
        9,
        255,
        7
      ]
    },
    {
      "name": "validationRequest",
      "discriminator": [
        130,
        174,
        153,
        111,
        74,
        241,
        40,
        140
      ]
    }
  ],
  "events": [
    {
      "name": "agentOwnerSynced",
      "discriminator": [
        101,
        228,
        184,
        252,
        20,
        185,
        70,
        249
      ]
    },
    {
      "name": "agentRegisteredInRegistry",
      "discriminator": [
        235,
        241,
        87,
        226,
        1,
        223,
        186,
        175
      ]
    },
    {
      "name": "atomEnabled",
      "discriminator": [
        246,
        179,
        174,
        223,
        97,
        110,
        74,
        200
      ]
    },
    {
      "name": "baseRegistryCreated",
      "discriminator": [
        135,
        156,
        231,
        228,
        36,
        76,
        0,
        43
      ]
    },
    {
      "name": "baseRegistryRotated",
      "discriminator": [
        142,
        184,
        57,
        194,
        241,
        29,
        60,
        124
      ]
    },
    {
      "name": "feedbackRevoked",
      "discriminator": [
        205,
        16,
        31,
        94,
        54,
        101,
        16,
        199
      ]
    },
    {
      "name": "metadataDeleted",
      "discriminator": [
        251,
        244,
        153,
        63,
        35,
        252,
        131,
        54
      ]
    },
    {
      "name": "metadataSet",
      "discriminator": [
        190,
        125,
        71,
        119,
        14,
        31,
        26,
        197
      ]
    },
    {
      "name": "newFeedback",
      "discriminator": [
        14,
        162,
        58,
        194,
        131,
        42,
        11,
        149
      ]
    },
    {
      "name": "responseAppended",
      "discriminator": [
        168,
        169,
        214,
        193,
        171,
        1,
        232,
        123
      ]
    },
    {
      "name": "uriUpdated",
      "discriminator": [
        170,
        199,
        78,
        167,
        49,
        84,
        102,
        11
      ]
    },
    {
      "name": "userRegistryCreated",
      "discriminator": [
        245,
        139,
        104,
        155,
        229,
        130,
        152,
        114
      ]
    },
    {
      "name": "validationRequested",
      "discriminator": [
        133,
        42,
        252,
        198,
        82,
        135,
        183,
        65
      ]
    },
    {
      "name": "validationResponded",
      "discriminator": [
        93,
        63,
        246,
        101,
        212,
        208,
        53,
        167
      ]
    },
    {
      "name": "walletUpdated",
      "discriminator": [
        215,
        34,
        10,
        59,
        24,
        114,
        201,
        129
      ]
    }
  ],
  "errors": [
    {
      "code": 12000,
      "name": "uriTooLong",
      "msg": "URI exceeds 200 bytes"
    },
    {
      "code": 12001,
      "name": "keyTooLong",
      "msg": "Key exceeds 32 bytes"
    },
    {
      "code": 12002,
      "name": "valueTooLong",
      "msg": "Value exceeds 256 bytes"
    },
    {
      "code": 12003,
      "name": "metadataLimitReached",
      "msg": "Metadata limit reached"
    },
    {
      "code": 12004,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 12005,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 12006,
      "name": "metadataNotFound",
      "msg": "Metadata key not found"
    },
    {
      "code": 12007,
      "name": "invalidTokenAccount",
      "msg": "Invalid token account"
    },
    {
      "code": 12008,
      "name": "extensionNotFound",
      "msg": "Extension not found"
    },
    {
      "code": 12009,
      "name": "invalidExtensionIndex",
      "msg": "Invalid extension index"
    },
    {
      "code": 12010,
      "name": "invalidCollection",
      "msg": "Invalid collection"
    },
    {
      "code": 12011,
      "name": "invalidAsset",
      "msg": "Invalid asset"
    },
    {
      "code": 12012,
      "name": "transferToSelf",
      "msg": "Transfer to self not allowed"
    },
    {
      "code": 12013,
      "name": "metadataImmutable",
      "msg": "Metadata is immutable and cannot be modified or deleted"
    },
    {
      "code": 12050,
      "name": "invalidScore",
      "msg": "Score must be 0-100"
    },
    {
      "code": 12051,
      "name": "responseUriTooLong",
      "msg": "Response URI exceeds 200 bytes"
    },
    {
      "code": 12052,
      "name": "alreadyRevoked",
      "msg": "Feedback already revoked"
    },
    {
      "code": 12053,
      "name": "agentNotFound",
      "msg": "Agent not found"
    },
    {
      "code": 12054,
      "name": "feedbackNotFound",
      "msg": "Feedback not found"
    },
    {
      "code": 12055,
      "name": "invalidFeedbackIndex",
      "msg": "Invalid feedback index"
    },
    {
      "code": 12056,
      "name": "tagTooLong",
      "msg": "Tag exceeds 32 bytes"
    },
    {
      "code": 12057,
      "name": "emptyTags",
      "msg": "At least one tag must be provided"
    },
    {
      "code": 12058,
      "name": "atomStatsNotInitialized",
      "msg": "ATOM stats not initialized - call initialize_atom_stats first"
    },
    {
      "code": 12059,
      "name": "atomAlreadyEnabled",
      "msg": "ATOM already enabled for this agent"
    },
    {
      "code": 12100,
      "name": "requestUriTooLong",
      "msg": "Request URI exceeds 200 bytes"
    },
    {
      "code": 12101,
      "name": "invalidResponse",
      "msg": "Response must be 0-100"
    },
    {
      "code": 12102,
      "name": "unauthorizedValidator",
      "msg": "Unauthorized validator"
    },
    {
      "code": 12103,
      "name": "unauthorizedRequester",
      "msg": "Unauthorized requester"
    },
    {
      "code": 12104,
      "name": "requestNotFound",
      "msg": "Validation request not found"
    },
    {
      "code": 12105,
      "name": "invalidNonce",
      "msg": "Invalid nonce"
    },
    {
      "code": 12106,
      "name": "requestHashMismatch",
      "msg": "Request hash mismatch"
    },
    {
      "code": 12107,
      "name": "invalidRentReceiver",
      "msg": "Rent receiver must be agent owner"
    },
    {
      "code": 12150,
      "name": "keyHashMismatch",
      "msg": "Key hash does not match SHA256(key)"
    },
    {
      "code": 12151,
      "name": "keyHashCollision",
      "msg": "Key hash collision detected - stored key differs from provided key"
    },
    {
      "code": 12152,
      "name": "reservedMetadataKey",
      "msg": "Reserved metadata key - use dedicated instruction"
    },
    {
      "code": 12200,
      "name": "deadlineExpired",
      "msg": "Deadline has expired"
    },
    {
      "code": 12201,
      "name": "deadlineTooFar",
      "msg": "Deadline too far in the future (max 5 minutes)"
    },
    {
      "code": 12202,
      "name": "missingSignatureVerification",
      "msg": "Missing Ed25519 signature verification instruction"
    },
    {
      "code": 12203,
      "name": "invalidSignature",
      "msg": "Ed25519 signature verification failed"
    },
    {
      "code": 12250,
      "name": "invalidRegistryType",
      "msg": "Invalid registry type for this operation"
    },
    {
      "code": 12251,
      "name": "rootAlreadyInitialized",
      "msg": "Root config already initialized"
    },
    {
      "code": 12252,
      "name": "registryAlreadyExists",
      "msg": "Registry already exists for this collection"
    },
    {
      "code": 12253,
      "name": "collectionNameTooLong",
      "msg": "Collection name exceeds maximum length"
    },
    {
      "code": 12254,
      "name": "collectionUriTooLong",
      "msg": "Collection URI exceeds maximum length"
    },
    {
      "code": 12255,
      "name": "registrationNotAllowed",
      "msg": "Cannot register in this registry"
    },
    {
      "code": 12300,
      "name": "selfFeedbackNotAllowed",
      "msg": "Self-feedback is not allowed - agent owner cannot give feedback to their own agent"
    },
    {
      "code": 12301,
      "name": "selfValidationNotAllowed",
      "msg": "Self-validation is not allowed - agent owner cannot validate their own agent"
    },
    {
      "code": 12400,
      "name": "invalidProgram",
      "msg": "Invalid program ID for CPI call"
    },
    {
      "code": 12401,
      "name": "invalidAtomStatsAccount",
      "msg": "Invalid AtomStats account - must be correct PDA for this asset"
    }
  ],
  "types": [
    {
      "name": "agentAccount",
      "docs": [
        "Agent account (represents an AI agent identity)",
        "Seeds: [b\"agent\", asset.key()]",
        "EVM conformity: asset = unique identifier (no sequential agent_id)",
        "Keeps nft_name to avoid extra Metaplex RPC calls"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "collection",
            "docs": [
              "Collection this agent belongs to (offset 8 - for filtering)"
            ],
            "type": "pubkey"
          },
          {
            "name": "owner",
            "docs": [
              "Agent owner (cached from Core asset)"
            ],
            "type": "pubkey"
          },
          {
            "name": "asset",
            "docs": [
              "Metaplex Core asset address (unique identifier)"
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "atomEnabled",
            "docs": [
              "ATOM Engine enabled (irreversible once set to true)"
            ],
            "type": "bool"
          },
          {
            "name": "agentWallet",
            "docs": [
              "Agent's operational wallet (set via Ed25519 signature verification)",
              "None = no wallet set, Some = wallet address"
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "agentUri",
            "docs": [
              "Agent URI (IPFS/Arweave/HTTP link, max 250 bytes)"
            ],
            "type": "string"
          },
          {
            "name": "nftName",
            "docs": [
              "NFT name (e.g., \"Agent #123\", max 32 bytes)",
              "Kept to avoid extra RPC to Metaplex for display"
            ],
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "agentOwnerSynced",
      "docs": [
        "Event emitted when agent owner is synced after transfer"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "oldOwner",
            "type": "pubkey"
          },
          {
            "name": "newOwner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "agentRegisteredInRegistry",
      "docs": [
        "Event emitted when agent is registered in a specific registry",
        "Field order: fixed-size first (Pubkey, bool), variable-size last (String)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "registry",
            "type": "pubkey"
          },
          {
            "name": "collection",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "atomEnabled",
            "type": "bool"
          },
          {
            "name": "agentUri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "atomEnabled",
      "docs": [
        "Event emitted when ATOM is enabled for an agent (one-way)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "enabledBy",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "baseRegistryCreated",
      "docs": [
        "Event emitted when a base registry is created"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "registry",
            "type": "pubkey"
          },
          {
            "name": "collection",
            "type": "pubkey"
          },
          {
            "name": "baseIndex",
            "type": "u32"
          },
          {
            "name": "createdBy",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "baseRegistryRotated",
      "docs": [
        "Event emitted when base registry is rotated"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldRegistry",
            "type": "pubkey"
          },
          {
            "name": "newRegistry",
            "type": "pubkey"
          },
          {
            "name": "rotatedBy",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "feedbackRevoked",
      "docs": [
        "Event emitted when feedback is revoked"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "clientAddress",
            "type": "pubkey"
          },
          {
            "name": "feedbackIndex",
            "type": "u64"
          },
          {
            "name": "originalScore",
            "type": "u8"
          },
          {
            "name": "atomEnabled",
            "type": "bool"
          },
          {
            "name": "hadImpact",
            "type": "bool"
          },
          {
            "name": "newTrustTier",
            "type": "u8"
          },
          {
            "name": "newQualityScore",
            "type": "u16"
          },
          {
            "name": "newConfidence",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "metadataDeleted",
      "docs": [
        "Event emitted when agent metadata is deleted"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "key",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "metadataEntryPda",
      "docs": [
        "Individual metadata entry stored as separate PDA",
        "Seeds: [b\"agent_meta\", asset.key(), key_hash[0..16]]",
        "key_hash is SHA256(key)[0..16] for collision resistance (2^128 space)",
        "",
        "This replaces Vec<MetadataEntry> in AgentAccount for:",
        "- Unlimited metadata entries per agent",
        "- Ability to delete entries and recover rent",
        "- Optional immutability for certification/audit use cases"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "docs": [
              "Asset this metadata belongs to (unique identifier)"
            ],
            "type": "pubkey"
          },
          {
            "name": "immutable",
            "docs": [
              "If true, this metadata cannot be modified or deleted (static - fixed offset)"
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed (static - fixed offset)"
            ],
            "type": "u8"
          },
          {
            "name": "metadataKey",
            "docs": [
              "Metadata key (max 32 bytes)"
            ],
            "type": "string"
          },
          {
            "name": "metadataValue",
            "docs": [
              "Metadata value (max 250 bytes, arbitrary binary data)"
            ],
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "metadataSet",
      "docs": [
        "Event emitted when agent metadata is set",
        "Field order optimized for indexing: fixed-size fields first, variable-size (String/Vec) last"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "immutable",
            "type": "bool"
          },
          {
            "name": "key",
            "type": "string"
          },
          {
            "name": "value",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "newFeedback",
      "docs": [
        "Event emitted when new feedback is given",
        "Field order optimized for indexing: fixed-size fields first, variable-size (String) last"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "clientAddress",
            "type": "pubkey"
          },
          {
            "name": "feedbackIndex",
            "type": "u64"
          },
          {
            "name": "score",
            "type": "u8"
          },
          {
            "name": "feedbackHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "atomEnabled",
            "type": "bool"
          },
          {
            "name": "newTrustTier",
            "type": "u8"
          },
          {
            "name": "newQualityScore",
            "type": "u16"
          },
          {
            "name": "newConfidence",
            "type": "u16"
          },
          {
            "name": "newRiskScore",
            "type": "u8"
          },
          {
            "name": "newDiversityRatio",
            "type": "u8"
          },
          {
            "name": "isUniqueClient",
            "type": "bool"
          },
          {
            "name": "tag1",
            "type": "string"
          },
          {
            "name": "tag2",
            "type": "string"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "feedbackUri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "registryConfig",
      "docs": [
        "Per-collection registry configuration - Without counters (off-chain via indexer)",
        "Seeds: [\"registry_config\", collection.key()]",
        "EVM conformity: counters (total_agents, next_id) computed off-chain"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "collection",
            "docs": [
              "Metaplex Core Collection address (also in seeds)"
            ],
            "type": "pubkey"
          },
          {
            "name": "registryType",
            "docs": [
              "Registry type: Base (protocol) or User (custom shard)"
            ],
            "type": {
              "defined": {
                "name": "registryType"
              }
            }
          },
          {
            "name": "authority",
            "docs": [
              "Authority (protocol authority for Base, user for User)"
            ],
            "type": "pubkey"
          },
          {
            "name": "baseIndex",
            "docs": [
              "Base registry index (0, 1, 2...) - only meaningful for Base type"
            ],
            "type": "u32"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "registryType",
      "docs": [
        "Registry type - Base (protocol managed) or User (custom shards)"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "base"
          },
          {
            "name": "user"
          }
        ]
      }
    },
    {
      "name": "responseAppended",
      "docs": [
        "Event emitted when response is appended to feedback",
        "Field order optimized for indexing: fixed-size fields first, variable-size (String) last"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "client",
            "type": "pubkey"
          },
          {
            "name": "feedbackIndex",
            "type": "u64"
          },
          {
            "name": "responder",
            "type": "pubkey"
          },
          {
            "name": "responseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "responseUri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "rootConfig",
      "docs": [
        "Root configuration - Global pointer to current base registry",
        "Seeds: [\"root_config\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "currentBaseRegistry",
            "docs": [
              "Current active base registry for new agent registrations"
            ],
            "type": "pubkey"
          },
          {
            "name": "baseRegistryCount",
            "docs": [
              "Number of base registries created (for indexing)"
            ],
            "type": "u32"
          },
          {
            "name": "authority",
            "docs": [
              "Authority (can create base registries, rotate)"
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "uriUpdated",
      "docs": [
        "Event emitted when agent URI is updated",
        "Field order optimized for indexing: fixed-size fields first, variable-size (String) last"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "updatedBy",
            "type": "pubkey"
          },
          {
            "name": "newUri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "userRegistryCreated",
      "docs": [
        "Event emitted when a user registry is created"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "registry",
            "type": "pubkey"
          },
          {
            "name": "collection",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "validationConfig",
      "docs": [
        "Global validation registry configuration"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Registry authority (program owner)"
            ],
            "type": "pubkey"
          },
          {
            "name": "totalRequests",
            "docs": [
              "Total validation requests created"
            ],
            "type": "u64"
          },
          {
            "name": "totalResponses",
            "docs": [
              "Total validation responses recorded"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "validationRequest",
      "docs": [
        "Individual validation request (state stored on-chain)",
        "URIs, tags, hashes (except request_hash), and created_at are stored in events only",
        "This optimized structure follows ERC-8004 immutability requirements while minimizing rent cost"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "docs": [
              "Agent asset (Metaplex Core) - used as primary identifier"
            ],
            "type": "pubkey"
          },
          {
            "name": "validatorAddress",
            "docs": [
              "Validator address (who can respond)"
            ],
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "docs": [
              "Nonce for multiple validations from same validator (enables re-validation)"
            ],
            "type": "u32"
          },
          {
            "name": "requestHash",
            "docs": [
              "Request hash (SHA-256 of request content for integrity verification)"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "response",
            "docs": [
              "Current response value (0-100, 0 = pending/no response)",
              "ERC-8004: 0 is a valid response score, use responded_at to determine pending status"
            ],
            "type": "u8"
          },
          {
            "name": "respondedAt",
            "docs": [
              "Timestamp of last response (0 if no response yet)",
              "ERC-8004: Equivalent to lastUpdate, enables progressive validation"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validationRequested",
      "docs": [
        "Event emitted when validation is requested",
        "Field order optimized for indexing: fixed-size fields first, variable-size (String) last",
        "ERC-8004: Events store full metadata not kept on-chain for rent optimization"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "validatorAddress",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "requester",
            "type": "pubkey"
          },
          {
            "name": "requestHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "requestUri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "validationResponded",
      "docs": [
        "Event emitted when validator responds",
        "Field order optimized for indexing: fixed-size fields first, variable-size (String) last",
        "ERC-8004: Enables progressive validation - validators can update responses"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "validatorAddress",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "response",
            "type": "u8"
          },
          {
            "name": "responseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "respondedAt",
            "type": "i64"
          },
          {
            "name": "responseUri",
            "type": "string"
          },
          {
            "name": "tag",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "walletUpdated",
      "docs": [
        "Event emitted when agent wallet is set or updated"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "oldWallet",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "newWallet",
            "type": "pubkey"
          },
          {
            "name": "updatedBy",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
