// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title  TaskEscrowV2
/// @author Zylogen Protocol
/// @notice Multi-asset micro-escrow for Base L2.
///         Supports both native ETH and ERC-20 tokens (USDC, etc).
///         Sender locks funds for a provider keyed by bytes32 taskHash.
///         Only the oracle can release funds; after a 7-day timeout the
///         sender may reclaim. A configurable protocol fee goes to treasury.
contract TaskEscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Custom Errors ────────────────────────────────────────────────────────

    error TaskAlreadyExists(bytes32 taskHash);
    error TaskNotFound(bytes32 taskHash);
    error InvalidAmount();
    error InvalidToken();
    error NotOracle();
    error NotSender();
    error DeadlineNotReached();
    error TransferFailed();
    error ETHNotAccepted();

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @dev Packed into three 32-byte storage slots.
    ///
    ///   Slot 0 │ sender   (160 bits) │ amount   (96 bits)  │ = 256 bits
    ///   Slot 1 │ provider (160 bits) │ deadline (40 bits)  │ = 200 bits
    ///   Slot 2 │ token    (160 bits) │                     │ = 160 bits
    ///
    /// token == address(0)  ⟺  native ETH escrow
    /// amount == 0          ⟺  escrow is empty / settled
    struct Escrow {
        address sender;   // slot 0 [0..159]
        uint96  amount;   // slot 0 [160..255]
        address provider; // slot 1 [0..159]
        uint40  deadline; // slot 1 [160..199]
        address token;    // slot 2 [0..159]  — address(0) = ETH
    }

    mapping(bytes32 => Escrow) public escrows;

    // ─── Immutables ───────────────────────────────────────────────────────────

    address public immutable oracle;
    address public immutable treasury;

    /// @dev 5% fee (matches landing page): payout = amount - (amount * FEE_BPS / 10000)
    uint256 public constant FEE_BPS = 500; // 5% = 500 basis points

    /// @dev 7 days in seconds
    uint40 private constant TIMEOUT = 7 days;

    // ─── Allowed Tokens ───────────────────────────────────────────────────────

    /// @dev Whitelist of accepted ERC-20 tokens. address(0) = ETH always accepted.
    mapping(address => bool) public allowedTokens;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TaskCreated(
        bytes32 indexed taskHash,
        address indexed sender,
        address indexed provider,
        address token,
        uint96  amount,
        uint40  deadline
    );

    event TaskReleased(
        bytes32 indexed taskHash,
        address indexed provider,
        address token,
        uint96  providerAmount,
        uint96  fee
    );

    event TaskReclaimed(
        bytes32 indexed taskHash,
        address indexed sender,
        address token,
        uint96  amount
    );

    event TokenAllowed(address indexed token, bool allowed);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _oracle   Address of the AI oracle signer
    /// @param _treasury Address receiving protocol fees
    /// @param _usdc     USDC contract address on Base Mainnet
    constructor(address _oracle, address _treasury, address _usdc) {
        oracle   = _oracle;
        treasury = _treasury;

        // USDC whitelisted by default
        allowedTokens[_usdc] = true;
        emit TokenAllowed(_usdc, true);
    }

    // ─── Core: Create Task (ETH) ──────────────────────────────────────────────

    /// @notice Lock native ETH in escrow for a task
    /// @param taskHash  Unique identifier for the task
    /// @param provider  Address of the worker/agent
    function createTaskETH(
        bytes32 taskHash,
        address provider
    ) external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        if (escrows[taskHash].amount != 0) revert TaskAlreadyExists(taskHash);

        uint96 amount = uint96(msg.value);
        uint40 deadline = uint40(block.timestamp) + TIMEOUT;

        escrows[taskHash] = Escrow({
            sender:   msg.sender,
            amount:   amount,
            provider: provider,
            deadline: deadline,
            token:    address(0) // ETH
        });

        emit TaskCreated(taskHash, msg.sender, provider, address(0), amount, deadline);
    }

    // ─── Core: Create Task (ERC-20 / USDC) ────────────────────────────────────

    /// @notice Lock ERC-20 tokens (USDC) in escrow for a task
    /// @param taskHash  Unique identifier for the task
    /// @param provider  Address of the worker/agent
    /// @param token     ERC-20 token contract address
    /// @param amount    Amount of tokens to lock (use token decimals, e.g. 6 for USDC)
    function createTaskToken(
        bytes32 taskHash,
        address provider,
        address token,
        uint96  amount
    ) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (!allowedTokens[token]) revert InvalidToken();
        if (escrows[taskHash].amount != 0) revert TaskAlreadyExists(taskHash);

        // Transfer tokens from sender to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint40 deadline = uint40(block.timestamp) + TIMEOUT;

        escrows[taskHash] = Escrow({
            sender:   msg.sender,
            amount:   amount,
            provider: provider,
            deadline: deadline,
            token:    token
        });

        emit TaskCreated(taskHash, msg.sender, provider, token, amount, deadline);
    }

    // ─── Core: Release ────────────────────────────────────────────────────────

    /// @notice Oracle releases escrowed funds to provider (minus fee)
    /// @param taskHash  The task to release
    function release(bytes32 taskHash) external onlyOracle nonReentrant {
        Escrow memory e = escrows[taskHash];
        if (e.amount == 0) revert TaskNotFound(taskHash);

        // Clear escrow before transfers (CEI pattern)
        delete escrows[taskHash];

        uint96 fee = uint96(uint256(e.amount) * FEE_BPS / 10_000);
        uint96 payout = e.amount - fee;

        if (e.token == address(0)) {
            // ETH transfers
            _sendETH(e.provider, payout);
            if (fee > 0) _sendETH(treasury, fee);
        } else {
            // ERC-20 transfers
            IERC20(e.token).safeTransfer(e.provider, payout);
            if (fee > 0) IERC20(e.token).safeTransfer(treasury, fee);
        }

        emit TaskReleased(taskHash, e.provider, e.token, payout, fee);
    }

    // ─── Core: Reclaim ────────────────────────────────────────────────────────

    /// @notice Sender reclaims funds after 7-day timeout
    /// @param taskHash  The task to reclaim
    function reclaim(bytes32 taskHash) external nonReentrant {
        Escrow memory e = escrows[taskHash];
        if (e.amount == 0) revert TaskNotFound(taskHash);
        if (msg.sender != e.sender) revert NotSender();
        if (block.timestamp < e.deadline) revert DeadlineNotReached();

        // Clear escrow before transfer
        delete escrows[taskHash];

        if (e.token == address(0)) {
            _sendETH(e.sender, e.amount);
        } else {
            IERC20(e.token).safeTransfer(e.sender, e.amount);
        }

        emit TaskReclaimed(taskHash, e.sender, e.token, e.amount);
    }

    // ─── Admin: Token Whitelist ───────────────────────────────────────────────

    /// @notice Oracle can add/remove allowed ERC-20 tokens
    /// @param token   The token address to allow/disallow
    /// @param allowed Whether to allow this token
    function setAllowedToken(address token, bool allowed) external onlyOracle {
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    // ─── View: Get Escrow Details ─────────────────────────────────────────────

    /// @notice Returns full escrow details for a task
    function getEscrow(bytes32 taskHash) external view returns (
        address sender,
        uint96  amount,
        address provider,
        uint40  deadline,
        address token
    ) {
        Escrow memory e = escrows[taskHash];
        return (e.sender, e.amount, e.provider, e.deadline, e.token);
    }

    /// @notice Check if an escrow exists and is active
    function isActive(bytes32 taskHash) external view returns (bool) {
        return escrows[taskHash].amount > 0;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _sendETH(address to, uint256 value) internal {
        (bool ok, ) = to.call{value: value}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Reject direct ETH sends (must use createTaskETH)
    receive() external payable {
        revert ETHNotAccepted();
    }
}
