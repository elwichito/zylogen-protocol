# Pass 1 — Adversarial Threat Model
## ZYL Genesis — Pre-Implementation Security Review
**Date:** 2026-04-29  
**Reviewer:** Zyl (Claude Code)  
**Scope:** ZYL.sol · TaskEscrowV2.sol · SparkStaking.sol · AgentID.sol (interface)  
**Assumption:** Attacker has unlimited flash-loan capital, sequencer coordination access, complete knowledge of all source code, and can deliver adversarial inputs to the Claude oracle.

---

## 1. Critical Vectors (could drain funds or break invariants)

---

### 1.1 `burnFrom()` Whitelisted Contract → Arbitrary Balance Drain

- **Vector:** Whitelisted-contract allowance abuse
- **Attack:**
  1. Standard ERC20Burnable `burnFrom(account, amount)` requires the caller to have `allowance` from `account`. A whitelisted contract (e.g., TaskEscrowV2) cannot call `burnFrom(victim, amount)` without the victim's approval — so far, safe.
  2. However, if ANY user has ever called `approve(TaskEscrowV2, MaxUint256)` (standard for DEX interactions), and TaskEscrowV2 has a function that calls `zyl.burnFrom(msg.sender, ...)` with attacker-controlled `amount`, the attacker submits a transaction that burns the victim's entire ZYL balance.
  3. More critically: if a **future** whitelisted contract (added via multisig) contains a vulnerability that exposes arbitrary `burnFrom(account, amount)`, it can drain any holder who has ever approved that contract — or who approved any contract the attacker proxies through an allowance chain.
- **Impact:** Permanent destruction of victim ZYL balances. Supply invariant breaks if `_burn()` is used (totalSupply drops below correct value relative to claims). Trust collapse.
- **Mitigation proposed:** Override `burnFrom` in ZYL.sol to ONLY allow `burn(amount)` (self-burn from `msg.sender`) for whitelisted contracts — never allow third-party `burnFrom(account, amount)`. Whitelisted contracts should hold ZYL themselves and burn their own balance. Document this explicitly as an invariant.
- **Confidence:** Alta — this is a known ERC20 approval attack pattern, directly applicable here.

---

### 1.2 Deployer EOA Controls Burn Whitelist for 90 Days (Key-Compromise Window)

- **Vector:** Ownership transfer gap
- **Attack:**
  1. Per the renunciation schedule, "Day 0: Owner = deployer." Burn whitelist control transfers to multisig+timelock only on Day 90.
  2. During days 0–90, the deployer's EOA private key is the single point of failure for the entire protocol's monetary policy.
  3. An attacker who compromises the deployer key in this window: adds a malicious contract to the burn whitelist → calls `burnFrom` on the 400M community pool or 200M treasury allocation → permanently destroys a majority of the token supply.
  4. Alternatively, removes TaskEscrowV2 from the whitelist → all settlement burn calls revert → protocol breaks immediately.
- **Impact:** Total supply manipulation. Protocol operational halt. Irrecoverable on-chain.
- **Mitigation proposed:** Transfer whitelist control to the multisig+timelock on Day 0, not Day 90. Use a 2-of-3 multisig from genesis. The deployer should be a smart contract (factory), never a bare EOA. The deployment + allocation + whitelist setup should be a single atomic transaction sequence executed by the multisig itself.
- **Confidence:** Alta — EOA key management failures are the most common catastrophic event in DeFi.

---

### 1.3 Logarithmic Fee Curve — Integer Math Produces Zero Fee at Low-Rep Boundary

- **Vector:** Fixed-point log approximation truncation
- **Attack:**
  The spec defines:
  ```
  fee = ceiling - (ceiling - floor) * log(rep + 1) / log(MAX_REP + 1)
  ```
  Solidity has no native `log()`. Implementation requires fixed-point math libraries (PRBMath, ABDKMath). Issues:
  1. If `(ceiling - floor) * log(rep + 1)` is computed before division, and `log(rep + 1)` returns a small integer approximation that when multiplied still underflows the divisor `log(MAX_REP + 1)`, the division truncates to 0. Result: `fee = ceiling - 0 = ceiling`. This is safe (over-charges).
  2. If division is done FIRST (Solidity integer truncation): `log(rep + 1) / log(MAX_REP + 1)` = 0 for any `rep` where `log(rep+1) < log(MAX_REP+1)` in the fixed-point representation. Result: `fee = ceiling - (ceiling - floor) * 0 = ceiling` always. The curve is flat — everyone pays max fee regardless of reputation. Breaks the entire fee incentive structure.
  3. At `rep = 0`: `log(1) = 0` → fee = ceiling (2%). Correct.
  4. At `rep = MAX_REP`: `log(MAX_REP+1) / log(MAX_REP+1) = 1` only if the fixed-point library returns exact unity. Rounding errors here mean even max-rep agents pay slightly above floor.
  5. **Critical boundary:** If the log library uses `ln` (natural log) vs `log2` vs `log10`, the curve shape changes dramatically. The spec doesn't specify base.
- **Impact:** Fee incentive structure is broken. Reputation has no economic value. High-rep agents pay same as zero-rep agents. Or: truncation always gives floor fee, draining the burn pool to zero.
- **Mitigation proposed:** (a) Specify the log base. (b) Use multiplication-before-division strictly. (c) Use a pre-computed lookup table for reputation tiers (10–20 discrete tiers) instead of continuous log — avoids fixed-point entirely. (d) Fuzz the curve with Foundry at every integer rep from 0 to MAX_REP. (e) Require curve to be monotone decreasing in tests — any violation is a bug.
- **Confidence:** Alta — this class of fixed-point bug has caused significant losses in DeFi (Compound, Euler).

---

### 1.4 Oracle Private Key Compromise → Reputation Registry Takeover

- **Vector:** Centralized oracle key controls all on-chain trust
- **Attack:**
  1. The oracle wallet `0x24A4...D849` is the sole address authorized to update the reputation registry.
  2. If the private key is compromised: attacker sets attacker-controlled agent to MAX_REP → pays 0.5% fee floor indefinitely → extracts maximum value from every escrow.
  3. Attacker sets all honest agents to rep = 0 → they pay 2% fee → workers receive less → market trust in protocol collapses.
  4. Attacker triggers mass slashing of all bonded agents → 50% of all bonded ZYL burned (destroying supply), 50% to insurance pool. Agents' AgentID NFTs stigmatized permanently.
  5. The spec provides a "48hr dispute window" only for slashing, NOT for reputation updates. A malicious rep update takes effect immediately (no dispute).
- **Impact:** Protocol-level trust collapse. Economic incentives fully controlled by attacker. Slashing drains agent bonds irreversibly.
- **Mitigation proposed:** (a) Use a time-delay (e.g., 6 hours) for reputation updates to take effect — window to detect and veto. (b) Implement oracle multi-sig: require 2-of-3 oracle signatures for any reputation update above a delta threshold. (c) Cap maximum rep change per epoch (e.g., ±50 rep points per 24hr per agent). (d) Separate the slash oracle from the reputation oracle into different keys with different risk profiles. (e) Publish oracle key in a hardware HSM and commit to rotation schedule.
- **Confidence:** Alta — the spec explicitly names a single oracle address with unilateral control over all on-chain reputation state.

---

### 1.5 Supply Invariant Violation — `transfer(DEAD, amount)` is NOT `_burn(amount)`

- **Vector:** Dead-address transfer vs. true burn
- **Attack:**
  1. The spec states burns are "sent to `0x000...dEaD`." In ERC-20, `transfer(DEAD_ADDRESS, amount)` does NOT reduce `totalSupply()`. It simply moves tokens to an address with no known private key.
  2. Therefore `totalSupply()` remains 1,000,000,000 ZYL forever, regardless of how much has been "burned."
  3. The protocol's deflationary claim ("supply decreases") is verifiable on-chain as false — `totalSupply()` never changes. Immediately exploitable for FUD.
  4. More critically: the invariant described in tests — "sum of all balances + burned == 1B always" — is automatically satisfied with no real burn occurring, since DEAD address balance counts toward the sum.
  5. If ZYL.sol uses `ERC20Burnable._burn()` for some paths and `transfer(DEAD)` for others, `totalSupply` diverges from the sum of holder balances. This breaks every protocol that queries `totalSupply` for accounting (Uniswap V3 TWAP, etc.).
- **Impact:** Verifiable on-chain lie about deflation. Protocol credibility destroyed on first burn event. Potential accounting errors in any integration that reads `totalSupply`.
- **Mitigation proposed:** Use `_burn(amount)` exclusively — NEVER `transfer(DEAD_ADDRESS, ...)`. ZYL.sol should expose a `burn(uint256)` function that calls internal `_burn`. The burn hook in TaskEscrowV2 calls `IZyl(zyl).burn(feeAmount)` which the contract calls on its own ZYL balance. `totalSupply()` decreases correctly and is verifiable.
- **Confidence:** Alta — this is a specification-level error with direct on-chain consequences.

---

### 1.6 AgentID NFT Transfer During 48-Hour Slash Dispute Window

- **Vector:** Slash evasion via NFT transfer
- **Attack:**
  1. Oracle triggers slash on agent with `tokenId = X` (targeting the token, not an address).
  2. The 48-hour dispute window begins. During this 48 hours, `bondedZYL` is not yet reduced (slash hasn't finalized).
  3. While `bondedZYL > 0`, the spec says transfers are disabled. BUT: if the slash is expected to reduce `bondedZYL` to 0 upon finalization, is the transfer lock based on CURRENT `bondedZYL` or on `bondedZYL` AFTER finalization?
  4. If CURRENT: agent can't transfer. Safe.
  5. If the implementation checks `bondedZYL` at transfer-time and slash hasn't fired yet, `bondedZYL` is still positive → transfer blocked. Still safe IF the slash fires to the token regardless of current holder.
  6. However: if slash implementation targets the **owner of tokenId at time of finalization** (common mistake: `ownerOf(tokenId)` at `finalize()` call), AND the agent front-runs finalization to transfer the bond to a new address, the slash hits the new address. The original attacker recovers their bonded ZYL to the new address minus the slash. The slashed stigma metadata persists on the NFT but the ZYL loss is mitigated.
  7. Critical: if "soulbound while `bondedZYL > 0`" is implemented as `require(bondedZYL[from] > 0, "not transferable")` rather than `require(bondedZYL[tokenId] > 0, ...)`, an agent could unbond (separate transaction, if unbonding is possible) before slashing finalizes to make the NFT transferable.
- **Impact:** Slash evasion. Economic punishment doesn't land. Reputation stigma persists on NFT but economic loss avoided.
- **Mitigation proposed:** (a) Lock the slash target address at slash initiation (snapshot owner at slash event, execute against that address regardless of later transfers). (b) During the 48-hour window, the specific `tokenId` is flagged as "pending slash" — transfers MUST be blocked for this tokenId regardless of `bondedZYL` state. (c) Unbonding must be blocked if a pending slash exists on the tokenId.
- **Confidence:** Alta — transfer-based slash evasion is a documented attack in NFT-based staking systems.

---

## 2. High Vectors (could degrade trust or economics)

---

### 2.1 `settle()` vs `release()` Ambiguity — Burn Bypass Path

- **Vector:** Dual-function settlement creating a fee-free path
- **Attack:**
  1. The spec diagram shows `TaskEscrowV2` with a `settle()` function that triggers burn hooks. The existing V2 (deployed) has `release()` and `refund()`.
  2. The spec says "Existing `lock()` signature preserved — no breaking changes." But adds `settle()`.
  3. If `settle()` is added WITHOUT removing `release()`, two paths exist: `release()` (no burn, no fee split) and `settle()` (with burns). An oracle that calls `release()` instead of `settle()` skips all burns and fee distribution. This is either a bug or an intentional backdoor.
  4. Attacker vector: if oracle is compromised, always calls `release()` → workers receive full amount → 0 tokens burned → protocol deflation halted → economic model breaks.
- **Impact:** Zero burn events. Treasury receives no fees. Spark reward pool starved. Deflationary model collapses.
- **Mitigation proposed:** Remove `release()` entirely from V2. Only `settle()` handles successful completions. `refund()` handles oracle-approved cancellations (no burn on refunds is appropriate). Make the naming explicit in the spec and enforce at contract level.
- **Confidence:** Alta — ambiguous dual-path settlement is a high-severity architectural gap.

---

### 2.2 30-Day Auto-Release Without Burn — Oracle Griefing Attack

- **Vector:** Deliberate oracle offline → mass fee-free settlement
- **Attack:**
  1. The spec states: "Fallback timeout → auto-release after 30 days" for oracle outage.
  2. Mechanism unspecified: Who triggers it? What does the contract release — to client (full refund) or worker (full payment)?
  3. Attack scenario A (auto-release to worker): attacker who controls many escrows with their own agent deliberately keeps oracle offline for 30 days. All escrows auto-settle to the worker with 0 burn (no oracle call = no burn hook triggered). Worker (attacker) receives 100% of escrow value; protocol receives 0%.
  4. Attack scenario B (auto-release to client): all workers get nothing for completed work after 30 days of oracle outage. Mass exodus of workers from protocol.
  5. Either path means: during any 30-day oracle outage, 0% of escrow value is burned. If there's $1M in escrows and oracle goes down for 30 days, ~$5K of expected burns never happen.
- **Impact:** Protocol economic model bypassed. Deflationary burns stop during outages. Worker or client trust collapse.
- **Mitigation proposed:** (a) Auto-release MUST trigger the burn hook (at the floor rate, 0.5%), regardless of oracle availability. (b) Specify a keeper bot (chainlink automation, gelato) as the trigger — the 30-day fallback is a permissionless call, anyone can trigger it after the deadline. (c) Auto-release should go to the WORKER (not client), incentivizing resolution before deadline. (d) Document and test this path explicitly.
- **Confidence:** Alta — unspecified fallback mechanics in payment contracts are a category of high-severity bug.

---

### 2.3 Oracle Reputation Manipulation Between `lock()` and `settle()`

- **Vector:** Fee rug on in-flight escrow
- **Attack:**
  1. An agent with high reputation (e.g., rep = 9000/10000) negotiates a $10,000 escrow with a client. Client accepts because the fee is near-floor (0.5% = $50 fee, worker receives $9,950).
  2. The oracle maliciously drops the agent's reputation to 0 between `lock()` and `settle()`.
  3. At settlement, fee = 2% = $200. Worker receives $9,800 instead of $9,950.
  4. The worker cannot dispute this retroactively (no dispute mechanism for reputation changes).
  5. Scaled up: oracle operates a competing agent. Drops reputation of all competing agents right before their large escrow settlements. Diverts $150 per $10K escrow to the Spark pool (which oracle's staked ZYL benefits from).
- **Impact:** Workers can't predict take-home pay. High-value escrows become high-risk for workers. Systematic oracle favoritism toward oracle-affiliated agents.
- **Mitigation proposed:** Snapshot the agent's reputation at `lock()` time and use that snapshot for fee calculation at `settle()`. Reputation changes take effect only for FUTURE escrows locked after the change. This also requires the reputation score to be stored in the escrow struct at lock time.
- **Confidence:** Alta — the spec explicitly says rep is oracle-controlled and updated dynamically, with no lock-time snapshot.

---

### 2.4 Multisig Effective 3-of-3 at Genesis (Not 3-of-5)

- **Vector:** Pre-launch multisig centralization
- **Attack:**
  1. The spec says "3-of-5 signer setup — founder + 2 advisors + 2 community-elected (post-launch)."
  2. Community-elected signers require a community to exist post-launch. At genesis, only founder + 2 advisors exist = effective 3-of-3.
  3. If all 3 initial signers are in the same jurisdiction, can be legally compelled to act (OFAC, SEC), or two advisors collude with a hostile party: full control over 200M ZYL treasury + burn whitelist from Day 30.
  4. 7-day timelock provides warning but not prevention. If 3-of-3 sign a malicious withdrawal, users have 7 days to exit — during which the market collapses in response.
- **Impact:** Governance capture. Treasury drain. Whitelist manipulation. Protocol trust collapse within 7 days.
- **Mitigation proposed:** Deploy as 3-of-5 from Day 0. The 2 "community-elected" seats should be filled before any treasury or whitelist control transfers. Candidates: Code4rena judges, security researchers, or protocol-aligned projects on Base. Empty seats = dead keys that block majority. Alternatively use 2-of-3 with the 3rd signer being a decentralized DAO contract from Day 1.
- **Confidence:** Alta — this is a structural gap in the governance spec, not a theoretical risk.

---

### 2.5 V1 Escrow Routing During Migration — Burn Bypass Window

- **Vector:** Fee arbitrage through legacy contract
- **Attack:**
  1. V1 (`TaskEscrow.sol` at `0x55a8...`) has no burn hook. Settlement is a flat 1% fee, no burn.
  2. Phase 2 deploys V2 with burns, but V1 must be "migrated or sunset cleanly."
  3. During the migration window (V2 deployed but V1 not yet sunset), sophisticated users route ALL large escrows through V1 to avoid the 0.5–2.0% fee in V2.
  4. Workers prefer V1 (higher take-home). Clients prefer V1 (potentially lower total cost). V2 adoption is zero.
  5. V1 has no admin shutdown function (deployed, immutable). "Sunset cleanly" requires either oracle cooperation (refuse to release V1 escrows) or an economic incentive to migrate.
- **Impact:** V2 adoption failure. No burns. Treasury starved. Phase 2 gate never met.
- **Mitigation proposed:** (a) Oracle immediately stops processing V1 `lock()` events — new escrows to V1 will time out in 30 days without release. Announce this publicly before V2 launch so V1 users migrate voluntarily. (b) Offer a migration bonus: first 100 escrows migrated to V2 receive a Spark reward multiplier. (c) Set V2 go-live date as the oracle's cutover date with 30-day advance notice to existing V1 users.
- **Confidence:** Media — depends on how quickly V1 is deprecated and whether oracle enforcement is credible.

---

### 2.6 Micro-Escrow Griefing — Zero Burns via Truncation

- **Vector:** Precision truncation on minimum escrow amounts
- **Attack:**
  1. The spec says "0.5% burn floor" on settlement. With USDC at 6 decimals: 0.5% of 1 unit = `1 * 50 / 10000 = 0` (truncates to 0).
  2. Any escrow with `amount < 200 units` (0.2 USDC cents = $0.002) produces zero burn.
  3. An attacker creates thousands of micro-escrows for 1 unit each, settling them all → zero burns → zero treasury fees → zero Spark rewards. Just gas wasted.
  4. With Base gas costs at ~$0.001 per transaction, this attack is cheap enough to sustain.
  5. Worse: each micro-escrow consumes storage slots in the contract. At 2,000+ micro-escrows, gas costs per settlement increase for ALL users (due to Merkle trie growth on Base/Ethereum L1).
- **Impact:** Deflation halted. Gas costs raised for all users. Storage bloat on L1 state trie (Base posts state roots to L1).
- **Mitigation proposed:** Enforce a minimum escrow amount (spec mentions this vaguely as "0.001 ETH equivalent"). Specifically: minimum $1.00 USDC (1,000,000 units at 6 decimals). At this minimum, 0.5% = 5,000 units = non-zero burn. Document the exact minimum in the contract as a constant with a named error.
- **Confidence:** Alta — integer truncation on small values is a deterministic, verifiable issue.

---

### 2.7 Spark Delegation Race Condition — Reward Hijacking

- **Vector:** Last-second delegation switch before reward distribution
- **Attack:**
  1. Agent A's large escrow ($100K) is about to settle. The Spark pool will distribute 0.9% = $900 to sponsors.
  2. An attacker observing the mempool sees the `settle()` transaction. Front-runs it with a delegation transaction: delegates maximum ZYL to Agent A.
  3. Attacker's Spark is newly delegated → does the snapshot protect here? Snapshot requires Spark to have been held at block N-1. If delegation updates are separate from staking snapshots, a stake held since block N-1 can be re-delegated to a new agent at block N, just before settlement.
  4. Attacker captures pro-rata rewards from the large escrow without having supported Agent A for the duration of the task.
- **Impact:** Reward distribution is stolen from legitimate long-term sponsors. Sponsors have no incentive to maintain long-term delegation. Economic flywheel breaks.
- **Mitigation proposed:** Delegation snapshots must be independent of staking snapshots. A delegation change takes effect only at block N+1 or later (same block delay as staking). Reward distribution uses the delegation state at the block of `lock()`, not `settle()`. Lock-time sponsor snapshot stored in the escrow struct alongside reputation snapshot.
- **Confidence:** Alta — mempool-observable front-running on reward distribution is a well-studied attack.

---

## 3. Medium Vectors (griefing, gas waste, UX attacks)

---

### 3.1 ERC20Permit Signature Replay on Future Multi-Chain Deployment

- **Vector:** Permit signature replay
- **Attack:**
  1. ZYL uses ERC20Permit (EIP-2612). Domain separator includes `chainId`.
  2. If ZYL is ever deployed at the same address on another EVM chain (via CREATE2 + same deployer nonce), permit signatures signed for Base replay on the other chain.
  3. An attacker who obtained a permit signature from a user on Base can replay it on the shadow chain to spend the user's ZYL there.
  4. The spec doesn't mention multi-chain, but OpenZeppelin's default Permit uses `block.chainid` which is correct. This becomes a risk if the team manually extracts and re-uses deployment scripts without updating the domain.
- **Impact:** User permit signatures drained on unintended chains.
- **Mitigation proposed:** Never deploy ZYL at the same address on multiple chains using CREATE2 with the same salt. If multi-chain deployment is planned, use a unique salt per chain. OZ ERC20Permit is safe if used as-is; the risk is in deployment hygiene.
- **Confidence:** Baja — risk only materializes with specific deployment choices the spec doesn't currently plan.

---

### 3.2 SparkStaking Gas Cost on Base — Storage Layout

- **Vector:** L1 calldata / state write gas on hot paths
- **Attack (griefing):**
  1. Each `stake()`, `delegate()`, `unstake()` writes multiple storage slots (staker balance, snapshot mapping, delegation mapping, timestamp).
  2. On Base (optimistic rollup), storage writes are cheap for L2 execution but each changed storage slot is published in calldata to L1 Ethereum, costing ~16 gas/byte (L1) × the calldata representation.
  3. An attacker can grief by delegating to hundreds of different agents in separate transactions — each delegation changes a mapping slot. The `agentSpark[agent]` update is a SSTORE costing ~20,000 gas on the first write.
  4. If `reward distribution` iterates over all sponsors of an agent, and an agent has 10,000 sponsors, the settlement transaction could OOG (out of gas).
- **Impact:** Settlement transactions OOG for popular agents. High-usage agents become unusable.
- **Mitigation proposed:** (a) Never iterate over sponsors in settlement. Use pull-over-push reward distribution: track `cumulativeRewardPerSpark` at each settlement, let sponsors claim rewards lazily. (b) Impose a maximum delegation count per agent (e.g., 500 sponsors). (c) Pack staking struct: `uint128 amount + uint64 timestamp + uint64 sparkBalance` fits in 2 slots.
- **Confidence:** Alta — the spec mentions "reward distribution math under high concurrency" as a test concern, confirming this is a real risk.

---

### 3.3 Snapshot Mechanism — Same-Block Attack via Multiple Contracts

- **Vector:** Snapshot guard circumvention via multi-step same-block atomic setup
- **Attack:**
  1. The snapshot guard says: "Spark at block N = ZYL staked at block N−1 or earlier." This prevents flash-loan same-transaction stake/use.
  2. BUT on Base, an attacker could: in block N-1, stake ZYL into SparkStaking (legitimate stake). In block N, immediately use Spark (it's now "prior block" Spark). Then in block N+1, initiate unstake.
  3. The 24-hour activation lock prevents this scenario — Spark is inactive for first 24hr. So block N Spark isn't usable until block N + ~43,200 blocks (at 2s/block).
  4. However: what about a staker who has had ZYL staked for >24hr, then ADDS more ZYL via another `stake()` call? Does the additional stake generate new Spark immediately (no 24hr lock since the position already exists) or separately locks for 24hr?
  5. If additional stakes bypass the 24hr lock (because the account already has active Spark), a flash-loan-like accumulation can occur across 2 seconds (two blocks): stake massive additional ZYL, snapshot appears in block N-1 position relative to block N+1 Spark usage.
- **Impact:** Flash-loan style Spark inflation in a 24hr+ staking window. Fee-free escrow access for attacker.
- **Mitigation proposed:** Every `stake()` addition creates a separate tracked entry with its own 24hr activation timestamp. Only ZYL staked before the current block's activation threshold contributes to usable Spark. Use a time-weighted approach: `Spark = Σ(amount_i × elapsed_i) / total_elapsed` where elapsed is measured from each stake event. Pre-existing stake batches do not confer immediate Spark to new additions.
- **Confidence:** Media — depends on implementation. The spec describes the guard but not how incremental stakes are handled.

---

### 3.4 Unstake Cooldown + Active Spark = Double-Dip

- **Vector:** Spark usage during cooldown period
- **Attack:**
  1. A staker initiates unstake (7-day cooldown begins). The spec does not say whether Spark deactivates immediately upon unstake initiation or after the 7-day cooldown.
  2. If Spark remains active during cooldown: the staker uses Spark for fee-free escrow sponsorship for 7 days AND then recovers their full ZYL.
  3. At scale: 100 stakers coordinate to cycle: stake → use Spark for 24hr → initiate unstake → use Spark for 7 more days → unstake → repeat. Continuous fee-free access with capital returned every ~8 days.
  4. The protocol is giving away 0.9% rewards and free fees in exchange for temporary ZYL deposits that are immediately scheduled for withdrawal.
- **Impact:** Spark rewards drained. Fee-free escrows for attackers with no long-term capital commitment.
- **Mitigation proposed:** Spark deactivates IMMEDIATELY upon `unstake()` call, before the cooldown period begins. Delegation is also revoked at that moment. Document this as an invariant: `Spark > 0 ↔ bondedZYL > 0 AND no pending unstake`.
- **Confidence:** Media — depends on implementation, but the spec doesn't specify this behavior.

---

### 3.5 Airdrop Sybil Attack — Insufficient Anti-Sybil Specification

- **Vector:** Sybil farming of 8M ZYL airdrop
- **Attack:**
  1. Spec says: "Anti-sybil: Minimum on-chain age + activity threshold." Thresholds are completely unspecified.
  2. On Base, accounts with 6+ months of history cost pennies to maintain (many airdrop farmers run thousands of such accounts).
  3. "Talent Protocol verified builders" — Talent Protocol scores can be farmed through GitHub activity automation.
  4. 8M ZYL × 50% immediately liquid = 4M ZYL dumped at TGE by sybils.
  5. If initial price gives these 4M ZYL any meaningful dollar value, the dump pressure depresses price → legitimatate holders sell → death spiral on day 1.
- **Impact:** Price suppression at launch. Community trust damaged. 8M ZYL airdrop achieves zero protocol growth (goes to farmers, not builders).
- **Mitigation proposed:** (a) Use a specific, verifiable threshold: e.g., Base Mainnet account with >10 unique contract interactions, ETH balance >0.01 at snapshot, and TaskEscrow participation (strongest signal). (b) Require Gitcoin Passport score ≥20. (c) Cap per-address airdrop size (max 5,000 ZYL per address) to limit sybil upside. (d) Extend vesting to 100% over 12 months for non-TaskEscrow participants.
- **Confidence:** Alta — airdrop sybil attacks are universal in DeFi and the spec provides no concrete sybil resistance.

---

### 3.6 Vesting Contract Deployment Race — 1B ZYL in Bare EOA

- **Vector:** Deployment atomicity gap
- **Attack:**
  1. Spec: "Constructor mints 1B to deployer, deployer transfers to allocation contracts."
  2. The vesting contracts must be deployed BEFORE or AT THE SAME TIME as ZYL.sol — otherwise, 1B ZYL sits in the deployer's EOA between the `deployZYL()` transaction and the `deployVesting() + transferAllocations()` transactions.
  3. If any transaction in this sequence fails (e.g., out of gas, nonce collision, network congestion on Base), the deployer holds the 1B ZYL with no vesting enforcement.
  4. A compromised deployer key at this exact moment → 1B ZYL stolen in one transaction.
- **Impact:** Total supply theft. Protocol dead on arrival.
- **Mitigation proposed:** Deploy all contracts AND transfer all allocations in a single atomic transaction via a deployment script that uses a smart contract deployer (not a bare EOA). The deployment contract: (1) deploys ZYL, (2) deploys all vesting/staking/treasury contracts, (3) transfers allocations to each, (4) renounces deployer ownership — all in one `deploy()` function call. If any step reverts, the entire deployment reverts.
- **Confidence:** Alta — this is a deterministic vulnerability given the described deployment sequence.

---

## 4. Base L2 Specific Concerns

---

### 4.1 Centralized Sequencer — Initial Liquidity Add Front-Running

- **Vector:** Sequencer-level MEV on LP seeding
- **Attack:**
  1. Base uses a centralized Coinbase sequencer. The sequencer sees all transactions before they are included in blocks.
  2. When the team submits the `addLiquidity(150M ZYL, X USDC)` transaction to Aerodrome, the sequencer (or anyone the sequencer tips) sees this before inclusion.
  3. The initial price is set by the ratio. If the sequencer front-runs by buying ZYL right before the LP seed (impossible since ZYL doesn't exist yet), OR if they place limit orders right after, they can buy at initial price and immediately arbitrage against the just-seeded pool.
  4. More practically: bots observe the pending `addLiquidity` transaction and sandwich it — buy before, sell after the pool is created.
- **Impact:** Initial price discovery manipulated. First buyers after launch are bots, not organic users. Price impact is worse than expected for first legitimate buyers.
- **Mitigation proposed:** (a) Use Aerodrome's `skim()` protection if available. (b) Consider a Dutch auction launch over 24-48 hours instead of single-point LP add. (c) Add liquidity in multiple smaller transactions. (d) Use a private RPC (Flashbots Protect or Base's private mempool if available) for the LP seeding transaction.
- **Confidence:** Alta — MEV on initial liquidity events is well-documented and common on Base.

---

### 4.2 Sequencer Downtime — 30-Day Fallback Timing Drift

- **Vector:** L2 block time manipulation during oracle fallback
- **Attack:**
  1. The 30-day auto-release fallback likely measures time in `block.timestamp` or block number.
  2. During Base sequencer downtime, blocks stop being produced on L2. `block.timestamp` can be significantly behind real time.
  3. When the sequencer restarts, it may produce multiple blocks rapidly (catch-up). All pending transactions process in a compressed timeframe.
  4. If the auto-release check is `block.timestamp >= escrow.lockTime + 30 days`, and the sequencer was down for 3 days, all escrows that were within 3 days of their 30-day window auto-release simultaneously when the sequencer restarts — flooding the settlement queue.
  5. Workers who had legitimate completed tasks may be permanently denied oracle settlement if oracle also went offline during sequencer downtime and auto-release fires to clients.
- **Impact:** Mass involuntary client-refunds to workers who completed tasks. Protocol trust collapse during sequencer incidents.
- **Mitigation proposed:** Use `block.timestamp` (not block number) for timeouts, which is relatively robust. Add a 48-hour grace period after oracle comes back online before auto-release fires, allowing oracle to settle in-flight tasks retroactively. Require auto-release to be a permissionless keeper call with a freshness check — if oracle signed any transaction in the last 7 days, auto-release is blocked.
- **Confidence:** Media — Base has had sequencer outages. The exact impact depends on implementation.

---

### 4.3 L1 Data Availability Cost — Storage-Heavy Contracts on Base

- **Vector:** L1 calldata cost makes SparkStaking economically unviable for small stakes
- **Attack (economic):**
  1. Base (Bedrock) posts transaction data to L1 Ethereum. Storage writes generate calldata that gets posted to L1.
  2. A `stake()` call writing 4 storage slots generates ~200 bytes of L1 calldata at ~16 gas/byte = ~3,200 L1 gas. At 30 gwei L1 gas price = ~$0.015.
  3. This is currently acceptable. But if L1 gas spikes (historical high: 200+ gwei), a `stake()` call could cost $1-2 in L1 fees alone.
  4. For small stakers (1,000 ZYL at $0.001/ZYL = $1 of staked value), L1 fees exceed the value of Spark rewards → rational actors don't stake → SparkStaking TVL stays near zero → flywheel never starts.
- **Impact:** SparkStaking participation threshold effectively excludes small stakers. Whales dominate Spark. Delegation power centralized.
- **Mitigation proposed:** (a) Pack all staking state into as few storage slots as possible. (b) Consider using Blob transactions (EIP-4844) which Base supports — staking state updates could be cheaper via blob data. (c) Set minimum stake size (e.g., 1,000 ZYL) to ensure stakers have sufficient value to absorb L1 fee spikes. (d) Consider using transient storage (EIP-1153) for intermediate calculations in SparkStaking.
- **Confidence:** Media — current Base fees are low, but spike risk is real.

---

## 5. Cross-Contract Interaction Risks

---

### 5.1 ZYL Burn Whitelist + TaskEscrowV2 Upgrade Path — Immutability Trap

- **Vector:** Whitelist freeze prevents bug fixes
- **Attack / Failure:**
  1. TaskEscrowV2 has a critical bug discovered post-launch (not a drain, but e.g., fee calculation error).
  2. To fix it, a new TaskEscrowV3 must be deployed.
  3. TaskEscrowV3 must be whitelisted in ZYL.sol to call `burn()`.
  4. The 7-day timelock means 7 days pass before V3 can burn. During those 7 days, TaskEscrowV2 must remain live (no one can call `settle()` in V3) OR be paused (no new escrows for 7 days).
  5. If TaskEscrowV2 is left live with a known bug, attackers exploit it during the 7-day window. If V2 is paused, protocol halts for 7 days.
  6. There is no emergency fast-track for contract upgrades in the current spec.
- **Impact:** Either exploit during migration window OR 7-day protocol halt. Either outcome damages trust.
- **Mitigation proposed:** (a) Implement an emergency whitelist update (e.g., 24-hour timelock with a 4-of-5 multisig threshold instead of 3-of-5). (b) Or: maintain a proxy pattern for TaskEscrowV2 so the whitelist address never changes — only the implementation upgrades. (c) Document the upgrade path explicitly in the deployment runbook.
- **Confidence:** Alta — the timelock vs. emergency response tension is a known governance design problem.

---

### 5.2 SparkStaking Delegation + TaskEscrowV2 Fee Calculation — State Desync

- **Vector:** Spark delegation is revoked between lock and settle
- **Attack:**
  1. A client creates a task for Agent A. Agent A has `agentSpark[A] >= taskCost`, so fee = 0%.
  2. The escrow is created with fee = 0% (or the fee is calculated at lock time as 0).
  3. Mid-task (between lock and settle), Agent A's sponsor revokes delegation. `agentSpark[A]` drops below `taskCost`.
  4. At settlement, if fee is re-evaluated: Agent A's fee is no longer 0. The client effectively agreed to 0% fee but is charged 0.5–2.0%.
  5. Alternatively, if fee is locked at lock time (0%), and sponsor revokes, the 0.9% Spark reward pool is distributed to... whom? The sponsor is gone.
- **Impact:** Client receives unexpected fee. Worker receives less than expected. Spark rewards go to null (lost).
- **Mitigation proposed:** Crystallize ALL fee parameters at `lock()` time: store `(feeRate, burnAmount, treasuryAmount, sparkAmount, sponsorAddress)` in the escrow struct. Settlement uses ONLY these stored values. Sponsor revocation affects only FUTURE escrows, never in-flight ones.
- **Confidence:** Alta — this is the correct pattern (used by Uniswap V3 for fee tiers), but requires explicit spec.

---

### 5.3 AgentID Slashing → SparkStaking Delegation Not Updated

- **Vector:** Slashed agent's Spark delegation persists
- **Attack:**
  1. Agent A is slashed. `bondedZYL[A]` is reduced by 50% (burned) + 50% (insurance).
  2. Agent A's AgentID NFT shows the glitch/stigma effect.
  3. But: sponsors who had delegated Spark to Agent A's address still have `agentSpark[A]` in SparkStaking. The delegation is NOT automatically revoked on slash.
  4. The slashed agent continues to receive sponsored Spark, continues to pay 0% fees, and sponsors continue to earn rewards — for a slashed, untrusted agent.
  5. Sponsors may not monitor for slashing events. A malicious slashed agent can continue operating normally until sponsors manually revoke.
- **Impact:** Slashing loses its economic force. Slashed agents can continue operating without penalty to their fee structure. The economic punishment (higher fees) doesn't activate.
- **Mitigation proposed:** Slashing in AgentID.sol must emit an event that SparkStaking.sol listens to (or a callback is made). Upon slash finalization, `agentSpark[agent]` is zeroed out and all delegation to that agent is voided. Sponsors must re-delegate manually to restore sponsorship.
- **Confidence:** Alta — cross-contract state sync on slash is not specified and the dependency is obvious.

---

### 5.4 Reputation Registry and SparkStaking — Circular Trust Attack

- **Vector:** Reputation bootstrapping creates a circular dependency exploitable at genesis
- **Attack:**
  1. At genesis, all agents have rep = 0. All agents pay 2% fee (ceiling).
  2. An attacker creates a fake escrow (with themselves as both client and worker, or using disposable addresses), settles it, and oracle grants them high reputation.
  3. Attacker now pays near-floor fees (0.5%). Stakes ZYL, gets Spark, delegates to own agent → pays 0% fees.
  4. Legitimate agents subsidize attacker's operations through the fee differential.
  5. The oracle is supposed to prevent fake escrow reputation farming. But if the oracle uses Claude API and the attacker can inject prompts (see oracle section), the oracle can be fooled into granting reputation.
- **Impact:** Reputation system captured at genesis. Early mover advantage for attackers. Fee structure systematically exploited.
- **Mitigation proposed:** (a) Reputation at genesis starts at a MEDIUM value (e.g., 3000/10000), not 0. New agents pay mid-range fees and improve over time, not starting from max penalty. (b) Rate-limit reputation increases: no more than +200 rep per completed escrow, cap at +1000 per 30 days. (c) Minimum escrow value for reputation-granting completions (e.g., $5 USDC minimum). (d) Oracle must require minimum UNIQUE client addresses per agent for reputation increases (can't self-deal).
- **Confidence:** Media — depends on oracle implementation and whether Claude API can be prompt-injected.

---

## 6. Open Questions / Spec Ambiguities

The following require explicit answers before implementation begins. These are not necessarily exploitable now but will create exploitable ambiguities if left unresolved.

---

### 6.1 `settle()` vs `release()` vs `refund()` — Complete Function Inventory Required

**Ambiguity:** The spec adds `settle()` to the diagram but says `lock()` signature is preserved. It does not specify whether `release()` and `refund()` are removed, renamed, or kept in parallel.

**Decision required:** Define the complete public interface for TaskEscrowV2:
- Successful completion: `settle(taskId)` [oracle only] → burns 0.5%, pays treasury 0.5%, pays Spark pool 0–1.0%, pays worker remainder
- Oracle-approved cancellation: `refund(taskId)` [oracle only] → 0 burn, full refund to client
- Timeout fallback: `timeout(taskId)` [permissionless after 30 days] → burns 0.5%, full payout to worker (or client — decide)

---

### 6.2 What Exactly is "Spark"?

**Ambiguity:** "Users stake ZYL → receive non-transferable Spark balance." Is Spark:
- (A) An internal `uint256 mapping` in SparkStaking (most gas-efficient)
- (B) A separate ERC-20 with `transfer` blocked (adds complexity, risk of transfer bypass bugs)
- (C) A non-transferable ERC-721 or ERC-1155

**Decision required:** Option A is the correct implementation. Document explicitly that Spark is an accounting unit only, stored in SparkStaking.sol, with no external transfer mechanism. There is no `Spark.sol` contract.

---

### 6.3 Fee Crystallization Timing

**Ambiguity:** Is the fee rate (based on agent reputation and Spark delegation) calculated at `lock()` or `settle()`?

**Decision required:** Calculate at `lock()`, store in escrow struct. This is the only way to give clients and workers deterministic cost/revenue expectations. See vector 5.2.

---

### 6.4 Burn Mechanism — `_burn()` or `transfer(DEAD)`?

**Ambiguity:** Spec says "sent to `0x000...dEaD`." This implies `transfer(DEAD)` which does NOT reduce `totalSupply`. See vector 1.5.

**Decision required:** Use `ERC20Burnable._burn(amount)` exclusively. `totalSupply()` must reflect actual circulating supply. Never transfer to `0xdEaD`.

---

### 6.5 Spark During Unstake Cooldown — Active or Inactive?

**Ambiguity:** The 7-day cooldown exists but Spark activation rules during cooldown are unspecified. See vector 3.4.

**Decision required:** Spark deactivates immediately on `unstake()` submission. This must be a hard invariant.

---

### 6.6 30-Day Auto-Release — Release to Client or Worker? Does Burn Fire?

**Ambiguity:** Spec says "auto-release after 30 days" but does not specify:
- Who receives funds (client = refund, worker = release)
- Whether the 0.5% burn fires
- Who triggers the call (oracle? keeper? anyone?)
- Whether oracle activity in the last N days blocks auto-release

**Decision required:** (a) Auto-release goes to worker (otherwise workers have no guarantee for completed work during oracle outages). (b) Burn fires at the floor rate (0.5%) regardless of oracle involvement. (c) Auto-release is a permissionless keeper call, anyone can trigger after deadline. (d) Oracle activity in last 7 days resets the auto-release clock (gives oracle time to settle retroactively).

---

### 6.7 `log()` Implementation — Which Base? Which Library?

**Ambiguity:** Spec says `log(rep + 1)` but does not specify: natural log (ln), log base 2, log base 10, or which Solidity fixed-point library.

**Decision required:** Use `log2` via PRBMath (battle-tested, used in Uniswap V3). Or abandon continuous curve entirely in favor of a 10-tier lookup table (simpler, cheaper, equally incentive-compatible). The lookup table approach is recommended.

---

### 6.8 Airdrop Anti-Sybil — Concrete Thresholds Required

**Ambiguity:** "Minimum on-chain age + activity threshold" is not actionable. See vector 3.5.

**Decision required:** Before airdrop snapshot, publish:
- Minimum account age: ≥180 days from first transaction on Base
- Minimum activity: ≥10 unique contract interactions
- OR: past TaskEscrow participant (strongest signal, auto-qualifies)
- Maximum per address: 5,000 ZYL
- Vesting: 100% linear over 6 months (stronger anti-dump signal than 50/50)

---

### 6.9 AgentID NFT — Slash Targets Token or Address?

**Ambiguity:** Slash identifies target by `tokenId`. Slash finalizes after 48hr. If NFT is transferred during those 48hr (even if this should be blocked — confirm it is actually blocked), does slash follow the token or the address? See vector 1.6.

**Decision required:** Slash is indexed by `tokenId`. At finalization, slash acts on the OWNER of `tokenId` at the time of SLASH INITIATION (snapshot the owner at `slash()` call). Transfer of the NFT during the dispute window must be explicitly and verifiably blocked by checking if `pendingSlash[tokenId] > 0`.

---

### 6.10 Insurance Pool — Address, Governance, and Usage Rules

**Ambiguity:** "50% of slashed ZYL to insurance pool." The insurance pool address, governance mechanism, and disbursement rules are completely unspecified.

**Decision required:** Define: (a) Is the insurance pool a smart contract or a multisig address? (b) Under what conditions can insurance pool ZYL be disbursed? (c) Who governs it? If it's just tokens accumulating in a multisig address, it's equivalent to a second treasury and creates the same governance capture risk.

---

## Summary Table

| # | Vector | Severity | Category |
|---|--------|----------|----------|
| 1.1 | `burnFrom()` allowance abuse via whitelisted contract | **Critical** | Smart contract |
| 1.2 | Deployer EOA controls burn whitelist for 90 days | **Critical** | Governance |
| 1.3 | Log curve integer math → wrong fee at all rep values | **Critical** | Smart contract |
| 1.4 | Oracle key compromise → total reputation control | **Critical** | Centralization |
| 1.5 | `transfer(DEAD)` ≠ `_burn()` → supply invariant violation | **Critical** | Smart contract |
| 1.6 | AgentID transfer during slash window → slash evasion | **Critical** | Cross-contract |
| 2.1 | Dual `settle()`/`release()` path → burn bypass | **High** | Architecture |
| 2.2 | 30-day auto-release without burn → oracle griefing | **High** | Mechanism |
| 2.3 | Oracle drops rep between lock and settle → fee rug | **High** | Oracle |
| 2.4 | Multisig is effectively 3-of-3 at genesis | **High** | Governance |
| 2.5 | V1 escrow routing during migration window | **High** | Migration |
| 2.6 | Micro-escrow truncation → zero burns | **High** | Economics |
| 2.7 | Delegation front-run right before reward distribution | **High** | MEV |
| 3.1 | ERC20Permit replay if multi-chain deployment | **Medium** | Smart contract |
| 3.2 | SparkStaking iteration over sponsors → OOG | **Medium** | Gas |
| 3.3 | Incremental stake bypasses 24hr activation lock | **Medium** | Flash loan |
| 3.4 | Spark active during 7-day unstake cooldown | **Medium** | Economics |
| 3.5 | Airdrop sybil farming | **Medium** | Distribution |
| 3.6 | 1B ZYL in bare EOA during deployment | **Medium** | Deployment |
| 4.1 | Sequencer MEV on initial LP add | **Medium** | Base L2 |
| 4.2 | Sequencer downtime → auto-release timing drift | **Medium** | Base L2 |
| 4.3 | L1 calldata cost → SparkStaking unviable for small stakers | **Medium** | Base L2 |
| 5.1 | Whitelist timelock prevents emergency V3 migration | **High** | Governance |
| 5.2 | Spark revocation between lock and settle → desync | **High** | Cross-contract |
| 5.3 | Slash does not zero `agentSpark` in SparkStaking | **High** | Cross-contract |
| 5.4 | Reputation bootstrapping → circular trust attack | **Medium** | Economics |
| 6.1–6.10 | Spec ambiguities (10 open questions) | **Blocking** | Architecture |

---

*End of Pass 1 — Adversarial Threat Model.*  
*No code was written or committed during this pass.*  
*All vectors above must be addressed before Pass 2 (implementation) begins.*
