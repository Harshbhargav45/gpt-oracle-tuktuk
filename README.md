# GPT Oracle + TukTuk — Solana Anchor Program

A minimal but production-ready Anchor program that:

1. **Registers** an AI agent with the [MagicBlock Solana GPT Oracle](https://docs.magicblock.gg).
2. **Sends prompts** to GPT via on-chain CPI and receives the response through a callback instruction.
3. **Schedules** those interactions autonomously using [TukTuk](https://github.com/helium/tuktuk) — no wallet required at execution time.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│               gpt_oracle (this program)       │
│                                               │
│  initialize ──CPI──► solana_gpt_oracle        │
│                         create_llm_context    │
│                                               │
│  interact_with_llm ─CPI──► solana_gpt_oracle  │
│                               interact        │
│                                               │
│  callback_from_llm ◄── called by Oracle       │
│     (verifies Identity signer, logs response) │
│                                               │
│  schedule ──CPI──► tuktuk_program             │
│               queue_task_v0                   │
│               (enqueues interact_with_llm)    │
└──────────────────────────────────────────────┘
```

### Key accounts

| Account | Owner | Description |
|---|---|---|
| `Agent` | this program | Stores the LLM context pubkey and PDA bump |
| `ContextAccount` | Oracle program | Conversation history / system prompt |
| `Interaction` | Oracle program | Pending or completed LLM request |
| `Identity` | Oracle program | Trusted signer that delivers callbacks |
| `TaskQueue` | TukTuk program | Queue of scheduled transactions |

---

## Prerequisites

| Tool | Version |
|---|---|
| Rust | 1.79.0 (see `rust-toolchain.toml`) |
| Solana CLI | ≥ 1.18 |
| Anchor CLI | 0.32.1 |
| Node.js | ≥ 18 |
| Yarn | ≥ 1.22 |

---

## Quick start

```bash
# 1. Clone the project
git clone https://github.com/Harshbhargav45/gpt-oracle-tuktuk.git
cd gpt-oracle-tuktuk

# 2. Install JS dependencies
yarn install

# 3. Build the program (generates IDL and TypeScript types in target/)
anchor build

# 4. Run the end-to-end integration tests on Localnet
# Note: Anchor automatically clones required accounts (TukTuk and Oracle) from devnet 
# via Anchor.toml configuration, bypassing the need for manual devnet deployment.
anchor test
```

> **Note** – The `solana-gpt-oracle` crate is sourced from
> `../../../super-smart-contracts/programs/solana-gpt-oracle` (relative to
> `programs/gpt-oracle/`).  Clone the
> [MagicBlock super-smart-contracts repo](https://github.com/magicblock-labs/super-smart-contracts)
> at the right path, or update `Cargo.toml` to point at the correct location.

---

## Program instructions

### `initialize`

Creates the `Agent` PDA and registers an LLM context (system prompt) inside
the Oracle program.  Must be called once per payer.

```
payer ──► initialize ──► Agent PDA (this program)
                    └──► ContextAccount (Oracle program)
```

### `interact_with_llm`

Sends the agent description as a prompt.  The Oracle relayer picks this up
off-chain, calls GPT, and delivers the answer via `callback_from_llm`.

### `callback_from_llm(response: String)`

Called by the Oracle's `Identity` signer.  Verifies the signer, logs the
GPT response on-chain, and is the extension point for custom downstream logic.

### `schedule(task_id: u16)`

Queues `interact_with_llm` in a TukTuk task queue so it executes
autonomously (crank operators run it for the `crank_reward`).

---

## Customising the agent

Edit `programs/gpt-oracle/src/constants.rs`:

```rust
// The system prompt sent to GPT when the context is created.
pub const AGENT_DESC: &str = "You are a helpful Solana trading assistant.";
```

To change what the agent *asks* GPT each time, update the `AGENT_DESC`
passed in `interact.rs → interact_with_llm()` or add a separate `prompt`
field to the `Interact` instruction.

---

## Extending the callback

`callback.rs` currently just logs the response.  Common extensions:

```rust
// Store the response in an account
response_account.last_response = response.clone();

// Emit a program event
emit!(GptResponseEvent { response });

// Trigger another CPI
some_other_program::cpi::process_response(cpi_ctx, response)?;
```

---

## Environment variables (optional)

If you use a `.env` file for test configuration:

```
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
ANCHOR_WALLET=~/.config/solana/id.json
```

---

## Project structure

```
gpt-oracle-tuktuk/
├── Anchor.toml                  # Anchor configuration
├── Cargo.toml                   # Workspace manifest
├── package.json                 # JS/TS dependencies
├── tsconfig.json
├── rust-toolchain.toml
├── migrations/
│   └── deploy.ts
├── programs/
│   └── gpt-oracle/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs           # Program entry point & instruction dispatch
│           ├── constants.rs     # Seeds, agent description
│           ├── error.rs         # Custom error codes
│           ├── state/
│           │   ├── mod.rs
│           │   └── agent.rs     # Agent PDA struct
│           └── instructions/
│               ├── mod.rs
│               ├── initialize.rs
│               ├── interact.rs
│               ├── callback.rs
│               └── schedule.rs
└── tests/
    └── gpt-oracle.ts            # End-to-end Mocha tests
```
