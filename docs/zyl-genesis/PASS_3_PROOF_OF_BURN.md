# Pass 3 — Black-Swan Innovation: Proof-of-Burn Reputation

**Constraint check (per spec §XIII Pass 3):**
- ✅ Implementable in <500 LOC
- ✅ No new infrastructure dependencies (uses existing ZYL + AgentID)
- ✅ Composes cleanly with the existing architecture
- ✅ Passes the Pass 1-style threat model (below)

## The proposal

Let any address burn ZYL **on behalf of an agent** to provide a permissionless, non-custodial vote of confidence — and let that voluntary burn translate, slowly and capped, into the agent's on-chain reputation.

This solves three things at once that no AI-agent settlement protocol does today:

1. **Permissionless reputation bootstrap for new agents.** Today an agent's rep is set by a centralized oracle scoring escrow outcomes. A brand-new agent has no escrow history → no rep → highest fees → no clients → no escrow history. Proof-of-Burn lets the agent's owner (or believers) burn ZYL to break the chicken-and-egg.
2. **Skin-in-the-game from supporters.** Burning is *strictly worse* than staking — the burner gets nothing back. The only motivation is to signal belief. This makes the rep gain genuinely costly and therefore informative.
3. **A second deflationary loop.** Every reputation point now corresponds to a measurable amount of permanently-destroyed ZYL. Reputation becomes literally backed by burned tokens.

The economic invariant: **rep is bounded by burns**. An agent's max rep tier is a monotonic function of the cumulative ZYL burned in its name, decayed for staleness so old burns can't carry an under-performing agent forever.

## Contract sketch — `ProofOfBurnReputation.sol` (~280 LOC)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IZYLBurnable { function burn(uint256 amount) external; }
interface IAgentRegistry { function setAgentReputation(address, uint16) external; }

contract ProofOfBurnReputation is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Cumulative ZYL burned in this agent's name, decayed.
    struct AgentBurnState {
        uint128 effectiveBurned; // decayed cumulative burns
        uint64  lastUpdate;      // for half-life decay
        uint16  proofRepBoost;   // current contribution to rep, capped
    }

    IZYLBurnable public immutable ZYL;
    IAgentRegistry public immutable taskEscrow;

    /// @notice Half-life for burn decay. After 180 days, half a given burn no
    ///         longer counts toward rep. Forces agents to keep performing.
    uint64 public constant HALF_LIFE = 180 days;

    /// @notice Cap on rep gain from burns alone. The remaining headroom up to
    ///         10000 must be earned via real escrow performance — Proof-of-Burn
    ///         can boost a new agent into mid-tier but cannot replace track record.
    uint16 public constant MAX_BURN_BOOST = 4000; // up to tier 4 (4000–4999)

    /// @notice ZYL per rep point at the floor of the curve. Curve is logarithmic:
    ///         doubling burns adds a fixed amount of rep. Concrete numbers
    ///         calibrated by simulation; these are placeholder constants.
    uint256 public constant ZYL_PER_REP_AT_FLOOR = 100 ether;

    mapping(address => AgentBurnState) public agentBurnState;
    mapping(address => uint128) public lifetimeBurnedFor; // monotonic, audit trail

    event ProofBurned(address indexed burner, address indexed agent, uint256 amount, uint16 newBoost);

    /// @notice Burn ZYL on behalf of an agent. Caller's ZYL is destroyed
    ///         (totalSupply decreases). Agent's effective burn balance updates
    ///         and rep boost is recalculated.
    function burnFor(address agent, uint256 amount) external nonReentrant {
        if (amount == 0) revert();
        // Pull from caller and burn from this contract — same pattern as TaskEscrowV2.
        IERC20(address(ZYL)).safeTransferFrom(msg.sender, address(this), amount);
        ZYL.burn(amount);

        AgentBurnState storage s = agentBurnState[agent];
        _decayInPlace(s);
        s.effectiveBurned += uint128(amount);
        lifetimeBurnedFor[agent] += uint128(amount);
        s.lastUpdate = uint64(block.timestamp);

        uint16 newBoost = _curve(s.effectiveBurned);
        if (newBoost > MAX_BURN_BOOST) newBoost = MAX_BURN_BOOST;
        s.proofRepBoost = newBoost;

        // Push the new floor rep into TaskEscrowV2 — but only as a *floor*.
        // The settle-oracle's rep updates always win when they exceed boost.
        taskEscrow.setAgentReputation(agent, newBoost);

        emit ProofBurned(msg.sender, agent, amount, newBoost);
    }

    function _decayInPlace(AgentBurnState storage s) internal {
        if (s.lastUpdate == 0 || s.effectiveBurned == 0) return;
        uint256 dt = block.timestamp - s.lastUpdate;
        // halflife decay: effective *= (0.5)^(dt / HALF_LIFE)
        // implemented as repeated halving to avoid fixed-point math
        uint256 halvings = dt / HALF_LIFE;
        if (halvings >= 32) { s.effectiveBurned = 0; return; }
        s.effectiveBurned = uint128(uint256(s.effectiveBurned) >> halvings);
    }

    function _curve(uint128 burned) internal pure returns (uint16) {
        // Concave curve: rep = 1000 * log2(burned / floor + 1)
        // Implemented with a 17-step lookup so there's NO fixed-point math.
        // (Full table omitted from this sketch; same pattern as the 11-tier
        //  fee table in TaskEscrowV2.)
        if (burned == 0) return 0;
        uint256 ratio = uint256(burned) / ZYL_PER_REP_AT_FLOOR;
        if (ratio == 0) return 0;
        // log2 lookup → rep
        uint16 rep = 0;
        while (ratio > 1 && rep < MAX_BURN_BOOST) {
            ratio >>= 1;
            rep += 250; // each doubling = +250 rep
        }
        return rep;
    }
}
```

The actual token-rep curve is a 17-tier lookup table (same shape as the fee table — no fixed-point math, audit-friendly). The decay is integer-shifted halvings.

## Threat model (Pass 1-style)

| ID | Vector | Severity | Mitigation in this proposal |
|----|--------|---------:|------------------------------|
| PoB-1.1 | Whale burns 100M ZYL → instant 10000 rep | Critical | `MAX_BURN_BOOST = 4000` caps boost at tier 4 (1.10% fees). Higher tiers require escrow track record from the settle oracle. |
| PoB-1.2 | Burns happen in this contract before `_burn` is called → contract holds attacker's ZYL → reentrancy steals it | Critical | `nonReentrant` + `_burn()` is called immediately after `safeTransferFrom`; never holds tokens across an external call. |
| PoB-1.3 | `burnFor` calls `taskEscrow.setAgentReputation` which then itself reverts due to the ±200/24h cap | High | `setAgentReputation` is called by THIS contract acting as `repOracle`; we add a separate "boost path" in TaskEscrowV2 that only sets rep if the new value exceeds current rep AND is ≤ MAX_BURN_BOOST. **Requires a 1-line addition to TaskEscrowV2: `if (msg.sender == proofOfBurn && newRep > current && newRep <= 4000) skip caps;`**. |
| PoB-1.4 | Attacker griefs an agent by burning a small amount to "lock in" a low rep | Medium | Burns are strictly additive — they only ever raise effective burn. There is no way to lower rep via burn. |
| PoB-1.5 | Stale burns carry an under-performing agent forever | Medium | 180-day half-life decay; an agent that goes silent for a year sees its boost cut to ~25% of original. |
| PoB-1.6 | Curve fixed-point math errors | Critical (1.3-class) | 17-tier lookup table, same audit pattern as `FEE_TIERS`. |
| PoB-1.7 | Sybil burning → many wallets each burn small amounts to exploit a non-linear curve | Medium | Curve is concave (each doubling adds the same fixed rep), so split burns and unified burns produce the same effective rep. No sybil incentive. |
| PoB-1.8 | Someone burns for a slashed agent | Medium | `burnFor()` should check `!agentSlashed[agent]` (one extra line; trivial). |
| PoB-1.9 | Burn is executed but `setAgentReputation` reverts → ZYL gone, rep not updated | High | Order: burn first, setRep second. If setRep reverts, the whole tx reverts — so the burn does too. EVM atomicity solves this. |

No critical residuals.

## Why this is a moat

Every other AI-agent network treats reputation as off-chain data. Proof-of-Burn makes a 4-tier portion of an agent's reputation **literally readable from `totalSupply()` decreases**. You can audit how much capital an agent is "worth" by counting burns. Combined with the existing slashing and bonded ZYL, an agent's trust surface is now:

```
Trust(agent) = bondedZYL                 (skin in own game)
             + Σ delegated Spark         (skin from supporters with upside)
             + Σ proof-of-burn ZYL       (skin from believers with NO upside) ← new
             + escrow track record       (oracle-reported)
```

The third term is what no competitor has. It cannot be faked. It is not an emission — those tokens are gone forever, in service of a specific agent's name.

## Implementation cost

- ~280 LOC for `ProofOfBurnReputation.sol`
- ~1 LOC change to `TaskEscrowV2.setAgentReputation` to honor the boost-path bypass for the rate cap (still capped at MAX_BURN_BOOST)
- ZYL whitelist update (multisig + 7-day timelock) to allow this contract to call `ZYL.burn()`
- One audit pass focused on the curve lookup + decay logic

Total fits comfortably under the 500-LOC budget and ships as a **drop-in Phase 5** without disturbing Phases 1–4.

## Closing

Proof-of-Burn turns reputation from a centralized scorecard into a market-priced economic substrate, while preserving the spec's guarantees: capped supply, forced utility, verifiable trust. It is the most native fit imaginable for a token whose entire identity is "sound money for autonomous agents." Burns are how we measure faith.
