// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Zylogen
 * @notice Escrow + REP system for the Zylogen Protocol.
 *         Payments are relayed here by the backend after Stripe confirmation.
 *         Users never interact with this contract directly.
 */
contract Zylogen is Ownable, ReentrancyGuard {
    // ─── Structs ────────────────────────────────────────────────────────────

    struct EscrowEntry {
        address client;
        uint256 amount;
        uint256 lockedAt;
        bool released;
        bool refunded;
    }

    struct RepProfile {
        uint256 score;
        uint256 tasksCompleted;
        uint256 lastTaskTimestamp;
        uint256 totalStaked;       // cumulative MATIC staked across all tasks
        uint256 windowTaskCount;   // tasks in rolling 7-day window
        uint256 windowStart;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    /// @dev Protocol fee in basis points (500 = 5%)
    uint256 public constant PROTOCOL_FEE_BPS = 500;

    /// @dev Minimum stake required per task (0.001 MATIC) — Sybil cost floor
    uint256 public constant MIN_TASK_STAKE = 0.001 ether;

    /// @dev Max REP gain per task, decays when window is saturated
    uint256 public constant MAX_REP_PER_TASK = 100;

    /// @dev Rolling window length for rate limiting (7 days)
    uint256 public constant REP_WINDOW = 7 days;

    /// @dev Max tasks that earn full REP within the window
    uint256 public constant WINDOW_TASK_CAP = 10;

    uint256 public nextEscrowId;
    mapping(uint256 => EscrowEntry) public escrows;
    mapping(address => RepProfile) public repProfiles;
    mapping(address => bool) public authorizedRelayers; // backend hot wallets

    // ─── Events ──────────────────────────────────────────────────────────────

    event FundsLocked(uint256 indexed escrowId, address indexed client, uint256 amount);
    event FundsReleased(uint256 indexed escrowId, address indexed client, uint256 net, uint256 fee);
    event FundsRefunded(uint256 indexed escrowId, address indexed client, uint256 amount);
    event RepGranted(address indexed worker, uint256 earned, uint256 newTotal);
    event RelayerUpdated(address indexed relayer, bool authorized);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender], "Zylogen: not an authorized relayer");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    // ─── Escrow ──────────────────────────────────────────────────────────────

    /**
     * @notice Called by the backend relayer after a Stripe payment is confirmed.
     *         The relayer sends the equivalent MATIC value with this call.
     * @param client  The Privy-embedded wallet address of the paying user.
     */
    function lockFunds(address client) external payable onlyRelayer nonReentrant returns (uint256 escrowId) {
        require(msg.value > 0, "Zylogen: zero value");
        escrowId = nextEscrowId++;
        escrows[escrowId] = EscrowEntry({
            client: client,
            amount: msg.value,
            lockedAt: block.timestamp,
            released: false,
            refunded: false
        });
        emit FundsLocked(escrowId, client, msg.value);
    }

    /**
     * @notice Releases escrowed funds to the worker after service delivery.
     *         Deducts protocol fee and grants REP to the worker.
     */
    function releaseFunds(uint256 escrowId, address worker) external onlyRelayer nonReentrant {
        EscrowEntry storage e = escrows[escrowId];
        require(!e.released && !e.refunded, "Zylogen: already settled");

        e.released = true;

        uint256 fee = (e.amount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 net = e.amount - fee;

        (bool workerPaid,) = worker.call{value: net}("");
        require(workerPaid, "Zylogen: worker transfer failed");

        (bool feePaid,) = owner().call{value: fee}("");
        require(feePaid, "Zylogen: fee transfer failed");

        _grantRep(worker, e.amount);
        emit FundsReleased(escrowId, e.client, net, fee);
    }

    /**
     * @notice Refunds client if service is not delivered within the SLA window.
     */
    function refundClient(uint256 escrowId) external onlyRelayer nonReentrant {
        EscrowEntry storage e = escrows[escrowId];
        require(!e.released && !e.refunded, "Zylogen: already settled");
        e.refunded = true;

        (bool ok,) = e.client.call{value: e.amount}("");
        require(ok, "Zylogen: refund transfer failed");
        emit FundsRefunded(escrowId, e.client, e.amount);
    }

    // ─── REP ─────────────────────────────────────────────────────────────────

    /**
     * @dev Grants REP with three anti-Sybil controls:
     *      1. Mandatory minimum stake (economic cost floor)
     *      2. Diminishing returns within a 7-day rolling window
     *      3. Sqrt(stake) scaling — large fake payments don't scale linearly
     */
    function _grantRep(address worker, uint256 stakeAmount) internal {
        require(stakeAmount >= MIN_TASK_STAKE, "Zylogen: stake too low for REP");

        RepProfile storage p = repProfiles[worker];

        // Reset window counter if > 7 days have passed
        if (block.timestamp >= p.windowStart + REP_WINDOW) {
            p.windowStart = block.timestamp;
            p.windowTaskCount = 0;
        }

        p.windowTaskCount++;
        p.tasksCompleted++;
        p.lastTaskTimestamp = block.timestamp;
        p.totalStaked += stakeAmount;

        // Diminishing factor: tasks beyond the window cap earn proportionally less
        uint256 diminishingFactor = p.windowTaskCount <= WINDOW_TASK_CAP
            ? 100
            : (WINDOW_TASK_CAP * 100) / p.windowTaskCount;

        // Sqrt scaling of stake: reward scales with sqrt(stakeAmount / MIN_TASK_STAKE)
        uint256 stakeMultiple = stakeAmount / MIN_TASK_STAKE;
        uint256 sqrtMultiple = _sqrt(stakeMultiple);  // dampens large-stake attacks
        uint256 sqrtCapped = sqrtMultiple > 10 ? 10 : sqrtMultiple; // cap at 10x

        uint256 earned = (MAX_REP_PER_TASK * diminishingFactor * sqrtCapped) / (100 * 10);
        p.score += earned;

        emit RepGranted(worker, earned, p.score);
    }

    /// @dev Integer square root (Babylonian method)
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ─── View ────────────────────────────────────────────────────────────────

    function getRepScore(address worker) external view returns (uint256) {
        return repProfiles[worker].score;
    }

    function getEscrow(uint256 escrowId) external view returns (EscrowEntry memory) {
        return escrows[escrowId];
    }
}
