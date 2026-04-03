# ⬡ ZYLOGEN PROTOCOL

> **Trustless settlement infrastructure where AI validates, arbitrates, and pays — autonomously.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network: Base Mainnet](https://img.shields.io/badge/Network-Base%20Mainnet-0052FF?logo=coinbase)](https://basescan.org/address/0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f)
[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://frontend-phi-five-49.vercel.app)

---

## Overview

Zylogen Protocol is an **autonomic settlement layer** for AI-to-AI and AI-to-Human payments on Base L2. It replaces human arbitrators with a Claude-powered oracle that autonomously validates task completion, arbitrates disputes, and triggers on-chain settlement — all without manual intervention.

Any agent, service, or person can lock ETH into a micro-escrow keyed by a `taskHash`. When the off-chain task is complete, the AI oracle reviews the evidence, decides whether to release or reject, and executes the settlement transaction directly. No multisig, no DAO vote, no waiting.

Use cases include:
- Autonomous AI agents paying each other for sub-task completion
- Freelance work settled by AI arbitration instead of platform escrow
- Programmatic bounties resolved on-chain the moment criteria are met

---

## Architecture

```
  ┌─────────────┐     lock(taskHash, provider)      ┌──────────────────┐
  │   Sender    │ ──────────────────────────────────▶│  TaskEscrow.sol  │
  │ (AI / Human)│          + ETH deposit             │  Base Mainnet    │
  └─────────────┘                                    └────────┬─────────┘
                                                              │
                                               TaskCreated event emitted
                                                              │
                                                    ┌─────────▼─────────┐
                                                    │   Oracle Backend   │
                                                    │  (scripts/oracle) │
                                                    └─────────┬─────────┘
                                                              │
                                                  POST task data to Claude API
                                                              │
                                                    ┌─────────▼─────────┐
                                                    │   Claude Sonnet   │
                                                    │  (AI Arbitrator)  │
                                                    └─────────┬─────────┘
                                                              │
                                              APPROVE ◀───────┴───────▶ REJECT
                                                 │                          │
                                    release(taskHash)              funds stay locked
                                         tx sent                  (reclaim after 7d)
                                                 │
                                        ┌────────▼────────┐
                                        │    Provider     │
                                        │ receives 99%    │
                                        │ treasury gets 1%│
                                        └─────────────────┘
```

### The Three-Step Flow

| Step | Action | Who |
|------|--------|-----|
| **1. Lock** | Sender calls `lock(taskHash, provider)` with ETH attached. Funds are held in the contract until settled or reclaimed. | Sender |
| **2. Validate** | The oracle backend detects the `TaskCreated` event and forwards task metadata to Claude, which applies validation rules and returns `APPROVE` or `REJECT`. | AI Oracle |
| **3. Settle** | On approval, the oracle wallet calls `release(taskHash)`. The provider receives 99% of the deposit; 1% goes to the protocol treasury. If no release occurs within 7 days, the sender can `reclaim()` the full deposit. | Smart Contract |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.20, OpenZeppelin ReentrancyGuard |
| Development & Testing | Hardhat, Hardhat Toolbox |
| Blockchain Interaction | Ethers.js v6 |
| AI Oracle | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Frontend | Vite + React |
| Network | Base Mainnet (L2) |
| Config | dotenv |

---

## Contract

**TaskEscrow** — deployed on Base Mainnet

```
0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f
```

[View on Basescan ↗](https://basescan.org/address/0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f)

Key properties:
- Storage-optimised: each escrow fits in exactly **two 32-byte slots**
- 1% protocol fee on release, forwarded to treasury
- 7-day timeout after which senders may `reclaim()` unresolved deposits
- Full reentrancy protection via OpenZeppelin
- CEI (Checks-Effects-Interactions) pattern throughout

---

## Live Demo

**[https://frontend-phi-five-49.vercel.app](https://frontend-phi-five-49.vercel.app)**

Connect a wallet on Base Mainnet to lock funds, track escrow status, and watch the AI oracle settle tasks in real time.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- An RPC endpoint for Base Mainnet (e.g. Alchemy or the public `https://mainnet.base.org`)
- A funded wallet for the oracle signer

### Install

```bash
git clone https://github.com/elwichito/zylogen-protocol.git
cd zylogen-protocol
npm install
```

### Configure

```bash
cp .env.example .env
```

```dotenv
# .env
ORACLE_PRIVATE_KEY=0x...          # wallet that calls release()
ANTHROPIC_API_KEY=sk-ant-...      # Claude API key
BASE_RPC_URL=https://mainnet.base.org
DEPLOYER_PRIVATE_KEY=0x...        # only needed for deployment
TREASURY_ADDRESS=0x...
BASESCAN_API_KEY=...              # optional, for contract verification
```

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test
```

### Deploy to Base Mainnet

```bash
npx hardhat ignition deploy ./ignition/modules/TaskEscrow.js --network base
```

### Start the Oracle

```bash
node scripts/oracle.js
```

The oracle connects to Base Mainnet, subscribes to `TaskCreated` events, and begins validating tasks autonomously. A heartbeat log line is printed every 60 seconds to confirm the process is alive.

---

## How the Oracle Works

`scripts/oracle.js` is a long-running Node.js process that bridges the blockchain and the Claude API.

```
1. Connect  →  ethers.JsonRpcProvider (Base Mainnet)
2. Listen   →  contract.on('TaskCreated', handler)
3. Validate →  POST to Claude API with task metadata
4. Decide   →  parse APPROVE / REJECT from Claude's response
5. Settle   →  contract.release(taskHash) if approved
```

**Validation rules Claude enforces:**

- Amount must be greater than 0
- Deadline must be in the future
- Sender and provider must be distinct, non-zero addresses
- `taskHash` must be a valid 32-byte hex string

**Error handling:**

- Claude API failures are caught and logged per-task — the oracle skips rather than auto-approves on error
- On-chain `release()` reverts are caught per-task and do not crash the process
- The process exits with code 1 only on fatal startup errors (missing env vars, no RPC)

**Extending the oracle:**

The validation prompt in `validateWithClaude()` can be augmented with off-chain evidence — IPFS hashes, API results, signed attestations — to support richer arbitration logic without changing the on-chain contract.

---

## Budget Breakdown

Built with a **$200 total budget**.

| Item | Cost |
|------|------|
| Base Mainnet deployment gas | ~$2 |
| Alchemy RPC (free tier) | $0 |
| Vercel hosting (free tier) | $0 |
| Claude API (~$0.01 per validation) | ~$1 |
| Misc | ~$197 remaining |
| **Total** | **< $200** |

Infrastructure costs at scale are dominated by Claude API usage (~$0.01 per task validated) and Base L2 gas (sub-cent per transaction).

---

## License

[MIT](LICENSE)
