// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IAgentID} from "./IAgentID.sol";

interface IZYLBurnable {
    function burn(uint256 amount) external;
}

interface ISparkSlashHook {
    function onAgentSlashed(address agent) external;
}

/// @title  AgentID — Phase 4 agent identity NFT with bonded ZYL and slashing.
/// @notice Soulbound while bonded. 48-hour slash dispute window. 100% of
///         slashed amount is burned (no insurance pool — Vector 6.10).
contract AgentID is ERC721, IAgentID, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant SLASH_DISPUTE_WINDOW = 48 hours;
    uint16  public constant GENESIS_REPUTATION = 3000; // Vector 5.4

    IERC20 public immutable ZYL;
    IZYLBurnable public immutable ZYL_BURN;
    ISparkSlashHook public sparkStaking;

    /// @notice Slash oracle — separate key from settle oracle (Vector 1.4).
    ///         Production: 2-of-3 multisig.
    address public slashOracle;

    mapping(uint256 => AgentBond) public bonds;
    uint256 public nextTokenId;

    event AgentMinted(uint256 indexed tokenId, address indexed owner);
    event SlashOracleUpdated(address indexed oracle);
    event SparkStakingUpdated(address indexed staking);

    error NotSlashOracle();
    error NotOwner();
    error AlreadyBonded();
    error NoSlashPending();
    error InDisputeWindow();
    error PendingSlashBlocksTransfer();
    error PendingSlashBlocksUnbond();
    error ZeroAddress();
    error InsufficientBond();

    modifier onlySlashOracle() {
        if (msg.sender != slashOracle) revert NotSlashOracle();
        _;
    }

    constructor(address _zyl, address _slashOracle, address _initialOwner)
        ERC721("Zylogen Agent", "ZAGENT")
        Ownable(_initialOwner)
    {
        if (_zyl == address(0) || _slashOracle == address(0) || _initialOwner == address(0)) revert ZeroAddress();
        ZYL = IERC20(_zyl);
        ZYL_BURN = IZYLBurnable(_zyl);
        slashOracle = _slashOracle;
    }

    function setSlashOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        slashOracle = _oracle;
        emit SlashOracleUpdated(_oracle);
    }

    function setSparkStaking(address _spark) external onlyOwner {
        if (_spark == address(0)) revert ZeroAddress();
        sparkStaking = ISparkSlashHook(_spark);
        emit SparkStakingUpdated(_spark);
    }

    // ─── Mint + bond ──────────────────────────────────────────────────────────

    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = ++nextTokenId;
        _safeMint(to, tokenId);
        bonds[tokenId].reputationScore = GENESIS_REPUTATION;
        emit AgentMinted(tokenId, to);
    }

    function bond(uint256 tokenId, uint256 amount) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        ZYL.safeTransferFrom(msg.sender, address(this), amount);
        bonds[tokenId].bondedZYL += amount;
        if (bonds[tokenId].bondedAt == 0) {
            bonds[tokenId].bondedAt = uint64(block.timestamp);
        }
        emit AgentBonded(tokenId, msg.sender, amount);
    }

    function unbond(uint256 tokenId, uint256 amount) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (bonds[tokenId].pendingSlashAt != 0) revert PendingSlashBlocksUnbond();
        if (bonds[tokenId].bondedZYL < amount) revert InsufficientBond();
        bonds[tokenId].bondedZYL -= amount;
        ZYL.safeTransfer(msg.sender, amount);
        emit AgentUnbonded(tokenId, amount);
    }

    // ─── Slash ────────────────────────────────────────────────────────────────

    /// @notice Begin a slash. Snapshots current owner (Vector 1.6) and freezes
    ///         transfers + unbonds.
    function initiateSlash(uint256 tokenId, uint256 amount, bytes32 evidenceHash)
        external
        onlySlashOracle
    {
        AgentBond storage b = bonds[tokenId];
        if (b.bondedZYL < amount) revert InsufficientBond();
        b.pendingSlashAt = uint64(block.timestamp);
        b.pendingSlashAmount = uint128(amount);
        b.pendingSlashOwnerSnapshot = ownerOf(tokenId);
        emit SlashInitiated(tokenId, amount, evidenceHash);
    }

    /// @notice Cancel a pending slash (e.g., dispute resolved in agent's favor).
    function cancelSlash(uint256 tokenId) external onlySlashOracle {
        AgentBond storage b = bonds[tokenId];
        if (b.pendingSlashAt == 0) revert NoSlashPending();
        b.pendingSlashAt = 0;
        b.pendingSlashAmount = 0;
        b.pendingSlashOwnerSnapshot = address(0);
        emit SlashCancelled(tokenId);
    }

    /// @notice After 48-hour dispute window, finalize: burn 100% of slashed
    ///         amount and notify SparkStaking to zero the agent's Spark.
    function finalizeSlash(uint256 tokenId) external nonReentrant {
        AgentBond storage b = bonds[tokenId];
        if (b.pendingSlashAt == 0) revert NoSlashPending();
        if (block.timestamp < uint256(b.pendingSlashAt) + SLASH_DISPUTE_WINDOW) revert InDisputeWindow();

        uint256 amt = b.pendingSlashAmount;
        address victim = b.pendingSlashOwnerSnapshot;

        b.bondedZYL -= amt;
        b.pendingSlashAt = 0;
        b.pendingSlashAmount = 0;
        b.pendingSlashOwnerSnapshot = address(0);

        // 100% burn (Vector 6.10).
        ZYL_BURN.burn(amt);

        // Vector 5.3 — notify SparkStaking so all Spark delegated to this agent
        // is invalidated. SparkStaking exposes `agentSpark[address]` keyed by
        // the agent's Ethereum address; for that linkage in production the
        // agent address used in TaskEscrowV2 == the AgentID owner snapshot.
        if (address(sparkStaking) != address(0)) {
            sparkStaking.onAgentSlashed(victim);
        }

        emit SlashFinalized(tokenId, victim, amt);
    }

    // ─── Transfer guard (Vector 1.6 + soulbound while bonded) ─────────────────

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow mint (from == 0) and burn (to == 0) freely.
        if (from != address(0) && to != address(0)) {
            if (bonds[tokenId].pendingSlashAt != 0) revert PendingSlashBlocksTransfer();
            if (bonds[tokenId].bondedZYL > 0) revert PendingSlashBlocksTransfer(); // soulbound while bonded
        }
        return super._update(to, tokenId, auth);
    }

    // ─── IAgentID views ───────────────────────────────────────────────────────

    function reputationOf(uint256 tokenId) external view override returns (uint16) {
        return bonds[tokenId].reputationScore;
    }

    function ownerOf(uint256 tokenId) public view override(ERC721, IAgentID) returns (address) {
        return super.ownerOf(tokenId);
    }

    function hasPendingSlash(uint256 tokenId) external view override returns (bool) {
        return bonds[tokenId].pendingSlashAt != 0;
    }

    function bondedAmount(uint256 tokenId) external view override returns (uint256) {
        return bonds[tokenId].bondedZYL;
    }
}
