// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  SparkStaking — ZYL staking with batched activation, delegated Spark,
///         and pull-over-push rewards.
/// @notice
///  - Each `stake()` creates an independent batch with its own 24-hour
///    activation timestamp (Vector 3.3).
///  - `unstake()` immediately deactivates the batch's Spark even though the
///    underlying ZYL withdrawal waits 7 days (Vector 3.4 / Vector 6.5).
///  - Delegated Spark earns rewards via the cumulativeRewardPerSpark
///    pull-over-push pattern — settle never iterates over sponsors
///    (Vector 3.2).
///  - A 24-hour delegation-activation cooldown mitigates Vector 2.7 (delegation
///    front-run) without requiring off-chain merkle snapshots; full per-escrow
///    merkle snapshotting is the planned v2.1 hardening described in the spec
///    and the Threat Resolution document.
///  - `onAgentSlashed()` zeroes an agent's Spark bucket; sponsors then call
///    `cleanupSlashedDelegation()` to release their delegated Spark for
///    re-delegation (Vector 5.3).
///  - Each agent supports at most 500 sponsors (Vector 3.2 gas budget).
contract SparkStaking is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant ACTIVATION_DELAY = 24 hours;
    uint256 public constant UNSTAKE_COOLDOWN = 7 days;
    uint256 public constant MAX_SPONSORS_PER_AGENT = 500;
    uint256 public constant MIN_STAKE = 1_000 ether; // 1,000 ZYL minimum stake
    uint256 private constant ACC_SCALE = 1e18;

    IERC20 public immutable ZYL;

    // ─── State ────────────────────────────────────────────────────────────────

    struct StakeBatch {
        uint128 amount;
        uint64  activatesAt;          // when Spark begins to count
        uint64  unstakeRequestedAt;   // 0 if not unstaking; >0 deactivates immediately
    }

    struct Delegation {
        uint128 amount;
        uint64  activatesAt;          // delegation activation (Vector 2.7 cooldown)
        uint64  _reserved;
    }

    /// @dev address(this) is permitted to call onAgentSlashed only via AgentID;
    ///      address is set once by owner during deploy ordering.
    address public agentID;

    // user → list of stake batches
    mapping(address => StakeBatch[]) public stakes;
    // user → total ZYL staked (committed, before unstake)
    mapping(address => uint256) public totalStakedZyl;
    // user → currently unlocked (post-cooldown) withdrawable ZYL
    mapping(address => uint256) public withdrawableZyl;

    // user → total Spark currently delegated to all agents
    mapping(address => uint256) public delegatedSpark;
    // agent → total active delegated Spark
    mapping(address => uint256) public agentSpark;
    // agent → has been slashed (delegations to this agent are frozen)
    mapping(address => bool)    public agentSlashed;

    // user → agent → delegation
    mapping(address => mapping(address => Delegation)) public sponsorToAgent;
    // agent → number of unique sponsors (cap-enforced)
    mapping(address => uint256) public agentSponsorCount;

    // agent → cumulative ZYL reward per Spark unit (×1e18)
    mapping(address => uint256) public cumulativeRewardPerSpark;
    // user → agent → cumulativeRewardPerSpark at last claim (or first delegation)
    mapping(address => mapping(address => uint256)) public lastClaimedPerSpark;
    // total rewards held by contract (accounting; ZYL balance can hold extras like staked principal)
    uint256 public unclaimedRewardsTotal;

    // Authorized reward distributors (TaskEscrowV2 is whitelisted post-deploy)
    mapping(address => bool) public rewardDistributors;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Staked(address indexed user, uint256 amount, uint64 activatesAt, uint256 batchIndex);
    event UnstakeRequested(address indexed user, uint256 batchIndex, uint256 amount, uint64 unlocksAt);
    event Withdrawn(address indexed user, uint256 amount);
    event Delegated(address indexed sponsor, address indexed agent, uint256 amount, uint64 activatesAt);
    event Undelegated(address indexed sponsor, address indexed agent, uint256 amount);
    event RewardDistributed(address indexed agent, uint256 amount, uint256 sparkBase);
    event RewardClaimed(address indexed sponsor, address indexed agent, uint256 amount);
    event AgentSparkZeroed(address indexed agent);
    event SlashedDelegationCleaned(address indexed sponsor, address indexed agent, uint256 freedSpark);
    event RewardDistributorUpdated(address indexed distributor, bool allowed);
    event AgentIDUpdated(address indexed agentID);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error AmountTooSmall();
    error InvalidBatch();
    error AlreadyUnstaked();
    error CooldownActive();
    error InsufficientFreeSpark();
    error NotEnoughDelegated();
    error AgentIsSlashed();
    error MaxSponsorsReached();
    error NotAgentID();
    error NotRewardDistributor();
    error ZeroAmount();
    error ZeroSparkBase();
    error NotSlashed();
    error ZeroAddress();

    constructor(address zyl, address initialOwner) Ownable(initialOwner) {
        if (zyl == address(0) || initialOwner == address(0)) revert ZeroAddress();
        ZYL = IERC20(zyl);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAgentID(address _agentID) external onlyOwner {
        if (_agentID == address(0)) revert ZeroAddress();
        agentID = _agentID;
        emit AgentIDUpdated(_agentID);
    }

    function setRewardDistributor(address distributor, bool allowed) external onlyOwner {
        if (distributor == address(0)) revert ZeroAddress();
        rewardDistributors[distributor] = allowed;
        emit RewardDistributorUpdated(distributor, allowed);
    }

    // ─── Staking ──────────────────────────────────────────────────────────────

    /// @notice Stake ZYL. Each call creates a new batch with its own activation.
    function stake(uint256 amount) external nonReentrant returns (uint256 batchIndex) {
        if (amount < MIN_STAKE) revert AmountTooSmall();
        ZYL.safeTransferFrom(msg.sender, address(this), amount);

        uint64 activatesAt = uint64(block.timestamp + ACTIVATION_DELAY);
        stakes[msg.sender].push(StakeBatch({
            amount: uint128(amount),
            activatesAt: activatesAt,
            unstakeRequestedAt: 0
        }));
        totalStakedZyl[msg.sender] += amount;
        batchIndex = stakes[msg.sender].length - 1;
        emit Staked(msg.sender, amount, activatesAt, batchIndex);
    }

    /// @notice Mark a stake batch for unstake. Spark deactivates IMMEDIATELY
    ///         (Vector 3.4). Underlying ZYL becomes withdrawable after 7 days.
    /// @dev    Reverts if user has insufficient free (undelegated) Spark to
    ///         cover this batch — caller must `undelegate` first to keep
    ///         the invariant `delegatedSpark <= activeSpark`.
    function unstake(uint256 batchIndex) external nonReentrant {
        StakeBatch storage b = stakes[msg.sender][batchIndex];
        if (b.amount == 0) revert InvalidBatch();
        if (b.unstakeRequestedAt != 0) revert AlreadyUnstaked();

        uint256 batchAmt = b.amount;
        uint256 currentlyActive = activeSpark(msg.sender);
        // If the batch is currently active, removing it must not break the invariant.
        bool batchIsActive = b.activatesAt < block.timestamp;
        if (batchIsActive) {
            if (delegatedSpark[msg.sender] + batchAmt > currentlyActive) {
                revert InsufficientFreeSpark();
            }
        }

        b.unstakeRequestedAt = uint64(block.timestamp);
        emit UnstakeRequested(msg.sender, batchIndex, batchAmt, uint64(block.timestamp + UNSTAKE_COOLDOWN));
    }

    /// @notice After 7-day cooldown, withdraw underlying ZYL for a batch.
    function withdraw(uint256 batchIndex) external nonReentrant {
        StakeBatch storage b = stakes[msg.sender][batchIndex];
        if (b.amount == 0) revert InvalidBatch();
        if (b.unstakeRequestedAt == 0) revert InvalidBatch();
        if (block.timestamp < b.unstakeRequestedAt + UNSTAKE_COOLDOWN) revert CooldownActive();

        uint256 amt = b.amount;
        b.amount = 0; // mark consumed; preserves index ordering
        totalStakedZyl[msg.sender] -= amt;
        ZYL.safeTransfer(msg.sender, amt);
        emit Withdrawn(msg.sender, amt);
    }

    /// @notice Sum of activated, non-unstaked stake batches for a user.
    function activeSpark(address user) public view returns (uint256 total) {
        StakeBatch[] storage userStakes = stakes[user];
        uint256 len = userStakes.length;
        for (uint256 i; i < len; ++i) {
            StakeBatch storage b = userStakes[i];
            if (b.amount == 0) continue;
            if (b.unstakeRequestedAt != 0) continue;
            if (b.activatesAt >= block.timestamp) continue;
            total += b.amount;
        }
    }

    // ─── Delegation ───────────────────────────────────────────────────────────

    /// @notice Delegate active free Spark to an agent. The delegation enters a
    ///         24-hour activation period before earning new rewards
    ///         (Vector 2.7 cooldown).
    function delegate(address agent, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (agent == address(0)) revert ZeroAddress();
        if (agentSlashed[agent]) revert AgentIsSlashed();

        uint256 free = activeSpark(msg.sender) - delegatedSpark[msg.sender];
        if (amount > free) revert InsufficientFreeSpark();

        // Settle any previously accrued rewards for the existing delegation
        // before increasing the principal (standard MasterChef-style flow).
        _claimRewards(msg.sender, agent);

        Delegation storage d = sponsorToAgent[msg.sender][agent];
        bool isNewSponsor = (d.amount == 0);
        if (isNewSponsor) {
            if (agentSponsorCount[agent] >= MAX_SPONSORS_PER_AGENT) revert MaxSponsorsReached();
            agentSponsorCount[agent] += 1;
            // New sponsor enters at current cumulative — no retroactive rewards.
            lastClaimedPerSpark[msg.sender][agent] = cumulativeRewardPerSpark[agent];
        }

        d.amount += uint128(amount);
        d.activatesAt = uint64(block.timestamp + ACTIVATION_DELAY);

        delegatedSpark[msg.sender] += amount;
        agentSpark[agent] += amount;

        emit Delegated(msg.sender, agent, amount, d.activatesAt);
    }

    /// @notice Pull Spark back from an agent. Underlying ZYL stays staked.
    function undelegate(address agent, uint256 amount) external nonReentrant {
        if (agentSlashed[agent]) revert AgentIsSlashed(); // use cleanupSlashedDelegation
        Delegation storage d = sponsorToAgent[msg.sender][agent];
        if (d.amount < amount) revert NotEnoughDelegated();

        _claimRewards(msg.sender, agent);

        d.amount -= uint128(amount);
        delegatedSpark[msg.sender] -= amount;
        agentSpark[agent] -= amount;
        if (d.amount == 0) {
            agentSponsorCount[agent] -= 1;
            d.activatesAt = 0;
            // lastClaimedPerSpark left as-is; reset on next fresh delegation.
        }
        emit Undelegated(msg.sender, agent, amount);
    }

    /// @notice After an agent has been slashed, sponsors cleanup their
    ///         orphaned delegation (frees Spark for re-delegation).
    function cleanupSlashedDelegation(address agent) external nonReentrant {
        if (!agentSlashed[agent]) revert NotSlashed();
        Delegation storage d = sponsorToAgent[msg.sender][agent];
        uint256 freed = d.amount;
        if (freed == 0) revert NotEnoughDelegated();

        // No reward claim — onAgentSlashed already zeroed agentSpark and
        // freezes further reward distribution. Any pre-slash rewards must be
        // claimed via `claimRewards` BEFORE this cleanup. We allow that path:
        _claimRewards(msg.sender, agent);

        d.amount = 0;
        d.activatesAt = 0;
        delegatedSpark[msg.sender] -= freed;
        agentSponsorCount[agent] -= 1;
        emit SlashedDelegationCleaned(msg.sender, agent, freed);
    }

    // ─── Rewards ──────────────────────────────────────────────────────────────

    /// @notice TaskEscrowV2 (or any whitelisted distributor) deposits ZYL
    ///         reward to be split across the agent's current sponsors.
    function distributeReward(address agent, uint256 amount) external nonReentrant {
        if (!rewardDistributors[msg.sender]) revert NotRewardDistributor();
        if (amount == 0) revert ZeroAmount();
        uint256 base = agentSpark[agent];
        if (base == 0) revert ZeroSparkBase(); // caller must redirect (e.g., burn / treasury)

        ZYL.safeTransferFrom(msg.sender, address(this), amount);
        cumulativeRewardPerSpark[agent] += (amount * ACC_SCALE) / base;
        unclaimedRewardsTotal += amount;
        emit RewardDistributed(agent, amount, base);
    }

    /// @notice Claim accrued ZYL rewards for a delegation. Pull-over-push.
    function claimRewards(address agent) external nonReentrant {
        _claimRewards(msg.sender, agent);
    }

    function pendingRewards(address sponsor, address agent) external view returns (uint256) {
        Delegation storage d = sponsorToAgent[sponsor][agent];
        if (d.amount == 0) return 0;
        if (d.activatesAt >= block.timestamp) return 0; // not yet earning
        uint256 delta = cumulativeRewardPerSpark[agent] - lastClaimedPerSpark[sponsor][agent];
        return (uint256(d.amount) * delta) / ACC_SCALE;
    }

    function _claimRewards(address sponsor, address agent) internal {
        Delegation storage d = sponsorToAgent[sponsor][agent];
        if (d.amount == 0) {
            // Sync index if the user had a previous balance; cheap idempotence.
            lastClaimedPerSpark[sponsor][agent] = cumulativeRewardPerSpark[agent];
            return;
        }
        uint256 cumulative = cumulativeRewardPerSpark[agent];
        uint256 last = lastClaimedPerSpark[sponsor][agent];

        // Vector 2.7: if delegation has not yet activated, no rewards earned.
        // We move the index forward so future activations claim only post-here.
        if (d.activatesAt >= block.timestamp) {
            lastClaimedPerSpark[sponsor][agent] = cumulative;
            return;
        }

        uint256 delta = cumulative - last;
        uint256 owed = (uint256(d.amount) * delta) / ACC_SCALE;
        lastClaimedPerSpark[sponsor][agent] = cumulative;
        if (owed > 0) {
            unclaimedRewardsTotal -= owed;
            ZYL.safeTransfer(sponsor, owed);
            emit RewardClaimed(sponsor, agent, owed);
        }
    }

    // ─── Slash callback ───────────────────────────────────────────────────────

    /// @notice Called by AgentID when an agent finalizes a slash.
    ///         Zeroes the agent's Spark bucket; sponsors must cleanup
    ///         individually via cleanupSlashedDelegation (Vector 5.3).
    function onAgentSlashed(address agent) external {
        if (msg.sender != agentID) revert NotAgentID();
        agentSlashed[agent] = true;
        agentSpark[agent] = 0;
        // Stop further reward distribution: rewardDistributors call distributeReward
        // which checks agentSpark > 0; with agentSpark = 0 the call reverts and
        // TaskEscrowV2 will redirect the pool (e.g., burn/treasury).
        emit AgentSparkZeroed(agent);
    }
}
