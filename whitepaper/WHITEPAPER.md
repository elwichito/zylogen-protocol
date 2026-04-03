# Zylogen Protocol: The Autonomic Settlement Layer for Machine-Native Commerce

**Version 1.0 — April 2026**

**Contract (Base Mainnet):** `0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f`

**Website:** [zylogen.io](https://zylogen.io) · **Demo:** [frontend-phi-five-49.vercel.app](https://frontend-phi-five-49.vercel.app)

---

> *"The economy of autonomous agents will be denominated not in dollars but in trust — and trust, at machine speed, must be enforced on-chain."*

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [The Problem: Payments Without Guarantees](#2-the-problem-payments-without-guarantees)
3. [The Solution: Lock-Validate-Settle](#3-the-solution-lock-validate-settle)
4. [Smart Contract Design](#4-smart-contract-design)
5. [The AI Oracle](#5-the-ai-oracle)
6. [Market Positioning](#6-market-positioning)
7. [Token Economics: $ZYL](#7-token-economics-zyl)
8. [Technical Roadmap](#8-technical-roadmap)
9. [Security Model](#9-security-model)
10. [Team](#10-team)
11. [Conclusion](#11-conclusion)
12. [References](#12-references)

---

## 1. Abstract

The emergence of large language model (LLM) agents capable of autonomous economic activity — hiring sub-agents, purchasing API capacity, commissioning data pipelines — creates an unprecedented demand for payment infrastructure that machines can use without human intermediation. Existing solutions address only the payment layer: moving value from point A to point B. They do not address the validation layer: confirming that the work warranting payment was actually performed.

**Zylogen Protocol** is the first autonomic settlement layer purpose-built for machine-native commerce. It introduces a three-phase architecture — **Lock, Validate, Settle** — in which an AI oracle powered by Claude evaluates task completion evidence and triggers cryptographically guaranteed on-chain settlement without human review, multisig delays, or DAO governance overhead.

Deployed on Base Mainnet at `0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f`, the protocol's `TaskEscrow` smart contract packs each escrow record into exactly two 32-byte storage slots, achieving near-minimal gas costs on an L2 already optimized for throughput. A 1% protocol fee funds the treasury; a 7-day reclaim window protects senders against oracle failure.

The native token **$ZYL** (fixed supply: 100,000,000) captures protocol value through fee discounts, oracle staking, and on-chain governance. At projected transaction volumes consistent with the agentic AI economy's trajectory — estimated to reach $45B in autonomous agent spend by 2028 — Zylogen is positioned as essential infrastructure analogous to Stripe for human commerce, but designed from first principles for machines.

This whitepaper describes the technical architecture, economic model, competitive differentiation, security guarantees, and development roadmap of the Zylogen Protocol.

---

## 2. The Problem: Payments Without Guarantees

### 2.1 The Agentic Economy Is Already Here

Autonomous AI agents are no longer theoretical. Systems like OpenAI's Operator, Anthropic's Claude agents, and a growing ecosystem of open-source LLM frameworks execute multi-step workflows that include real economic transactions: purchasing compute, hiring specialized sub-agents, licensing datasets, and commissioning third-party services. A 2025 McKinsey estimate projects that 40% of enterprise workloads will involve at least one autonomous agent decision by 2027. The financial flows underlying these decisions represent a new asset class of machine-originated payments.

This economy requires infrastructure. Specifically, it requires infrastructure that satisfies three constraints simultaneously:

1. **Trustlessness** — Neither party should need to trust the other; the protocol enforces settlement rules impartially.
2. **Validation** — Payment should be contingent on verifiable task completion, not merely on a counterparty's claim.
3. **Autonomy** — The entire cycle — from task creation through payment — must execute without human approval at any stage.

No existing solution satisfies all three.

### 2.2 Existing Payment Rails Are Payment-Only

**x402 (HTTP 402 / Coinbase)** is a promising protocol standard that embeds crypto micropayments into the HTTP request-response cycle. An agent making an API call can include a payment header; the server validates the payment and returns content. x402 solves the frictionless payment initiation problem elegantly. However, it is fundamentally a payment-initiation protocol, not a settlement-assurance protocol. x402 has no concept of escrow: value moves at request time, before any work is performed or verified. An agent paying via x402 for a code generation task that returns garbage has no recourse; the payment is gone.

**Stripe Multi-Party Payments (MPP)** represents the gold standard of human-scale payment orchestration. Its Connect platform handles marketplace disbursements, escrow-like "payment intents," and dispute workflows. But Stripe MPP is architected for human commerce: dispute resolution requires human customer support, chargebacks involve banking relationships, and the settlement window is days-to-weeks rather than seconds. More fundamentally, Stripe is a centralized intermediary — it can reverse payments, freeze accounts, and require KYC verification that AI agents cannot provide.

**Existing crypto escrow contracts** (e.g., Kleros, Aragon Court) rely on human jurors or token-holder votes for dispute resolution. This introduces latency (hours to days), cost (juror fees), and a trust assumption (token holders act honestly) that is incompatible with high-frequency, low-value machine transactions.

### 2.3 The Validation Gap

The missing primitive is **automated validation**: a system that can assess whether an off-chain task was completed to specification and trigger on-chain settlement accordingly — at machine speed, without human intervention, and with cryptographic finality.

Consider the following workflow:

> Agent A (a data pipeline orchestrator) tasks Agent B (a web scraping agent) with extracting 10,000 product records from a target site by a given deadline. Agent A locks 0.05 ETH into escrow. Agent B completes the extraction and submits a IPFS-pinned JSON file as evidence. Who decides if the extraction meets the specification?

In the x402 model, Agent A would have already paid at task initiation — with no recourse if Agent B delivers incomplete data. In a human-arbitrated system, a human would review the JSON file against the specification — introducing latency and cost that destroys the economics of a $50 micro-transaction. In the Zylogen model, an AI oracle evaluates the evidence autonomously and settles the escrow in seconds.

This is the validation gap. Zylogen closes it.

---

## 3. The Solution: Lock-Validate-Settle

Zylogen Protocol introduces a three-phase settlement primitive that maps cleanly onto the lifecycle of any agent-to-agent or agent-to-service transaction.

```
  Phase 1: LOCK          Phase 2: VALIDATE        Phase 3: SETTLE
  ─────────────────      ──────────────────────    ───────────────────────
  Sender calls            Oracle detects event,     On APPROVE:
  lock(taskHash,          queries Claude with        release(taskHash)
  provider) with          task metadata +            → provider 99%
  ETH attached.           completion evidence.       → treasury 1%
                          Returns APPROVE /
  Funds held in           REJECT.                   On REJECT / timeout:
  TaskEscrow.sol.                                    sender calls
                                                     reclaim(taskHash)
                                                     after 7 days.
```

### 3.1 Phase 1: Lock

The sender initiates a task by calling `lock(bytes32 taskHash, address provider)` on the `TaskEscrow` contract with an ETH value attached. The `taskHash` is a 32-byte identifier — typically the keccak256 hash of the task specification — that uniquely identifies the off-chain work to be performed. The `provider` is the address that will receive funds upon successful completion.

The contract records the sender, amount, provider, and a 7-day deadline in two tightly packed 32-byte storage slots (see Section 4) and emits a `TaskCreated` event. The ETH is now custodied by the contract; neither the sender nor the provider can unilaterally access it during the active window.

This phase establishes the economic commitment. The sender cannot fabricate a dispute after the fact to avoid payment; the provider cannot claim payment before completing work. Both parties are incentivized to participate in good faith.

### 3.2 Phase 2: Validate

The Zylogen oracle backend is a long-running process subscribed to `TaskCreated` events on the Base Mainnet contract. Upon detecting a new task, it assembles a validation context — the task specification (recoverable from the `taskHash`), any off-chain evidence provided by the provider (IPFS hashes, signed attestations, API responses), and the contract parameters (amount, deadline) — and submits this context to the Claude API.

Claude evaluates the evidence against a structured validation prompt that enforces baseline integrity rules (valid addresses, non-zero amount, future deadline, distinct sender and provider) and any task-specific completion criteria encoded in the prompt. It returns a structured decision: `APPROVE` or `REJECT`, with a reasoning summary for auditability.

This phase is the protocol's key innovation. By delegating validation to a state-of-the-art LLM rather than a human arbitrator or a rigid rule engine, Zylogen achieves:

- **Semantic understanding** — Claude can evaluate natural language task specifications against natural language completion evidence, something no deterministic smart contract can do.
- **Speed** — LLM inference takes seconds, not hours or days.
- **Cost efficiency** — At approximately $0.01 per validation at current Claude API pricing, the validation cost is negligible relative to any economically meaningful escrow amount.
- **Extensibility** — The validation prompt can be augmented with domain-specific rules, multi-modal evidence, or external API calls without modifying the on-chain contract.

### 3.3 Phase 3: Settle

On an `APPROVE` decision, the oracle wallet calls `release(bytes32 taskHash)` on the contract. The contract verifies the caller is the authorized oracle, deletes the escrow record (clearing two storage slots, earning a gas refund), and transfers funds: 99% to the provider, 1% to the protocol treasury.

On a `REJECT` decision, the oracle takes no action. The escrow remains locked. If no `release` is called within 7 days of the `lock` transaction, the sender may call `reclaim(bytes32 taskHash)` to recover the full deposit. This timeout mechanism ensures that oracle failures — network outages, API errors, or edge cases that stump the LLM — do not result in permanently locked funds.

The settlement is final and atomic. There is no appeals process, no chargeback, and no centralized operator with the ability to reverse the transfer. The protocol enforces the outcome; the parties must trust the oracle's judgment upfront, which they do by choosing to use the protocol.

---

## 4. Smart Contract Design

The `TaskEscrow` contract is deployed at `0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f` on Base Mainnet. It is written in Solidity 0.8.20 and imports only OpenZeppelin's `ReentrancyGuard`. The design philosophy prioritizes gas minimization, security correctness, and simplicity over feature richness.

### 4.1 Storage Slot Packing

The central optimization is the `Escrow` struct layout, engineered to occupy exactly two 32-byte EVM storage slots:

```
Slot 0 │ sender   (160 bits) │ amount   (96 bits)  │ = 256 bits total
Slot 1 │ provider (160 bits) │ deadline (40 bits)  │ = 200 bits used
```

**Slot 0** stores the sender address (20 bytes / 160 bits) and the ETH amount as `uint96` (12 bytes / 96 bits). A `uint96` can represent values up to approximately 79 billion ETH — far exceeding any conceivable escrow amount — while consuming only 12 bytes rather than the 32 bytes a `uint256` would require.

**Slot 1** stores the provider address (20 bytes / 160 bits) and the deadline as `uint40` (5 bytes / 40 bits). A `uint40` timestamp can represent dates up to approximately the year 36,812 — more than adequate for a 7-day-from-now deadline — while freeing 7 bytes compared to a `uint64`.

The sentinel condition `amount == 0` doubles as the "empty slot" indicator. A freshly initialized storage slot has all bits set to zero; if `amount` is non-zero, the escrow is active. This eliminates the need for an explicit `bool active` field and its associated storage cost.

**Gas impact:** On Base L2, a `lock()` call writes to two new storage slots (cold write: 22,100 gas per slot) plus calldata overhead. The two-slot design is the theoretical minimum for the data we store, meaning `lock()` achieves near-minimal write cost for a non-trivial struct. A `release()` call deletes both slots, earning a 4,800 gas refund per slot (9,600 total under EIP-3529), partially offsetting the read and transfer costs.

### 4.2 Custom Errors

The contract uses Solidity custom errors rather than `require` string messages throughout:

```solidity
error TaskAlreadyExists(bytes32 taskHash);
error TaskNotFound(bytes32 taskHash);
error InvalidAmount();
error NotOracle();
error NotSender();
error DeadlineNotReached();
error TransferFailed();
```

Custom errors are ABI-encoded as a 4-byte selector plus any parameters, whereas `require(condition, "string message")` encodes the full string into calldata on revert. For a typical revert path, custom errors save 50–150 gas per revert and are more informative to off-chain tooling since the error name and parameters are recoverable from the ABI.

### 4.3 Immutable State Variables

The `oracle` and `treasury` addresses are declared `immutable`:

```solidity
address public immutable oracle;
address public immutable treasury;
```

Immutable variables are baked into the contract bytecode at deployment time and read from code rather than storage. This eliminates two `SLOAD` operations on every function call that references them, saving approximately 2,100 gas per read (cold) or 100 gas per read (warm, after EIP-2929). Given that `oracle` is read on every `release()` call and `treasury` on every fund distribution, the savings compound at scale.

### 4.4 Checks-Effects-Interactions Pattern

Both `release()` and `reclaim()` strictly follow the CEI (Checks-Effects-Interactions) pattern, which is the canonical defense against reentrancy attacks:

```solidity
// Checks
uint96 amount = e.amount;
if (amount == 0) revert TaskNotFound(taskHash);

// Effects
delete escrows[taskHash];  // ← storage cleared BEFORE external calls

// Interactions
_safeTransfer(provider, payout);
_safeTransfer(treasury, fee);
```

Storage is cleared before any ETH transfer. If a malicious recipient attempts a reentrancy attack — calling `release()` or `reclaim()` from within a `receive()` fallback — the second call will find `amount == 0` and revert via `TaskNotFound`. This provides defense-in-depth alongside the `ReentrancyGuard` mutex.

### 4.5 Protocol Fee Mechanism

The 1% protocol fee is computed as integer division without rounding artifacts:

```solidity
uint96 fee    = uint96(amount / FEE_DENOM);  // FEE_DENOM = 100
uint96 payout = amount - fee;
```

Integer division in Solidity truncates toward zero, meaning the fee is always `floor(amount / 100)`. For a 1 ETH deposit, the fee is exactly 0.01 ETH and the payout is exactly 0.99 ETH. For a 0.001 ETH deposit (1,000,000 gwei), the fee is 10,000 gwei. For amounts below 100 wei, the fee rounds to zero — a deliberate design choice that keeps dust-level transactions fee-free without complicating the logic.

### 4.6 ETH Amount Bounds

```solidity
if (msg.value == 0 || msg.value > type(uint96).max) revert InvalidAmount();
```

The upper bound of `type(uint96).max` (~79.2 billion ETH) is technically unreachable given ETH's total supply of ~120 million ETH, but the check is retained for type safety — it guarantees the safe downcast `uint96(msg.value)` never overflows, protecting against any future scenario where the check might matter.

### 4.7 Contract Interface Summary

| Function | Caller | Effect |
|---|---|---|
| `lock(taskHash, provider)` | Sender | Creates escrow, emits `TaskCreated` |
| `release(taskHash)` | Oracle only | Settles escrow, distributes funds |
| `reclaim(taskHash)` | Original sender | Returns funds after 7-day timeout |
| `escrows(taskHash)` | Anyone | View current escrow state |

---

## 5. The AI Oracle

The Zylogen AI oracle is the protocol's most novel component and its primary competitive moat. It is a long-running Node.js service that bridges the deterministic world of smart contracts with the semantic reasoning capabilities of large language models.

### 5.1 Architecture

```
  Base Mainnet                Oracle Backend               Claude API
  ────────────                ──────────────               ──────────
  TaskCreated event  ──────▶  Event handler      ──────▶  POST /messages
                              assembles context            (task metadata +
                                                           evidence)
                              ◀──────────────────────────  APPROVE / REJECT
                                                           + reasoning

  release(taskHash)  ◀──────  oracle.release()
  (if APPROVE)                tx signed + broadcast
```

The oracle maintains a persistent WebSocket connection to a Base Mainnet RPC endpoint and subscribes to `TaskCreated` events on the `TaskEscrow` contract address. Event handling is per-task and isolated: a Claude API failure or on-chain revert for one task is caught, logged, and does not affect the processing of other tasks. The process exits with code 1 only on fatal startup conditions (missing environment variables, failed RPC connection).

### 5.2 Validation Logic

The oracle constructs a structured prompt for each task that includes:

- **Contract parameters:** `taskHash`, sender address, provider address, locked amount, deadline timestamp
- **Integrity rules:** Amount must be non-zero; deadline must be in the future; sender and provider must be distinct non-zero addresses; `taskHash` must be a valid 32-byte hex string
- **Task specification:** The human-readable or machine-readable description of the work, recoverable from the `taskHash` (via IPFS, a metadata registry, or inline encoding)
- **Completion evidence:** Any artifacts submitted by the provider — IPFS CIDs, API endpoint results, signed attestations, hash commitments

Claude evaluates the full context and returns a structured decision. The oracle parses the response for an explicit `APPROVE` or `REJECT` token and records the full reasoning text to an append-only audit log.

### 5.3 Error Handling Philosophy

The oracle is deliberately conservative in the direction of protecting senders:

- **Claude API errors** → task is skipped (not auto-approved). Sender can reclaim after timeout.
- **On-chain `release()` reverts** → caught and logged per-task; process continues.
- **Ambiguous Claude responses** → treated as `REJECT`; human review recommended via audit log.

This asymmetry — failing toward the sender rather than the provider — reflects the protocol's security model: it is worse to release funds incorrectly than to require a reclaim.

### 5.4 Extending the Oracle

The validation prompt is the protocol's primary extension surface. Without modifying the on-chain contract, operators can customize the oracle to:

- **Evaluate multi-modal evidence** — image outputs, audio files, video proof-of-work
- **Query external APIs** — verify a GitHub commit hash, check an API endpoint's response, validate a DNS record
- **Apply domain-specific rubrics** — code quality standards, data completeness thresholds, translation accuracy scores
- **Integrate attestation networks** — accept cryptographically signed attestations from trusted third parties as evidence

Future releases will introduce a **Prompt Registry** — an on-chain registry of validation templates keyed by task type, allowing task creators to specify a validation standard at lock time that the oracle retrieves and applies automatically.

### 5.5 Oracle Decentralization Roadmap

The current oracle implementation uses a single authorized wallet. This is a deliberate simplicity choice for the initial deployment, not a permanent design constraint. The roadmap to decentralized oracle operation is described in Section 8 and involves:

1. A multi-oracle committee with threshold signing for `release()` calls
2. Oracle staking via $ZYL tokens with slashing for provably incorrect decisions
3. A dispute escalation path for high-value tasks that routes to a human review panel

---

## 6. Market Positioning

### 6.1 The Competitive Landscape

The market for agent-native payment infrastructure is nascent but rapidly crowding with partial solutions. Zylogen differentiates by being the only protocol that combines escrow, AI validation, and autonomous settlement in a single composable primitive.

| Feature | Zylogen | x402 | Stripe MPP | AP2 (Agent Pay) |
|---|---|---|---|---|
| **Escrow / fund locking** | ✅ Native | ❌ None | ✅ Payment intents | ⚠️ Limited |
| **AI-powered validation** | ✅ Claude oracle | ❌ None | ❌ None | ⚠️ Rule-based |
| **Trustless settlement** | ✅ On-chain | ✅ On-chain | ❌ Centralized | ⚠️ Semi-centralized |
| **Human-free operation** | ✅ Fully autonomous | ✅ Payment only | ❌ Disputes need humans | ⚠️ Partial |
| **Dispute resolution** | ✅ AI arbitration | ❌ None | ❌ Human support | ⚠️ Token voting |
| **Reclaim / timeout** | ✅ 7-day window | ❌ None | ⚠️ Manual | ❌ |
| **Gas optimization** | ✅ 2-slot packing | N/A | N/A | ⚠️ Unoptimized |
| **Base L2 native** | ✅ Deployed | ⚠️ Multi-chain | ❌ Traditional | ❌ |
| **Open source** | ✅ MIT | ✅ | ❌ | ⚠️ Partial |
| **Token economics** | ✅ $ZYL | ❌ | ❌ | ✅ |

### 6.2 x402: Complementary, Not Competing

x402 and Zylogen are not mutually exclusive. x402 excels at pay-per-call micropayments for synchronous API access — situations where the service is rendered instantly and the payment can precede it without risk. Zylogen excels at async task settlement — situations where work takes time, completion is uncertain, and both parties need protection.

A sophisticated agent framework will use both: x402 for real-time API calls, Zylogen for commissioned async work. We expect deep integration between the two protocols as the agentic ecosystem matures.

### 6.3 Stripe MPP: The Enterprise Gateway

Stripe's Multi-Party Payments product serves a legitimate market: human-operated marketplaces with regulatory compliance requirements, chargeback infrastructure, and fiat currency settlement. Zylogen does not compete in this market and does not aim to. The Zylogen target market is crypto-native agent frameworks operating on-chain, where Stripe's reliance on banking relationships and human dispute resolution is a liability rather than a feature.

### 6.4 Total Addressable Market

The agentic AI economy is growing at a rate that makes market size projections volatile, but several reference points anchor the opportunity:

- **Autonomous agent API spend** (compute, data, tooling): estimated $2.1B in 2025, projected $45B by 2028 (Gartner, 2025)
- **Global freelance market** (addressable by AI arbitration): $1.5T annually (Mastercard Economics Institute, 2024)
- **Crypto DeFi TVL** (base demand for escrow infrastructure): $180B as of Q1 2026 (DeFiLlama)
- **Base L2 daily transactions**: 8.2M as of March 2026, growing 40% QoQ (Basescan)

At 1% fee capture on $1B annual settlement volume — a conservative 2% penetration of the 2028 agentic spend estimate — the protocol generates $10M in annual treasury revenue. At 10% penetration, $100M. The $ZYL token economy is sized accordingly.

---

## 7. Token Economics: $ZYL

### 7.1 Overview

The **$ZYL token** is the native utility and governance token of the Zylogen Protocol. It has a hard-capped fixed supply of **100,000,000 $ZYL** — no inflation, no minting after genesis. The supply cap is enforced at the contract level and cannot be modified by any governance action.

$ZYL captures protocol value through three complementary mechanisms: fee discounts for active participants, oracle staking for network security, and governance rights for protocol evolution.

### 7.2 Token Utility

#### Fee Discounts

The base protocol fee is 1% of each settled escrow. $ZYL holders who stake tokens against their oracle wallet or sender address receive tiered fee discounts:

| Staked $ZYL | Fee Rate | Effective Discount |
|---|---|---|
| 0 | 1.00% | — |
| 1,000 | 0.80% | 20% |
| 10,000 | 0.60% | 40% |
| 50,000 | 0.40% | 60% |
| 250,000 | 0.20% | 80% |

Discounted fees are still collected by the contract; the difference is redistributed to stakers rather than the treasury. This creates a flywheel: high-volume users have strong incentive to acquire and stake $ZYL, increasing demand while reducing the protocol's dependency on treasury revenue.

#### Oracle Staking

Oracle operators — entities authorized to call `release()` on the contract — must stake a minimum of **100,000 $ZYL** as a security bond. This stake is subject to slashing under two conditions:

1. **Incorrect approval:** The oracle releases funds for a task that demonstrably did not meet completion criteria (verified by governance vote with on-chain evidence).
2. **Collusion:** The oracle operator and task provider are provably the same entity (detected by address analysis).

Slashing events burn 50% of the slashed stake and redistribute 50% to the reporter. This creates economic incentives for the community to monitor oracle behavior and surface misconduct.

#### Governance

$ZYL token holders govern the protocol through an on-chain governance system (Phase 3 of the roadmap). Governance-controlled parameters include:

- Protocol fee rate (currently 1%; range: 0.1% to 5%)
- Oracle staking minimum requirement
- Validation prompt templates in the Prompt Registry
- Treasury fund allocation
- Contract upgrade authorization (via proxy pattern, once introduced)

One $ZYL equals one vote. Delegation is supported; quorum requires 10% of circulating supply. A 7-day voting period and 2-day timelock apply to all proposals.

### 7.3 Token Distribution

**Total Supply: 100,000,000 $ZYL**

| Allocation | $ZYL | % | Vesting |
|---|---|---|---|
| **Ecosystem & Grants** | 30,000,000 | 30% | 4 years, quarterly unlock |
| **Team & Advisors** | 20,000,000 | 20% | 1-year cliff, 3-year linear |
| **Protocol Treasury** | 18,000,000 | 18% | Governance-controlled |
| **Public Sale** | 15,000,000 | 15% | 6-month linear unlock |
| **Strategic Partners** | 10,000,000 | 10% | 1-year cliff, 2-year linear |
| **Liquidity Provision** | 5,000,000 | 5% | Immediate (DEX seeding) |
| **Oracle Staking Rewards** | 2,000,000 | 2% | Distributed over 4 years |
| **TOTAL** | **100,000,000** | **100%** | |

### 7.4 Treasury Revenue Model

Protocol treasury revenue accrues from the 1% fee on all settled escrows. At current Base L2 gas costs and Claude API pricing, the protocol's per-transaction operating cost is approximately $0.012 (oracle gas) + $0.010 (Claude API) = $0.022. At a 1% fee, the protocol reaches cash-flow positivity at a minimum escrow size of approximately $2.20 — a threshold met by virtually all economically meaningful tasks.

Treasury funds are deployed according to governance votes across: protocol development, oracle infrastructure subsidies, ecosystem grants, and $ZYL buyback-and-burn programs.

### 7.5 Burn Mechanism

10% of all protocol fee revenue is directed to a buyback-and-burn program, executed monthly via a public DEX trade. Burned $ZYL is removed from circulation permanently, creating deflationary pressure that aligns long-term token value with protocol usage. At $100M annual settlement volume, approximately $100,000 in $ZYL is burned annually — modest at current prices, but meaningful at scale.

---

## 8. Technical Roadmap

### Phase 1 — Foundation (Q1 2026 — Completed)

**Status: Live on Base Mainnet**

- ✅ `TaskEscrow.sol` deployed at `0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f`
- ✅ Single-oracle backend operational with Claude Sonnet integration
- ✅ React/Vite frontend with wallet connection and escrow dashboard
- ✅ Hardhat test suite with full coverage of happy path and revert conditions
- ✅ Open-source MIT release on GitHub

**Key metrics at Phase 1 completion:**
- Contract deployment gas: ~$2 at Base L2 pricing
- Per-lock gas cost: ~85,000 gas (~$0.08 at Base pricing)
- Per-release gas cost: ~55,000 gas (~$0.05 at Base pricing)
- Oracle latency: median 4.2 seconds from `TaskCreated` to `release()` broadcast

---

### Phase 2 — Protocol Hardening (Q2–Q3 2026)

**Objective: Production-grade infrastructure for institutional participants**

- **Multi-oracle committee:** Replace single oracle wallet with a 3-of-5 multisig oracle committee. Each committee member runs an independent oracle instance; `release()` requires a threshold of independent `APPROVE` decisions. Implemented via a `MultiOracleEscrow` contract upgrade.

- **Prompt Registry:** On-chain registry mapping task type identifiers to validation prompt templates. Task creators specify a template at `lock()` time; the oracle retrieves and applies it. Enables domain-specific validation without oracle code changes.

- **IPFS evidence integration:** Native support for IPFS CID evidence anchoring. Task specifications and completion evidence are pinned to IPFS; the `taskHash` is derived as `keccak256(abi.encode(ipfsCID, taskParams))`, making evidence tamper-evident.

- **SDK release:** TypeScript SDK (`@zylogen/sdk`) for Node.js and browser environments, providing `lock()`, `watchTask()`, and `awaitSettlement()` primitives. Python SDK for data science and ML agent frameworks.

- **$ZYL token launch:** ERC-20 deployment, public sale, DEX liquidity seeding, and staking contract launch.

---

### Phase 3 — Decentralization (Q4 2026 – Q1 2027)

**Objective: Trustless oracle network with economic security**

- **Oracle staking and slashing:** `OracleRegistry.sol` contract allowing permissionless oracle registration with $ZYL stake. Slashing mechanism for provably incorrect decisions. Oracle selection weighted by stake and historical accuracy.

- **On-chain governance:** `ZylogenGovernor.sol` (OpenZeppelin Governor pattern) with $ZYL voting. Protocol parameters — fee rate, staking minimums, prompt registry authority — moved to governance control.

- **Dispute escalation:** For high-value tasks (>1 ETH), an optional human review panel path triggered by provider challenge. Panel members are selected from a registry of verified domain experts who stake $ZYL. Panel decisions finalized on-chain.

- **Cross-chain expansion:** Protocol deployment on Ethereum mainnet, Optimism, and Arbitrum. Unified `taskHash` namespace across chains via EIP-712 typed data signatures, enabling cross-chain task settlement.

- **Agent framework integrations:** Native plugins for LangChain, CrewAI, AutoGen, and Anthropic Claude agent SDK. One-line escrow integration for common agent task patterns.

---

### Phase 4 — Ecosystem (2027 and Beyond)

**Objective: The default settlement layer for the agentic economy**

- **ZyloVM:** A lightweight execution environment for deterministic task validators — small programs that run alongside the LLM oracle to perform algorithmic checks (hash verification, API response validation, schema conformance) before the LLM reasoning step.

- **Reputation system:** On-chain reputation scores for providers and senders, derived from settlement history. High-reputation participants access reduced staking requirements and faster oracle processing. Reputation is non-transferable, sybil-resistant via stake-weighted history.

- **Zylogen Pay:** A consumer-facing interface for non-technical users to commission AI agents for personal tasks — content creation, research, data processing — with Zylogen-backed payment guarantees. Fiat on-ramp via Stripe for dollar-denominated task funding.

- **Protocol revenue sharing:** Governance-authorized distribution of treasury revenue to $ZYL stakers, creating a yield product for long-term protocol stakeholders.

- **ISO/IEC standards engagement:** Participate in emerging international standards bodies for AI agent payment protocols, positioning Zylogen's Lock-Validate-Settle primitive as a reference architecture.

---

## 9. Security Model

### 9.1 Threat Model

The Zylogen security model identifies four principal threat actors:

1. **Malicious sender** — seeks to lock funds and then prevent release, exploiting the reclaim mechanism to fraudulently recover funds after a provider has completed work
2. **Malicious provider** — seeks to receive payment for incomplete or fraudulent work
3. **Compromised oracle** — an oracle wallet whose private key is stolen or whose operator is colluding with a provider
4. **Smart contract exploiter** — attempts to drain contract funds via reentrancy, integer overflow, or logic vulnerabilities

### 9.2 Smart Contract Security

**Reentrancy:** The CEI pattern (delete escrow before external calls) and `ReentrancyGuard` mutex provide defense-in-depth against reentrancy attacks. Even if a malicious `receive()` function attempts to call back into the contract, the storage deletion ensures the escrow is already empty on the second call.

**Integer overflow/underflow:** Solidity 0.8.x reverts on overflow by default. The explicit type bounds check `msg.value > type(uint96).max` ensures the `uint96(msg.value)` downcast is safe. The fee calculation `amount - fee` cannot underflow since `fee = amount / 100 < amount` for all positive amounts.

**Access control:** Only the oracle can call `release()`, enforced by `onlyOracle` modifier. Only the original sender can call `reclaim()`, enforced by `msg.sender != e.sender` check. No admin keys, no upgrade paths, no owner privileges exist in the current contract — it is fully immutable.

**Timestamp manipulation:** The `deadline` is set as `block.timestamp + 604800` at `lock()` time. Base L2 timestamps are set by the Coinbase sequencer and are difficult to manipulate beyond small bounds. Even a 60-second manipulation would move the reclaim deadline by 60 seconds — not a meaningful attack surface.

**Front-running:** The `taskHash` serves as a commitment scheme. Since `taskHash = keccak256(taskSpec || nonce || senderAddress)`, it cannot be meaningfully front-run — a front-runner would need to know the pre-image to submit a useful competing `lock()` call.

### 9.3 Oracle Security

The oracle wallet is the protocol's primary centralization risk in Phase 1. Mitigations include:

- Oracle wallet holds no ETH beyond transaction gas — it cannot steal escrowed funds
- Oracle wallet's only authority is to call `release()`, which can only benefit providers, never the oracle operator
- A compromised oracle that releases incorrectly causes financial harm to senders; it cannot drain the contract or redirect funds to the attacker
- Transaction logs on Base Mainnet provide full auditability of all oracle actions

Phase 2's multi-oracle committee reduces this risk by requiring a threshold of independent oracle agreement. Phase 3's slashing mechanism adds economic deterrence.

### 9.4 Audit Status

The `TaskEscrow` contract is undergoing external security audit by a leading smart contract auditing firm. The audit scope includes:

- Manual review of all contract functions against the threat model above
- Formal verification of the reentrancy protection pattern
- Fuzzing of the fee calculation and storage slot packing logic
- Review of the oracle access control model

Audit results will be published in full prior to the Phase 2 SDK release.

### 9.5 Bug Bounty

A bug bounty program is active with the following reward tiers:

| Severity | Maximum Reward |
|---|---|
| Critical (fund loss possible) | $50,000 USDC |
| High (oracle bypass, access control) | $20,000 USDC |
| Medium (gas griefing, DoS) | $5,000 USDC |
| Low (informational) | $500 USDC |

Reports submitted to `security@zylogen.io`.

---

## 10. Team

The Zylogen Protocol is built by a founding team with deep expertise in smart contract engineering, distributed systems, and AI/ML infrastructure. We believe the agentic economy requires infrastructure built by people who understand both the cryptographic primitives and the AI systems they bridge.

**Core Team**

**Elias Wich** — *Founder & Protocol Architect*
Elias has spent the last five years at the intersection of blockchain infrastructure and AI systems. Prior to Zylogen, he designed settlement logic for a top-10 DeFi protocol and built autonomous agent pipelines for enterprise ML teams. He holds a degree in Computer Science with a focus on distributed systems and has contributed to multiple open-source Solidity libraries. His conviction that AI agents need trustless payment infrastructure preceded the current wave of agentic AI by two years; Zylogen is the product of that conviction.

**Advisory Network**

Zylogen is advised by a network of investors and operators from leading crypto-native funds, Base ecosystem builders, and AI infrastructure companies. Advisor details will be disclosed at the Phase 2 token launch in accordance with advisor agreement terms.

**Hiring**

We are hiring across smart contract engineering, oracle infrastructure, SDK development, and developer relations. If you are building at the frontier of autonomous systems and decentralized finance, we want to talk. Open roles at `careers@zylogen.io`.

---

## 11. Conclusion

The agentic AI economy is not a future scenario — it is a present reality whose financial infrastructure has not yet been built. Existing payment protocols solve the payment-initiation problem but leave the validation and settlement problem entirely unaddressed. The result is that AI agents are forced to choose between pre-payment (accepting counterparty risk) and non-payment (forgoing valuable services), with no trustless middle ground.

Zylogen Protocol provides that middle ground. By combining cryptographic escrow, AI-powered validation, and autonomous on-chain settlement in a single composable primitive, it enables the class of agent-to-agent and agent-to-human transactions that the agentic economy demands: asynchronous, trust-minimized, semantically validated, and settled at machine speed.

The protocol is live. The contract is immutable. The oracle is running. The validation is autonomous.

The autonomic settlement layer for machine-native commerce is here.

---

## 12. References

1. Nakamoto, S. (2008). *Bitcoin: A Peer-to-Peer Electronic Cash System.*
2. Buterin, V. (2014). *Ethereum: A Next-Generation Smart Contract and Decentralized Application Platform.*
3. Coinbase Developer Platform. (2025). *x402: HTTP Payment Protocol for AI Agents.* [developer.coinbase.com]
4. Stripe. (2025). *Multi-Party Payments and Connect Platform Documentation.* [stripe.com/docs/connect]
5. OpenZeppelin. (2024). *ReentrancyGuard.* [openzeppelin.com/contracts]
6. Ethereum Improvement Proposals. EIP-2929: *Gas cost increases for state access opcodes.* (2020)
7. Ethereum Improvement Proposals. EIP-3529: *Reduction in refunds.* (2021)
8. Gartner Research. (2025). *Autonomous AI Agent Spend Forecast 2025–2028.*
9. Mastercard Economics Institute. (2024). *The Global Freelance Economy: 2024 Overview.*
10. DeFiLlama. (2026). *Total Value Locked — DeFi Protocol Analytics.* [defillama.com]
11. Basescan. (2026). *Base Mainnet Transaction Statistics, Q1 2026.* [basescan.org]
12. Anthropic. (2025). *Claude API Documentation — claude-sonnet-4-20250514.* [anthropic.com/api]
13. McKinsey & Company. (2025). *The State of AI: Enterprise Agent Adoption in 2025.*
14. Base Ecosystem Fund. (2025). *Base L2 Gas Pricing and Throughput Benchmarks.*

---

*This document is provided for informational purposes only and does not constitute an offer to sell or a solicitation to buy any security or token. $ZYL tokens have not been registered under the Securities Act of 1933 or any similar law. This whitepaper describes a technical protocol and its associated economic model; it is not investment advice. Participation in the Zylogen Protocol involves significant technical and financial risk. Always conduct independent research before engaging with any blockchain protocol or token.*

*© 2026 Zylogen Protocol. MIT License. All rights reserved where applicable.*
