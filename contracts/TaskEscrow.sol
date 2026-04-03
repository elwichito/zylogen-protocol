// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  TaskEscrow
/// @notice Gas-optimized micro-escrow for Base L2.
///         A sender locks ETH for a provider keyed by a bytes32 taskHash.
///         Only the oracle can release funds; after a 7-day timeout the
///         sender may reclaim. A 1 % protocol fee goes to treasury on release.
contract TaskEscrow is ReentrancyGuard {
    // ─── Custom Errors ────────────────────────────────────────────────────────

    error TaskAlreadyExists(bytes32 taskHash);
    error TaskNotFound(bytes32 taskHash);
    error InvalidAmount();
    error NotOracle();
    error NotSender();
    error DeadlineNotReached();
    error TransferFailed();

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @dev Tightly packed into exactly two 32-byte storage slots.
    ///
    ///   Slot 0 │ sender   (160 bits) │ amount   (96 bits)  │ = 256 bits
    ///   Slot 1 │ provider (160 bits) │ deadline (40 bits)  │ = 200 bits used
    ///
    /// amount == 0  ⟺  escrow is empty / already settled.
    struct Escrow {
        address sender;   // slot 0 [0 .. 159]
        uint96  amount;   // slot 0 [160 .. 255]
        address provider; // slot 1 [0 .. 159]
        uint40  deadline; // slot 1 [160 .. 199]
    }

    mapping(bytes32 => Escrow) public escrows;

    // ─── Immutables ───────────────────────────────────────────────────────────

    address public immutable oracle;
    address public immutable treasury;

    /// @dev 1 % fee: payout = amount - amount / 100
    uint256 private constant FEE_DENOM = 100;

    /// @dev 7 days expressed in seconds, fits uint40 (max ≈ year 36 812).
    uint40 private constant TIMEOUT = 7 * 24 * 60 * 60; // 604 800 s

    // ─── Events ───────────────────────────────────────────────────────────────

    event TaskCreated(
        bytes32 indexed taskHash,
        address indexed sender,
        address indexed provider,
        uint96  amount,
        uint40  deadline
    );

    event TaskReleased(
        bytes32 indexed taskHash,
        address indexed provider,
        uint96  providerAmount,
        uint96  fee
    );

    event TaskReclaimed(
        bytes32 indexed taskHash,
        address indexed sender,
        uint96  amount
    );

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address oracle_, address treasury_) {
        oracle   = oracle_;
        treasury = treasury_;
    }

    // ─── External Functions ───────────────────────────────────────────────────

    /// @notice Lock ETH in escrow for `provider`, keyed by `taskHash`.
    /// @param  taskHash  Unique identifier for the off-chain task.
    /// @param  provider  Address that will receive funds upon release.
    function lock(bytes32 taskHash, address provider) external payable {
        if (msg.value == 0 || msg.value > type(uint96).max) revert InvalidAmount();

        Escrow storage e = escrows[taskHash];
        if (e.amount != 0) revert TaskAlreadyExists(taskHash);

        uint96 amount   = uint96(msg.value);
        uint40 deadline = uint40(block.timestamp + TIMEOUT);

        e.sender   = msg.sender;
        e.amount   = amount;
        e.provider = provider;
        e.deadline = deadline;

        emit TaskCreated(taskHash, msg.sender, provider, amount, deadline);
    }

    /// @notice Oracle releases the locked funds to the provider.
    ///         1 % protocol fee is forwarded to treasury.
    /// @param  taskHash  Key of the escrow to release.
    function release(bytes32 taskHash) external onlyOracle nonReentrant {
        Escrow storage e = escrows[taskHash];
        uint96 amount = e.amount;
        if (amount == 0) revert TaskNotFound(taskHash);

        address provider = e.provider;
        uint96  fee      = uint96(amount / FEE_DENOM);
        uint96  payout   = amount - fee;

        // Clear storage before external calls (CEI pattern).
        delete escrows[taskHash];

        _safeTransfer(provider, payout);
        _safeTransfer(treasury, fee);

        emit TaskReleased(taskHash, provider, payout, fee);
    }

    /// @notice Sender reclaims the full deposit after the 7-day timeout
    ///         if the oracle has not responded.
    /// @param  taskHash  Key of the escrow to reclaim.
    function reclaim(bytes32 taskHash) external nonReentrant {
        Escrow storage e = escrows[taskHash];
        if (e.amount == 0)          revert TaskNotFound(taskHash);
        if (msg.sender != e.sender) revert NotSender();
        if (block.timestamp < e.deadline) revert DeadlineNotReached();

        uint96  amount = e.amount;
        address sender = e.sender;

        // Clear storage before external calls (CEI pattern).
        delete escrows[taskHash];

        _safeTransfer(sender, amount);

        emit TaskReclaimed(taskHash, sender, amount);
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

    function _safeTransfer(address to, uint96 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
