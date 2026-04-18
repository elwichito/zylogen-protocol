// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title  TaskEscrowV2
/// @author Zylogen Protocol
/// @notice USDC-only micro-escrow for Base L2.
///         Relayer locks USDC for a worker keyed by bytes32 taskId.
///         Only the oracle can release or refund; fees accumulate in contract
///         and are withdrawn by owner. 1% protocol fee on release.
contract TaskEscrowV2 is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @dev 1% fee: fee = amount * FEE_BPS / 10_000
    uint256 public constant FEE_BPS = 100;

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20 public immutable USDC;

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public oracle;
    uint256 public collectedFees;

    enum TaskStatus { None, Locked, Released, Refunded }

    /// @dev Tightly packed into 2 storage slots:
    ///   Slot 0 │ client (160) │ amount (96)             │ = 256 bits
    ///   Slot 1 │ worker (160) │ deadline (40) │ status (8) │ = 208 bits
    struct Task {
        address client;    // slot 0 [0..159]
        uint96  amount;    // slot 0 [160..255]
        address worker;    // slot 1 [0..159]
        uint40  deadline;  // slot 1 [160..199]
        TaskStatus status; // slot 1 [200..207]
    }

    mapping(bytes32 => Task) public tasks;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TaskLocked(
        bytes32 indexed taskId,
        address indexed client,
        address indexed worker,
        uint256 amount,
        uint256 deadline
    );

    event TaskReleased(
        bytes32 indexed taskId,
        address indexed worker,
        uint256 amount,
        uint256 fee
    );

    event TaskRefunded(
        bytes32 indexed taskId,
        address indexed client,
        uint256 amount
    );

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        require(msg.sender == oracle, "TaskEscrowV2: caller is not oracle");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdc    USDC token contract address
    /// @param _oracle  Address authorized to call release/refund
    constructor(address _usdc, address _oracle) Ownable(msg.sender) {
        require(_usdc != address(0), "TaskEscrowV2: zero USDC address");
        require(_oracle != address(0), "TaskEscrowV2: zero oracle address");
        USDC = IERC20(_usdc);
        oracle = _oracle;
    }

    // ─── Core: Lock ───────────────────────────────────────────────────────────

    /// @notice Lock USDC in escrow for a task.
    ///         Caller must have approved this contract to spend `amount` USDC.
    /// @param taskId    Unique identifier for the off-chain task
    /// @param worker    Address that will receive USDC upon release
    /// @param amount    USDC amount in token decimals (6 for USDC)
    /// @param deadline  Unix timestamp after which the task is considered expired
    function lock(
        bytes32 taskId,
        address worker,
        uint256 amount,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "TaskEscrowV2: amount must be > 0");
        require(amount <= type(uint96).max, "TaskEscrowV2: amount overflow");
        require(deadline > block.timestamp, "TaskEscrowV2: deadline in the past");
        require(deadline <= type(uint40).max, "TaskEscrowV2: deadline overflow");
        require(tasks[taskId].status == TaskStatus.None, "TaskEscrowV2: taskId already exists");
        require(worker != address(0), "TaskEscrowV2: zero worker address");

        // Pull USDC from caller — caller must have approved this contract
        USDC.safeTransferFrom(msg.sender, address(this), amount);

        tasks[taskId] = Task({
            client:   msg.sender,
            amount:   uint96(amount),
            worker:   worker,
            deadline: uint40(deadline),
            status:   TaskStatus.Locked
        });

        emit TaskLocked(taskId, msg.sender, worker, amount, deadline);
    }

    // ─── Core: Release ────────────────────────────────────────────────────────

    /// @notice Oracle releases escrowed USDC to worker (minus 1% fee).
    ///         Fee is accumulated in `collectedFees` and withdrawn by owner.
    /// @param taskId  The task to release
    function release(bytes32 taskId) external onlyOracle nonReentrant {
        Task storage t = tasks[taskId];
        require(t.status == TaskStatus.Locked, "TaskEscrowV2: task not locked");

        uint256 amount = uint256(t.amount);
        address worker = t.worker;

        // Checks-Effects-Interactions: update state before external calls
        uint256 fee    = (amount * FEE_BPS) / 10_000;
        uint256 payout = amount - fee;

        t.status = TaskStatus.Released;
        collectedFees += fee;

        USDC.safeTransfer(worker, payout);

        emit TaskReleased(taskId, worker, payout, fee);
    }

    // ─── Core: Refund ─────────────────────────────────────────────────────────

    /// @notice Oracle refunds full USDC amount to client (no fee on refund).
    /// @param taskId  The task to refund
    function refund(bytes32 taskId) external onlyOracle nonReentrant {
        Task storage t = tasks[taskId];
        require(t.status == TaskStatus.Locked, "TaskEscrowV2: task not locked");

        uint256 amount = uint256(t.amount);
        address client = t.client;

        // Checks-Effects-Interactions
        t.status = TaskStatus.Refunded;

        USDC.safeTransfer(client, amount);

        emit TaskRefunded(taskId, client, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Update the oracle address.
    /// @param newOracle  New oracle address
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "TaskEscrowV2: zero oracle address");
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    /// @notice Withdraw accumulated protocol fees to `to`.
    /// @param to  Recipient of the fees
    function withdrawFees(address to) external onlyOwner {
        require(to != address(0), "TaskEscrowV2: zero recipient");
        uint256 amount = collectedFees;
        require(amount > 0, "TaskEscrowV2: no fees to withdraw");
        collectedFees = 0;
        USDC.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    /// @notice Pause the contract — lock() will revert, release/refund still work.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice Returns full task details.
    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }
}
