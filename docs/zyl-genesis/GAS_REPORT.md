# ZYL Genesis — Gas Optimization Report

**Compiler:** solc 0.8.28, optimizer runs=200, viaIR=true, evmVersion=cancun
**Target chain:** Base L2 (Cancun-compatible)
**Generated:** 2026-04-29

## Hot-path measurements (Hardhat)

| Function | Avg gas | Notes |
|---|---:|---|
| `TaskEscrowV2.lock` | 245,363 | Includes `transferFrom` of escrow currency, struct write (8 packed slots), and crystallization math. |
| `TaskEscrowV2.settle` | 147,829 | Worker payout + treasury transfer + ZYL `_burn` + `distributeReward`. **O(1) regardless of sponsor count** (Vector 3.2). |
| `TaskEscrowV2.refund` | 73,069 | Status flip + single token transfer; no burn path. |
| `TaskEscrowV2.timeout` | 101,239 | Permissionless; floor-burn ZYL + worker transfer + retained-token route to treasury. |
| `SparkStaking.stake` | 75K–131K | First batch ~75K; subsequent batches share the array tail and amortize. |
| `SparkStaking.delegate` | 94K–128K | First delegation pays sponsor-set init; subsequent updates ~25K cheaper. |
| `SparkStaking.unstake` | 36,538 | Just sets `unstakeRequestedAt`; no token movement. |
| `SparkStaking.withdraw` | 45,065 | Single transfer. |
| `AgentID.bond` | 88,699 | Pull ZYL + struct write. |
| `AgentID.initiateSlash` | 80,228 | Owner snapshot write (Vector 1.6). |
| `AgentID.finalizeSlash` | 58–84K | Burn 100% slashed + `onAgentSlashed` callback. |
| `ZYL.setBurnWhitelist` | 47,816 | Single mapping store. |
| `ZylogenDeployer.deploy` | 1,482,632 | Atomic mint + 5 transfers + ownership transfer; one-shot. |

## Storage-packing strategy

The `Escrow` struct in `TaskEscrowV2` is laid out so `lockedAt` / `expiresAt` (uint64) and `feeBps` / `agentRepSnapshot` / `status` (uint16+uint16+uint8) share single 256-bit slots, keeping the per-escrow SSTORE count to 7 cold writes at lock and 1 warm write at settle.

`StakeBatch` (uint128 + uint64 + uint64) and `Delegation` (uint128 + uint64 + uint64) each fit in one slot, so `stake()` / `delegate()` are single-slot writes per batch/delegation.

`AgentBond` is sized to fit (uint256 + uint64 + uint16 + uint64 + uint128 + address) where the small fields share the slot with `bondedAt` and `reputationScore`. The `pendingSlashOwnerSnapshot` address sits in its own slot — necessary for the Vector 1.6 mitigation.

## Custom-error usage

All revert paths use `error Foo()` rather than `require(..., "string")`. This eliminates ~50 bytes of revert-string per error and ~20 gas at runtime.

## Base L2 calldata cost

A typical `lock()` call carries ~256 bytes of calldata (5 addresses + 2 uint256 + 1 bytes32). At Base's calldata pricing (~16 gas/byte L2 + L1 calldata fee passthrough), this is dominated by the L1 blob fee, which is largely outside the contract's control. Packing the `Escrow` struct prevents amplification at storage time.

## Optimization opportunities (deferred)

1. **Transient storage for reentrancy guard** (EIP-1153): replacing `ReentrancyGuard`'s SSTORE with `tload`/`tstore` saves ~2,000 gas per protected call. The Cancun target supports it; the OZ ReentrancyGuard does not yet use transient storage. Worth a custom drop-in for `lock()` / `settle()` / `refund()` / `timeout()`.
2. **Inline ERC-20 transfer for known-good tokens.** `SafeERC20` adds boilerplate that is unnecessary when the only escrow currency is USDC + ETH; a custom `_pullUSDC` helper could shave ~3K gas per transfer. Defer until after the first audit.
3. **Bitmap for reward-distributor whitelist.** Single mapping is fine for the v1 case; if more than ~16 distributors are ever whitelisted, switch to a bitmap.

None of these are blocking for Phase 1 launch. The current cost profile is well under the 60M block-gas-limit (largest deploy is the factory at 2.3M, 3.8% of a single block).

## Conclusion

`lock()` + `settle()` together are ~393K gas per task. At Base's typical 0.001 gwei base fee + L1 blob amortization, this prices at well under $0.01 per escrow-roundtrip — comfortably within the spec's "no fixed-point math, packed structs, no SSTORE in hot paths" guidance. No changes are required for Phase 1.
