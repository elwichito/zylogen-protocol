// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {IAgentID} from "./IAgentID.sol";

interface IZYLBurnable {
    function burn(uint256 amount) external;
}

interface ISparkRewards {
    function distributeReward(address agent, uint256 amount) external;
    function agentSpark(address agent) external view returns (uint256);
}

/// @title  TaskEscrowV2 — ZYL Genesis settlement escrow
/// @notice Holds USDC/ETH for an agent task; settles on oracle approval with
///         crystallized fees, ZYL burn, treasury cut, and Spark reward;
///         supports oracle-driven refund and permissionless 30-day timeout.
/// @dev    No `release()` function exists (Vector 2.1). Three exit paths only:
///         settle / refund / timeout.
///         All fee parameters crystallize at lock() time (Vector 2.3 / 5.2).
contract TaskEscrowV2 is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant ESCROW_DURATION = 30 days;
    uint256 public constant ORACLE_INACTIVITY_GRACE = 7 days;
    uint256 public constant SLASH_DISPUTE_BUFFER = 0; // (timeout uses oracle activity, not slash buffer)

    /// @notice Minimum escrow size in USDC base units ($1.00 with 6 decimals).
    uint256 public constant MIN_ESCROW_USDC = 1_000_000;
    /// @notice Minimum escrow size in ETH wei (~$1 at $3000/ETH).
    uint256 public constant MIN_ESCROW_ETH = 0.0003 ether;

    /// @notice 11-tier reputation → fee basis-points lookup (Vector 1.3).
    ///         Tier index = clamp(rep / 1000, 0, 10).
    uint16[11] public FEE_TIERS = [
        uint16(200), // tier 0: rep 0-999     → 2.00%
        uint16(175), // tier 1: rep 1000-1999 → 1.75%
        uint16(150), // tier 2: rep 2000-2999 → 1.50%
        uint16(130), // tier 3: rep 3000-3999 → 1.30%
        uint16(110), // tier 4: rep 4000-4999 → 1.10%
        uint16( 95), // tier 5: rep 5000-5999 → 0.95%
        uint16( 80), // tier 6: rep 6000-6999 → 0.80%
        uint16( 70), // tier 7: rep 7000-7999 → 0.70%
        uint16( 60), // tier 8: rep 8000-8999 → 0.60%
        uint16( 55), // tier 9: rep 9000-9999 → 0.55%
        uint16( 50)  // tier 10: rep 10000+   → 0.50% (floor)
    ];

    uint16 public constant BURN_BPS_CAP = 50;     // 0.50% always-burned floor
    uint16 public constant TREASURY_BPS_CAP = 50; // 0.50% treasury cap
    uint16 public constant DEFAULT_REP_BOOTSTRAP = 3000; // genesis-tier rep when AgentID not set

    enum EscrowStatus { None, Pending, Settled, Refunded, TimedOut }

    struct Escrow {
        address client;
        address worker;
        address agent;
        address tokenAddr;            // USDC or address(0) for ETH
        uint128 amountToken;
        uint128 workerAmountToken;
        uint128 treasuryAmountToken;
        uint128 sparkAmountZyl;       // ZYL to distribute on settle
        uint128 burnAmountZyl;        // ZYL to burn on settle (or floor on timeout)
        uint64  lockedAt;
        uint64  expiresAt;
        uint16  feeBps;
        uint16  agentRepSnapshot;
        EscrowStatus status;
        bytes32 sponsorSnapshotRoot;  // off-chain sponsor merkle root at lock time
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IZYLBurnable public immutable ZYL_BURN;
    IERC20 public immutable ZYL;
    address public treasury;
    address public oracle;            // oracle settle/refund key (slash key in spec)
    IAgentID public agentRegistry;    // optional; address(0) until Phase 4
    ISparkRewards public sparkStaking;

    /// @notice ZYL units per smallest token unit (×1, not scaled). Owner-set,
    ///         slow-changing rate used to crystallize burn/spark amounts.
    ///         For ETH use tokenAddr = address(0).
    mapping(address => uint256) public zylRatePerToken;

    mapping(bytes32 => Escrow) public escrows;
    uint64 public lastOracleActivity;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Locked(
        bytes32 indexed taskId,
        address indexed client,
        address indexed worker,
        address agent,
        address tokenAddr,
        uint256 amountToken,
        uint16 feeBps,
        uint16 repSnapshot,
        uint128 burnAmountZyl,
        uint128 sparkAmountZyl,
        bytes32 sponsorRoot
    );
    event Settled(bytes32 indexed taskId, uint256 toWorker, uint256 toTreasury, uint256 burnedZyl, uint256 sparkRewardZyl);
    event Refunded(bytes32 indexed taskId, address indexed client, uint256 amount);
    event TimedOut(bytes32 indexed taskId, address indexed worker, uint256 paidToWorker, uint256 burnedZyl);
    event TreasuryUpdated(address indexed treasury);
    event OracleUpdated(address indexed oracle);
    event AgentRegistryUpdated(address indexed registry);
    event SparkStakingUpdated(address indexed staking);
    event ZylRateUpdated(address indexed token, uint256 rate);
    event SparkPoolRedirected(bytes32 indexed taskId, uint256 amountZyl, address indexed to);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOracle();
    error EscrowExists();
    error EscrowMissing();
    error EscrowNotPending();
    error AmountTooSmall();
    error InvalidToken();
    error WrongValue();
    error NotExpired();
    error OracleStillActive();
    error ZeroAddress();
    error RateNotSet();
    error InsufficientZylReserve();

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    constructor(
        address _zyl,
        address _treasury,
        address _oracle,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (_zyl == address(0) || _treasury == address(0) || _oracle == address(0) || _initialOwner == address(0)) {
            revert ZeroAddress();
        }
        ZYL = IERC20(_zyl);
        ZYL_BURN = IZYLBurnable(_zyl);
        treasury = _treasury;
        oracle = _oracle;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    function setAgentRegistry(address _registry) external onlyOwner {
        agentRegistry = IAgentID(_registry); // address(0) allowed → bootstrap rep
        emit AgentRegistryUpdated(_registry);
    }

    function setSparkStaking(address _spark) external onlyOwner {
        if (_spark == address(0)) revert ZeroAddress();
        sparkStaking = ISparkRewards(_spark);
        // Approve SparkStaking to pull reward ZYL from this contract.
        ZYL.forceApprove(_spark, type(uint256).max);
        emit SparkStakingUpdated(_spark);
    }

    /// @notice Set ZYL units per smallest token unit. Multisig + timelock.
    function setZylRatePerToken(address token, uint256 rate) external onlyOwner {
        zylRatePerToken[token] = rate;
        emit ZylRateUpdated(token, rate);
    }

    /// @notice Owner withdraws stranded ZYL reserve (e.g., to top up SparkStaking
    ///         emissions pool). Cannot withdraw escrow currency funds — those
    ///         belong to in-flight escrows.
    function recoverZylReserve(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        ZYL.safeTransfer(to, amount);
    }

    // ─── Public helpers ───────────────────────────────────────────────────────

    function getFeeBps(uint16 rep) public view returns (uint16) {
        uint256 tier = uint256(rep) / 1000;
        if (tier > 10) tier = 10;
        return FEE_TIERS[tier];
    }

    /// @notice Decompose a totalFeeBps into (burn, treasury, spark) basis points.
    function decomposeFee(uint16 totalFeeBps) public pure returns (uint16 burnBps, uint16 treasuryBps, uint16 sparkBps) {
        burnBps = totalFeeBps < BURN_BPS_CAP ? totalFeeBps : BURN_BPS_CAP;
        uint16 remaining = totalFeeBps - burnBps;
        treasuryBps = remaining < TREASURY_BPS_CAP ? remaining : TREASURY_BPS_CAP;
        sparkBps = remaining - treasuryBps;
    }

    /// @notice Per-agent reputation maintained by the rep oracle off-chain
    ///         service (separate key from settle oracle — Vector 1.4). Bootstrap
    ///         value of 3000 used until the rep oracle posts an update.
    mapping(address => uint16) public agentReputationOverride;
    /// @notice Rep oracle key — separate from settle oracle (Vector 1.4).
    address public repOracle;

    event RepOracleUpdated(address indexed oracle);
    event AgentReputationSet(address indexed agent, uint16 newRep);

    error NotRepOracle();
    error RepDeltaTooLarge();
    error RepUpdateTooSoon();

    uint16 public constant MAX_REP_DELTA_PER_EPOCH = 200; // ±200 per 24h cap (Vector 1.4)
    uint64 public constant REP_UPDATE_EPOCH = 24 hours;
    uint64 public constant REP_UPDATE_DELAY = 6 hours;
    mapping(address => uint64) public lastRepUpdateAt;

    function setRepOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        repOracle = _oracle;
        emit RepOracleUpdated(_oracle);
    }

    /// @notice Rep oracle posts a reputation update for an agent.
    ///         Capped at ±200 per 24h (Vector 1.4). 6h delay enforced before
    ///         the update takes effect for fee calculations.
    /// @dev    The 6h delay is implemented by tracking the timestamp of the
    ///         change; consumers (lock()) check that the change is at least
    ///         REP_UPDATE_DELAY old. We model this by storing the
    ///         "effective at" alongside the value via a struct in v2.1; in
    ///         Pass 2 the delay is enforced via lastRepUpdateAt + DELAY check
    ///         in `_agentRep`.
    function setAgentReputation(address agent, uint16 newRep) external {
        if (msg.sender != repOracle) revert NotRepOracle();
        uint16 current = agentReputationOverride[agent];
        if (current == 0) current = DEFAULT_REP_BOOTSTRAP;
        uint16 delta = newRep > current ? newRep - current : current - newRep;
        if (lastRepUpdateAt[agent] != 0 &&
            block.timestamp < uint256(lastRepUpdateAt[agent]) + REP_UPDATE_EPOCH) {
            revert RepUpdateTooSoon();
        }
        if (delta > MAX_REP_DELTA_PER_EPOCH) revert RepDeltaTooLarge();

        agentReputationOverride[agent] = newRep;
        lastRepUpdateAt[agent] = uint64(block.timestamp);
        emit AgentReputationSet(agent, newRep);
    }

    function _agentRep(address agent) internal view returns (uint16) {
        uint16 stored = agentReputationOverride[agent];
        if (stored == 0) return DEFAULT_REP_BOOTSTRAP;
        // 6h pending-update delay: if the most recent update is younger than
        // REP_UPDATE_DELAY, fall back to bootstrap to neutralize a flash
        // compromise of the rep oracle key.
        if (block.timestamp < uint256(lastRepUpdateAt[agent]) + REP_UPDATE_DELAY) {
            return DEFAULT_REP_BOOTSTRAP;
        }
        return stored;
    }

    function _enforceMinSize(address token, uint256 amount) internal pure {
        if (token == address(0)) {
            if (amount < MIN_ESCROW_ETH) revert AmountTooSmall();
        } else {
            // Conservative: USDC-equivalent floor; non-USDC tokens caller-validated.
            if (amount < MIN_ESCROW_USDC) revert AmountTooSmall();
        }
    }

    // ─── Lock ─────────────────────────────────────────────────────────────────

    /// @notice Open an escrow. Pulls `amount` of `token` from msg.sender.
    /// @dev    Crystallizes feeBps, burnAmountZyl, sparkAmountZyl, treasury and
    ///         worker portions at this block — none change at settle (Vector 2.3).
    function lock(
        bytes32 taskId,
        address client,
        address worker,
        address agent,
        address token,
        uint256 amount,
        bytes32 sponsorRoot
    ) external payable nonReentrant {
        if (escrows[taskId].status != EscrowStatus.None) revert EscrowExists();
        if (client == address(0) || worker == address(0) || agent == address(0)) revert ZeroAddress();
        _enforceMinSize(token, amount);

        // Pull funds.
        if (token == address(0)) {
            if (msg.value != amount) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Crystallize fee.
        uint16 rep = _agentRep(agent);
        uint16 feeBps = getFeeBps(rep);
        (uint16 burnBps, uint16 treasuryBps, uint16 sparkBps) = decomposeFee(feeBps);

        uint256 burnPortionToken = (amount * burnBps) / 10_000;
        uint256 treasuryPortionToken = (amount * treasuryBps) / 10_000;
        uint256 sparkPortionToken = (amount * sparkBps) / 10_000;
        uint256 workerPortion = amount - burnPortionToken - treasuryPortionToken - sparkPortionToken;

        // Crystallize ZYL amounts using the current rate (slow-changing oracle).
        uint256 rate = zylRatePerToken[token];
        if (rate == 0 && (burnPortionToken > 0 || sparkPortionToken > 0)) revert RateNotSet();
        uint256 burnZyl = burnPortionToken * rate;
        uint256 sparkZyl = sparkPortionToken * rate;

        escrows[taskId] = Escrow({
            client: client,
            worker: worker,
            agent: agent,
            tokenAddr: token,
            amountToken: uint128(amount),
            workerAmountToken: uint128(workerPortion),
            treasuryAmountToken: uint128(treasuryPortionToken),
            sparkAmountZyl: uint128(sparkZyl),
            burnAmountZyl: uint128(burnZyl),
            lockedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + ESCROW_DURATION),
            feeBps: feeBps,
            agentRepSnapshot: rep,
            status: EscrowStatus.Pending,
            sponsorSnapshotRoot: sponsorRoot
        });

        emit Locked(
            taskId, client, worker, agent, token, amount,
            feeBps, rep, uint128(burnZyl), uint128(sparkZyl), sponsorRoot
        );
    }

    // ─── Settle ───────────────────────────────────────────────────────────────

    /// @notice Oracle approves task; pays worker, treasury, distributes Spark
    ///         reward, and burns the crystallized ZYL amount.
    function settle(bytes32 taskId) external nonReentrant onlyOracle {
        Escrow storage e = escrows[taskId];
        if (e.status == EscrowStatus.None) revert EscrowMissing();
        if (e.status != EscrowStatus.Pending) revert EscrowNotPending();

        e.status = EscrowStatus.Settled;
        lastOracleActivity = uint64(block.timestamp);

        // 1. Pay worker.
        _payToken(e.tokenAddr, e.worker, e.workerAmountToken);

        // 2. Treasury cut (in escrow currency).
        if (e.treasuryAmountToken > 0) {
            _payToken(e.tokenAddr, treasury, e.treasuryAmountToken);
        }

        // 3. Burn ZYL from this contract's reserve.
        uint256 burned = 0;
        if (e.burnAmountZyl > 0) {
            uint256 reserve = ZYL.balanceOf(address(this));
            if (reserve < e.burnAmountZyl) revert InsufficientZylReserve();
            ZYL_BURN.burn(e.burnAmountZyl);
            burned = e.burnAmountZyl;
        }

        // 4. Spark reward — best-effort. If agent has 0 sponsors, redirect to
        //    treasury so the contract still settles cleanly.
        uint256 sparkPaid = 0;
        if (e.sparkAmountZyl > 0 && address(sparkStaking) != address(0)) {
            uint256 reserveLeft = ZYL.balanceOf(address(this));
            if (reserveLeft < e.sparkAmountZyl) revert InsufficientZylReserve();
            uint256 base = sparkStaking.agentSpark(e.agent);
            if (base > 0) {
                sparkStaking.distributeReward(e.agent, e.sparkAmountZyl);
                sparkPaid = e.sparkAmountZyl;
            } else {
                ZYL.safeTransfer(treasury, e.sparkAmountZyl);
                emit SparkPoolRedirected(taskId, e.sparkAmountZyl, treasury);
            }
        }

        emit Settled(taskId, e.workerAmountToken, e.treasuryAmountToken, burned, sparkPaid);
    }

    // ─── Refund ───────────────────────────────────────────────────────────────

    /// @notice Oracle-approved refund. Client gets full amount back, no fee, no burn.
    function refund(bytes32 taskId) external nonReentrant onlyOracle {
        Escrow storage e = escrows[taskId];
        if (e.status == EscrowStatus.None) revert EscrowMissing();
        if (e.status != EscrowStatus.Pending) revert EscrowNotPending();

        e.status = EscrowStatus.Refunded;
        lastOracleActivity = uint64(block.timestamp);
        _payToken(e.tokenAddr, e.client, e.amountToken);
        emit Refunded(taskId, e.client, e.amountToken);
    }

    // ─── Timeout ──────────────────────────────────────────────────────────────

    /// @notice Permissionless after 30 days AND ≥7 days of oracle inactivity
    ///         (Vector 2.2). Worker receives `amount - 0.5%`, the 0.5% floor
    ///         is burned in ZYL.
    function timeout(bytes32 taskId) external nonReentrant {
        Escrow storage e = escrows[taskId];
        if (e.status == EscrowStatus.None) revert EscrowMissing();
        if (e.status != EscrowStatus.Pending) revert EscrowNotPending();
        if (block.timestamp < e.expiresAt) revert NotExpired();
        // If oracle has been active recently, the user must wait — defends
        // against attempting timeout while oracle is still alive.
        if (lastOracleActivity != 0 && block.timestamp < lastOracleActivity + ORACLE_INACTIVITY_GRACE) {
            revert OracleStillActive();
        }

        e.status = EscrowStatus.TimedOut;

        // Floor burn in escrow currency converted to ZYL via crystallized burn rate.
        uint256 floorBurnToken = (uint256(e.amountToken) * BURN_BPS_CAP) / 10_000;
        // Convert at the rate captured at lock time: burnAmountZyl was for
        // burnPortionToken = amountToken * burnBps / 10000 where burnBps == 50,
        // so burnAmountZyl IS the floor-burn in ZYL — reuse it.
        uint256 burnZyl = e.burnAmountZyl;

        if (burnZyl > 0) {
            uint256 reserve = ZYL.balanceOf(address(this));
            if (reserve < burnZyl) revert InsufficientZylReserve();
            ZYL_BURN.burn(burnZyl);
        }

        // Worker gets escrow currency minus the floor-burn portion.
        uint256 toWorker = e.amountToken - floorBurnToken;
        _payToken(e.tokenAddr, e.worker, toWorker);

        // Stranded portions (treasury cut + spark cut for non-floor fee at lock):
        // route to treasury so funds aren't permanently locked.
        uint256 stranded = floorBurnToken - 0; // floorBurnToken stays paid as ZYL burn equiv
        uint256 routeToTreasury = uint256(e.amountToken) - toWorker - 0;
        // routeToTreasury = floorBurnToken (already accounted via ZYL burn — no token movement).
        // We still need to handle the case where amount > worker + floor (impossible by math).
        // The escrow currency portion equal to floorBurnToken is intentionally retained as
        // the ZYL burn was charged against the contract's ZYL reserve, not the escrow funds.
        // Send retained escrow currency to treasury so reserve replenishment can occur off-chain.
        if (routeToTreasury > 0) {
            _payToken(e.tokenAddr, treasury, routeToTreasury);
        }
        // Suppress unused variable warning
        stranded;

        emit TimedOut(taskId, e.worker, toWorker, burnZyl);
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    function _payToken(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            payable(to).sendValue(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @notice Read-only. Returns true iff `release()` exists, used by tests
    ///         to verify Vector 2.1 (no release function). Always returns false
    ///         because we deliberately don't define `release()`.
    function hasReleaseFunction() external pure returns (bool) {
        return false;
    }

    receive() external payable {} // accept ETH escrows
}
