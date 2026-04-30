// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title  IAgentID — Interface for agent identity NFTs (Phase 4)
/// @notice Full implementation deferred to Phase 4; this interface freezes the
///         coupling surface between AgentID, SparkStaking, and TaskEscrowV2.
/// @dev    Phase 4 contract MUST conform to this interface so SparkStaking and
///         the slashing oracle can call it without modification.
interface IAgentID {
    struct AgentBond {
        uint256 bondedZYL;
        uint64  bondedAt;
        uint16  reputationScore;
        uint64  pendingSlashAt;             // 0 if no pending slash
        uint128 pendingSlashAmount;
        address pendingSlashOwnerSnapshot;  // owner at slash initiation (Vector 1.6)
    }

    event AgentBonded(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event AgentUnbonded(uint256 indexed tokenId, uint256 amount);
    event SlashInitiated(uint256 indexed tokenId, uint256 amount, bytes32 evidenceHash);
    event SlashFinalized(uint256 indexed tokenId, address indexed victim, uint256 amount);
    event SlashCancelled(uint256 indexed tokenId);

    /// @notice Current reputation in [0, 10000]. Maps to fee tier in TaskEscrowV2.
    function reputationOf(uint256 tokenId) external view returns (uint16);

    /// @notice Token owner at THIS block (not snapshot).
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice True if the agent has a pending slash. Used by transfer guards.
    function hasPendingSlash(uint256 tokenId) external view returns (bool);

    /// @notice Total bonded ZYL for an agent.
    function bondedAmount(uint256 tokenId) external view returns (uint256);

    /// @notice Begin a slash. 48-hour dispute window before finalize.
    ///         Snapshots current owner (Vector 1.6).
    function initiateSlash(uint256 tokenId, uint256 amount, bytes32 evidenceHash) external;

    /// @notice Finalize after dispute window. Burns 100% of slashed amount and
    ///         calls SparkStaking.onAgentSlashed (Vector 5.3).
    function finalizeSlash(uint256 tokenId) external;
}
