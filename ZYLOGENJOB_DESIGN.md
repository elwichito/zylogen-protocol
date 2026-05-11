# ZylogenJob — Design document

**Status:** Draft for review. Solidity implementation pending (Fase 1.C is *design only*; coding is Fase 1.D).
**Spec target:** ERC-8183 ("Agentic Commerce Protocol")
**Replaces:** the orphan `contracts/contracts/zyl/TaskEscrowV2.sol` (Sepolia beta) as the canonical job primitive.
**Audit reference:** [ERC8183_REQUIREMENTS.md](./ERC8183_REQUIREMENTS.md)

---

## 0. North alignment check

This design is evaluated against the north star ("toolkit para founder solo deploya un protocolo agentic completo en Base en una semana, sin equipo"). Each decision below is justified with one of:
- **(NS)** Necessary for ERC-8183 compliance
- **(NF)** Needed by founder use case
- **(SAF)** Safety/audit hygiene
- **(KEPT)** Preserves something from `zyl/TaskEscrowV2.sol` that worked

Anything outside these four categories is rejected.

---

## 1. Architecture overview

Two contracts. **Hard split** — never bundled.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ZylogenJob.sol  ────────  pure ERC-8183 kernel                         │
│  ----------------                                                       │
│  - 6 states (Open → Funded → Submitted → Completed/Rejected/Expired)    │
│  - One payment token (set at deploy time)                               │
│  - Single evaluator per job (MAY be the client)                         │
│  - Optional hook (IACPHook) called around hookable functions            │
│  - SafeERC20 + ReentrancyGuard + Pausable + Ownable                     │
│  - ERC-2771 trusted forwarder (gasless meta-tx)                         │
│  - NO fees, NO burn, NO reputation, NO token-specific logic             │
│                                                                         │
│                            ▲                                            │
│                            │ implements IACPHook                        │
│                            │                                            │
│  ZylogenFeeHook.sol  ─────┘   opt-in Zylogen extension                  │
│  --------------------                                                   │
│  - Fee tiers by agent reputation (Burn / Treasury / Spark)              │
│  - ZYL burn on completion                                               │
│  - Spark rewards distribution                                           │
│  - AgentID registry lookup                                              │
│  - Charged from `optParams` (founder opts in at createJob)              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Rationale:** ERC-8183 §3.8 explicitly endorses this split — kernel stays minimal and stable; complexity lives in hooks. A founder that wants pure ERC-8183 deploys only `ZylogenJob`. A founder that wants Zylogen's fee/burn/reward economics deploys both.

---

## 2. State machine

```
                          createJob()
                              │
                              ▼
                        ┌──────────┐
                        │   Open   │ ◄────────────────────────┐
                        └────┬─────┘                          │
                             │                                 │
              ┌──────────────┼──────────────┐                  │
              │              │              │                  │
              │              │              │                  │
       client │       client/provider       │ client           │ (no transition back —
       reject() ←────  setBudget()  ────►   fund()              │  rejections are terminal)
              │              │              │                  │
              │              │              │                  │
              ▼              │              ▼                  │
        ┌──────────┐         │       ┌──────────┐              │
        │ Rejected │         │       │  Funded  │              │
        │ Terminal │         │       └────┬─────┘              │
        └──────────┘         │            │                    │
                             │       ┌────┼─────────────┐      │
                             │       │    │             │      │
                             │  evaluator │       block.timestamp ≥
                             │  reject()  │       expiredAt:    │
                             │       │    │       claimRefund()│
                             │       │    │             │      │
                             │       ▼    ▼             ▼      │
                             │  ┌──────────┐      ┌──────────┐ │
                             │  │ Rejected │      │ Expired  │ │
                             │  │ Terminal │      │ Terminal │ │
                             │  └──────────┘      └──────────┘ │
                             │                                  │
                             │       provider submit()          │
                             │              │                    │
                             │              ▼                    │
                             │       ┌────────────┐              │
                             │       │ Submitted  │              │
                             │       └─────┬──────┘              │
                             │             │                     │
                             │  ┌──────────┼──────────┐          │
                             │  │          │          │          │
                             │  evaluator  evaluator  block.timestamp ≥
                             │  complete() reject()   expiredAt: │
                             │      │       │        claimRefund()
                             │      ▼       ▼          ▼          │
                             │  ┌────────┐ ┌─────────┐ ┌───────┐  │
                             │  │Completed│ │Rejected│ │Expired│  │
                             │  │Terminal│ │Terminal│ │Terminal│  │
                             │  └────────┘ └────────┘ └───────┘  │
                             │                                    │
                             └──── (no flow — setBudget only in Open) ─┘
```

**Terminal payouts:**
- `Completed` → escrow to **provider** (minus optional hook-charged fee)
- `Rejected` → escrow to **client** (full refund)
- `Expired` → escrow to **client** (full refund) — **this fixes BLOCKER M13**

---

## 3. The 7 BLOCKERS and how they're resolved

Recall from `ERC8183_REQUIREMENTS.md` §5:

| # | Blocker in current contract | Resolution in `ZylogenJob` |
|---|---|---|
| B1 | State machine missing `Open` and `Submitted` | Implements all 6 ERC-8183 states. Status enum: `Open, Funded, Submitted, Completed, Rejected, Expired`. |
| B2 | `lock()` is atomic create+fund, no negotiation phase | Split into `createJob` (Open) → `setBudget` (Open) → `fund` (Open→Funded). Provider may be `address(0)` initially and set via `setProvider`. |
| B3 | No `submit()` — work delivery isn't on-chain | `submit(jobId, deliverable, optParams)` callable by provider while Funded. Emits `JobSubmitted(deliverable)`. |
| B4 | Single global oracle, no per-job evaluator | Each job stores its own `evaluator` (set at `createJob`). MAY equal `client` (self-evaluating jobs supported). |
| B5 | `timeout()` pays the **worker** on expiry — direct violation | `claimRefund(jobId)` pays the **client**. Permissionless (anyone can trigger after `expiredAt`). Hardcoded to skip hooks (M15: `claimRefund` SHALL NOT be hookable). |
| B6 | No `reason` attestation on terminal actions | `complete(jobId, bytes32 reason, bytes optParams)` and `reject(jobId, bytes32 reason, bytes optParams)` both accept `reason`. Emitted in events. `bytes32(0)` is valid for "no reason". |
| B7 | No `description` field | `string description` parameter in `createJob`, stored in the `Job` struct. Not used by the core for any logic; lives on-chain for indexers / UIs. |

Each resolution is **(NS)** Necessary for ERC-8183 compliance.

---

## 4. Solidity interfaces (signatures only — no implementation)

### 4.1 `IZylogenJob` — the core kernel interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IZylogenJob {
    // ─── Types ────────────────────────────────────────────────────────────

    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string  description;
        uint256 budget;
        uint64  expiredAt;
        JobStatus status;
        address hook;          // address(0) means no hook
    }

    // ─── Errors ───────────────────────────────────────────────────────────

    error InvalidStatus(uint256 jobId, JobStatus expected, JobStatus actual);
    error Unauthorized(address caller);
    error ZeroAddress();
    error EvaluatorMustBeSetAtCreation();
    error ExpiredAtNotInFuture(uint64 expiredAt);
    error ProviderNotSet();
    error BudgetMismatch(uint256 expected, uint256 actual);
    error NotExpired(uint64 expiredAt, uint64 nowTs);
    error HookCallFailed(address hook, bytes4 selector);

    // ─── Core lifecycle (ERC-8183 §3.5) ───────────────────────────────────

    function createJob(
        address provider,      // MAY be address(0)
        address evaluator,     // MUST NOT be address(0); MAY be msg.sender
        uint64  expiredAt,     // MUST be > block.timestamp
        string calldata description,
        address hook           // address(0) for no hook
    ) external returns (uint256 jobId);

    function setProvider(
        uint256 jobId,
        address provider,
        bytes calldata optParams
    ) external;

    function setBudget(
        uint256 jobId,
        uint256 amount,
        bytes calldata optParams
    ) external;

    function fund(
        uint256 jobId,
        uint256 expectedBudget,    // front-run protection (ERC-8183 §3.5)
        bytes calldata optParams
    ) external;

    function submit(
        uint256 jobId,
        bytes32 deliverable,
        bytes calldata optParams
    ) external;

    function complete(
        uint256 jobId,
        bytes32 reason,
        bytes calldata optParams
    ) external;

    function reject(
        uint256 jobId,
        bytes32 reason,
        bytes calldata optParams
    ) external;

    function claimRefund(uint256 jobId) external;   // NOT hookable

    // ─── Views ─────────────────────────────────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory);
    function paymentToken() external view returns (address);
}
```

### 4.2 `IACPHook` — the hook interface (verbatim from ERC-8183 §3.8)

```solidity
interface IACPHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
```

### 4.3 `IZylogenFeeHook` — the opt-in Zylogen extension interface

```solidity
interface IZylogenFeeHook is IACPHook {
    // Admin (multisig)
    function setFeeTier(uint16 minReputation, uint16 feeBps) external;
    function setTreasury(address treasury) external;
    function setZylBurnAddress(address zyl) external;
    function setSparkRewards(address spark) external;

    // Read
    function feeFor(uint256 jobId) external view returns (uint16 feeBps);
    function previewSplit(uint256 jobId, uint256 amount) external view
        returns (uint256 toProvider, uint256 toTreasury, uint256 toBurnZyl, uint256 toSparkZyl);

    // Events
    event FeeCharged(uint256 indexed jobId, uint256 toTreasury, uint256 zylBurned, uint256 zylSparked);
    event FeeTierUpdated(uint16 minReputation, uint16 feeBps);
}
```

The fee hook reads job state from the kernel via `getJob`, looks up the agent's reputation through an external `IAgentID` registry, and computes the deduction in `afterAction(JobCompleted)`. **It never touches `claimRefund`** (the kernel forbids it).

---

## 5. Events (per ERC-8183 §3.9)

All event names follow the spec verbatim so indexers (e.g. The Graph schemas for ERC-8183) work out of the box.

```solidity
event JobCreated(
    uint256 indexed jobId,
    address indexed client,
    address indexed provider,    // MAY be address(0)
    address evaluator,
    uint64  expiredAt,
    address hook                  // MAY be address(0)
);

event ProviderSet(uint256 indexed jobId, address indexed provider);
event BudgetSet(uint256 indexed jobId, uint256 amount);
event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
event JobExpired(uint256 indexed jobId);
event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
```

**Note:** `PaymentReleased.amount` is the net amount after the optional hook deduction. The kernel emits the net; the hook (if any) emits its own `FeeCharged` separately. This way an indexer that only listens to kernel events still gets a consistent picture, and the hook layer is additive metadata.

---

## 6. Explicit decisions (each one is non-default and worth flagging)

### 6.1 Timeout refunds the client — **fix M13**

Per ERC-8183 §3.5: `claimRefund` SHALL transfer full escrow to **client** when state is Funded or Submitted and `block.timestamp >= expiredAt`. This is the inverse of `timeout()` in the current contract. The fix is mandatory; the rationale is that expiry is the client's safety net against an unresponsive provider/evaluator, not a punishment.

**(NS)** Necessary for ERC-8183.

### 6.2 Evaluator separated from any global oracle

The kernel does not know what an "oracle" is. Each job stores its own `evaluator` address, set at `createJob`. The evaluator MAY be:
- The client itself (self-evaluating — useful for founder-deploys-own-bot use case)
- A smart contract performing ZK proof / oracle verification
- A multisig of trusted parties
- An external service the founder runs

If the Zylogen protocol wants to offer a "default Zylogen evaluator" as a service, that's a separate contract that founders can pass as `evaluator` — never baked into the kernel.

**(NS)** ERC-8183 §3.2 mandates per-job evaluator. **(NF)** Founder must own the evaluator decision.

### 6.3 `reason` is `bytes32` (hash), not `string`

`reason` is intended for attestation hashes (e.g. SHA-256 of off-chain proof, IPFS CID, signed attestation commitment). Storing the string on-chain is wasteful and the spec says implementations MAY hash internally — we choose to require the caller to hash, which is cheaper and lets the same `bytes32` interop with external attestation systems (EAS, ERC-3000 etc.).

A caller wanting "no reason" passes `bytes32(0)`. The contract makes no semantic distinction.

**(NS)** ERC-8183 §3.6.

### 6.4 Single payment token per contract — set at constructor

The kernel's `paymentToken()` is immutable. ERC-8183 §3.3 explicitly recommends one token per contract; per-job tokens are an OPTIONAL extension. For Fase 1.D we ship single-token kernels (USDC on Base) and deploy a fresh kernel per founder if they want a different token.

Per-job multi-token is deferred to a future contract (`ZylogenJobMulti.sol`) only if there's actual demand from the first cohort of founders. **YAGNI for now.**

**(NS)** Per ERC-8183. **(NF)** Per founder simplicity.

### 6.5 ERC-2771 trusted forwarder (gasless meta-tx)

The kernel inherits `ERC2771Context` and uses `_msgSender()` for all authorization checks. This means a founder can run a relayer that signs transactions on behalf of their users (clients who don't have ETH for gas yet). The forwarder address is constructor-set and immutable.

**(NF)** Founder onboarding flow needs gasless option. **(NS)** ERC-8183 §11 SHOULD-recommended.

### 6.6 `Pausable` with an immutable `PAUSER` role — **no Ownable**

The kernel is `Pausable` (a designated `PAUSER` can pause new `createJob` and `fund` in case of a discovered vulnerability — existing jobs continue to settle and expire normally).

**No `Ownable`.** The kernel is fully immutable: the `PAUSER` address is set once at construction and cannot be changed afterwards. There is no admin role that can transfer ownership, modify parameters, upgrade logic, or rescue funds.

The `PAUSER` can do exactly two things: `pause()` and `unpause()`. Nothing else. It's a circuit breaker, not an admin.

**(SAF)** Audit hygiene with minimum trust surface. **(KEPT)** Pause-only circuit breaker is the smallest viable safety net. ERC-8183 doesn't forbid pause.

### 6.7 ReentrancyGuard on every token-moving function

`fund`, `complete`, `reject`, `claimRefund` are all `nonReentrant`. Hook callbacks happen inside the reentrant guard window, so a malicious hook can revert but cannot re-enter the kernel for the same job.

**(SAF)** ERC-8183 §8 explicit MUST.

### 6.8 `expiredAt` is per-job, not a contract constant

The current `TaskEscrowV2.sol` hardcodes `ESCROW_DURATION = 30 days`. The kernel takes `expiredAt` as a parameter. Bounds are enforced as `expiredAt > block.timestamp` (strict) and `expiredAt <= block.timestamp + MAX_DURATION` where `MAX_DURATION` is a constant (1 year) chosen for sanity — beyond that, the implicit assumption is the founder runs their own kernel.

**(NS)** ERC-8183 §3.5.

### 6.9 `claimRefund` is permissionless

Anyone can call `claimRefund(jobId)` once a job is past `expiredAt`. The funds always go to the `client` regardless of who called. This is the ERC-8183 "RECOMMENDED" pattern.

**Why:** ensures the client doesn't lose access if they lose their wallet — a friend, an indexer bot, or even a competitor can trigger refund. The hook is hardcoded skipped here so no contract can block expiry refund.

**(NS)** ERC-8183 §3.5 + §3.8.

### 6.10 No upgradeability proxies

The kernel is **immutable** once deployed. To upgrade, deploy a new kernel and let founders migrate. No proxy patterns, no `UUPS`, no diamond. This is intentional — proxies are a frequent audit finding and break ERC-8183's promise that the kernel is stable.

If Zylogen later ships a v2 kernel, it's a new contract. Founders pick which kernel they trust.

**(SAF)** Reduces attack surface.

---

## 7. Anti-features — what the kernel deliberately does NOT have

The kernel will **not** include:

| Anti-feature | Why excluded | Where it lives instead |
|---|---|---|
| Platform fees (basis points on completion) | Not in ERC-8183 core | `ZylogenFeeHook.sol` |
| ZYL burn on completion | Zylogen-specific economics | `ZylogenFeeHook.sol` |
| Spark rewards distribution | Zylogen-specific economics | `ZylogenFeeHook.sol` |
| Agent reputation lookup | Couples kernel to a registry | Hook reads `IAgentID` itself |
| Fee tier table (11 tiers) | Hardcoded business logic | `ZylogenFeeHook.sol` |
| Per-job multi-token | YAGNI for v1 | Future `ZylogenJobMulti.sol` if needed |
| Dispute resolution / arbitration | Out of scope per ERC-8183 §8 | Use a custom evaluator contract |
| Upgradeability proxies | Audit risk | Not anywhere — kernel is immutable |
| Built-in oracle role | ERC-8183 has no oracle concept | Founders pass any contract as `evaluator` |
| `ESCROW_DURATION` constant | Removes founder flexibility | Per-job `expiredAt` parameter |
| Minimum escrow size enforcement | Business logic, not protocol | Hook can enforce via `beforeAction` |
| Treasury withdraw functions for fees | Kernel never holds fees | Treasury logic is hook-side |
| ETH support (native token) | ERC-8183 is ERC-20-only | Out of scope; founders wrap ETH (WETH) |

The point of every exclusion: **a founder who only wants ERC-8183 compliance must be able to deploy the kernel and have it work without configuring Zylogen-specific knobs.** Every Zylogen knob lives in the hook.

---

## 8. Closed decisions (2026-05-11)

Each item below was an open question during design review; the operator's call on each is now binding for Fase 1.D coding.

1. **`MAX_DURATION = 365 days`** (constant). A job's `expiredAt` MUST satisfy `expiredAt <= block.timestamp + 365 days`. Founders who need longer contracts deploy a fresh kernel with a custom constant.

2. **`PAYMENT_TOKEN` is immutable.** Set at constructor, never settable. To use a different token, deploy a new kernel. No timelock-settable variant; no admin override. This is the single biggest contributor to the kernel being trust-minimised.

3. **`HOOK_GAS_LIMIT = 500_000`** per hook call (each of `beforeAction` and `afterAction` gets its own 500k budget). Implemented via `hook.call{gas: 500_000}(...)`. If the hook reverts or runs out of gas, the calling function reverts.

4. **`ZylogenFeeHook` is out of scope for Fase 1.** Fase 1 ships only the kernel (`ZylogenJob.sol`). The fee hook gets its own design doc and PR after the kernel is on mainnet. Until then, founders deploy `ZylogenJob` with `hook = address(0)`.

5. **Deploy sequence:** Fase 1.D writes the contract; tests + Sepolia deploy in Fase 1.D-test; mainnet deploy only in Fase 1.E after an internal audit pass.

6. **No `Ownable`.** This decision came in alongside the questions and overrides §6.6 above. The kernel is fully immutable; the only admin-like role is `PAUSER` (pause/unpause only, set once in constructor). See §6.6 for the rewritten rationale.

---

## 9. Verification checklist for Fase 1.D

Coding for `ZylogenJob.sol` is not green-lit until this document is reviewed. Once it is, the implementation in Fase 1.D must satisfy:

- [ ] All 6 ERC-8183 states implemented
- [ ] All 8 lifecycle functions with exact signatures from §4.1
- [ ] `claimRefund` pays the **client** (fixes M13)
- [ ] `claimRefund` is hardcoded-skip-hook (M15)
- [ ] `evaluator` MAY equal `client` (B4)
- [ ] `bytes32 reason` on complete/reject (B6)
- [ ] `description` stored on-chain (B7)
- [ ] Front-run protection: `fund(expectedBudget)` reverts on mismatch
- [ ] All 10 events emit per §5
- [ ] SafeERC20 + ReentrancyGuard + Pausable + Ownable
- [ ] ERC-2771 `_msgSender()` everywhere
- [ ] Hook calls bounded by gas limit (per §8 open question)
- [ ] Test coverage ≥ 90% with explicit tests for each transition path
- [ ] Tests assert that `claimRefund` ignores the hook even if one is set
- [ ] Slither + Mythril clean
