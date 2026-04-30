# ZYL Genesis — Pass 2 Implementation

This directory contains the implementation deliverables for ZYL Genesis v2 (post-Pass-1 hardened spec). The contracts live at [`contracts/contracts/zyl/`](../../contracts/contracts/zyl/).

## Deliverables

| Artifact | Path | Status |
|---|---|---|
| `ZYL.sol` (ERC-20 + permit, no Burnable) | [`contracts/contracts/zyl/ZYL.sol`](../../contracts/contracts/zyl/ZYL.sol) | ✅ |
| `TaskEscrowV2.sol` (crystallized fees, lock/settle/refund/timeout) | [`contracts/contracts/zyl/TaskEscrowV2.sol`](../../contracts/contracts/zyl/TaskEscrowV2.sol) | ✅ |
| `SparkStaking.sol` (batched activation, pull-over-push) | [`contracts/contracts/zyl/SparkStaking.sol`](../../contracts/contracts/zyl/SparkStaking.sol) | ✅ |
| `IAgentID.sol` (interface) | [`contracts/contracts/zyl/IAgentID.sol`](../../contracts/contracts/zyl/IAgentID.sol) | ✅ |
| `AgentID.sol` (Phase 4, soulbound + slash) | [`contracts/contracts/zyl/AgentID.sol`](../../contracts/contracts/zyl/AgentID.sol) | ✅ |
| `TeamVesting.sol` (4-yr / 12-mo cliff) | [`contracts/contracts/zyl/TeamVesting.sol`](../../contracts/contracts/zyl/TeamVesting.sol) | ✅ |
| `ZylogenDeployer.sol` (atomic factory) | [`contracts/contracts/zyl/ZylogenDeployer.sol`](../../contracts/contracts/zyl/ZylogenDeployer.sol) | ✅ |
| Hardhat deploy script | [`contracts/scripts/deploy-zyl-genesis.js`](../../contracts/scripts/deploy-zyl-genesis.js) | ✅ |
| Hardhat vector-test suite (runnable) | [`contracts/test/zyl/ZylGenesis.test.js`](../../contracts/test/zyl/ZylGenesis.test.js) | ✅ 18/18 pass |
| Foundry mirror (audit suite) | [`contracts/test/foundry/ZylGenesisVectors.t.sol`](../../contracts/test/foundry/ZylGenesisVectors.t.sol) | ✅ (run after `forge install`) |
| Echidna invariants | [`contracts/test/echidna/ZylInvariants.sol`](../../contracts/test/echidna/ZylInvariants.sol) | ✅ |
| Threat-resolution mapping | [`docs/zyl-genesis/THREAT_RESOLUTION.md`](THREAT_RESOLUTION.md) | ✅ |
| Gas report | [`docs/zyl-genesis/GAS_REPORT.md`](GAS_REPORT.md) | ✅ |
| Pass 3 — black-swan proposal | [`docs/zyl-genesis/PASS_3_PROOF_OF_BURN.md`](PASS_3_PROOF_OF_BURN.md) | ✅ |

## Run the test suite

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test test/zyl/ZylGenesis.test.js
```

For Foundry:

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge test --match-contract ZylGenesisVectors -vv
forge coverage --report lcov
```

For Echidna:

```bash
cd contracts
echidna test/echidna/ZylInvariants.sol --contract ZylInvariants \
  --config test/echidna/echidna.config.yaml
```

## Deployment runbook (Base Mainnet)

> ⛔ The factory script refuses to deploy to chainId 8453 unless `AUDIT_PASSED=true` is in the env — spec §VII Phase 1 gate.

1. **Phase 0 — Pre-deploy** (spec §VII)
   - Onboard all 5 multisig signers (Wichi + 2 advisors + 2 security signers)
   - HSM ceremony for `oracle`, `repOracle`, `slashOracle` (separate keys per spec §V Vector 1.4)
   - Schedule both audits; **deployment is gated on both passing**
2. **Phase 1 — ZYL Genesis** — atomic factory deploy:
   ```bash
   export MULTISIG_ADDRESS=0x...
   export STAKING_POOL_ADDRESS=0x...
   export LP_RESERVE_ADDRESS=0x...
   export GRANTS_MULTISIG_ADDRESS=0x...
   export TEAM_BENEFICIARIES=0x...,0x...
   export TEAM_AMOUNTS=50000000,100000000   # whole ZYL, sums to 150M
   export ORACLE_SETTLE_ADDRESS=0x...
   export ORACLE_REP_ADDRESS=0x...
   export ORACLE_SLASH_ADDRESS=0x...
   export USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
   export ZYL_RATE_USDC=100
   export AUDIT_PASSED=true                 # ONLY after both audits clear
   npx hardhat run scripts/deploy-zyl-genesis.js --network base
   ```
3. **Phase 1 verification** — confirm on Basescan:
   - `ZYL.totalSupply()` == 1,000,000,000 × 1e18
   - `ZYL.owner()` == multisig
   - `ZYL.balanceOf(factory)` == 0
   - Five allocations match expected totals
4. **Phase 2 — TaskEscrowV2 + Burn Hook** (spec §VII gate: 7 days clean operation)
   - Multisig: `ZYL.setBurnWhitelist(taskEscrowV2, true)` (7-day Safe timelock)
   - Multisig: `TaskEscrowV2.setSparkStaking(spark)` and `setRepOracle(...)` and `setZylRatePerToken(USDC, rate)`
   - Top up TaskEscrowV2 ZYL reserve from treasury (covers crystallized burn + spark for in-flight escrows)
   - 30-day public V1 cutover notice; oracle stops servicing V1 `lock()` events at cutover
5. **Phase 3 — Spark Staking** (spec §VII gate: $100K+ TVL clean)
   - `SparkStaking.setRewardDistributor(taskEscrowV2, true)`
   - LP seed via Flashbots Protect (private mempool) — Vector 4.1
   - 24-mo Aerodrome LP lock; publish lock proof
6. **Phase 4 — AgentID** (spec §VII gate: Audit #2 passed)
   - Deploy `AgentID.sol`, wire `SparkStaking.setAgentID(...)` and `AgentID.setSparkStaking(...)`
   - Mint Nova N-01, bond, run testnet slash dispute end-to-end before mainnet enable

Each phase has a hard gate per spec §VII — **do not parallelize.**

## Pass 2 deviations from spec (transparency)

1. **Vector 2.7 — sponsor merkle snapshot.** Implemented as 24-hour delegation activation cooldown rather than full off-chain merkle. Storage is forward-compatible (`sponsorSnapshotRoot` retained on the `Escrow` struct). See [`THREAT_RESOLUTION.md`](THREAT_RESOLUTION.md) §"Known v2.1 Deviation" for rationale.
2. **Reputation source.** Pass 2 uses an on-chain `agentReputationOverride` mapping updated by `repOracle` (separate key, ±200/24h cap, 6h delay) — slot is forward-compatible with reading from `AgentID.reputationOf(tokenId)` via an adapter, but for Phase 2 (when AgentID is not yet deployed) this is the simplest correct path. Bootstrap rep = 3000.
3. **Burn ZYL reserve model.** TaskEscrowV2 holds a treasury-replenished ZYL reserve and `_burn`s from its own balance (per spec implementation note). Treasury keeps the reserve topped up via off-chain ops; if reserve runs dry, `settle()` reverts with `InsufficientZylReserve` — failsafe rather than silent skip.

These are the only departures from the spec and are documented openly so the audit can review them.
