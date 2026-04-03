// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test helper: acts as a malicious provider that attempts to re-enter
///      TaskEscrow.release() from its receive() hook.
///      The attacker silently swallows the revert so the outer call can still
///      succeed — this lets us verify that the reentrancy guard prevents
///      double-spending even when the attacker is non-reverting.
interface ITaskEscrow {
    function release(bytes32 taskHash) external;
}

contract ReentrancyAttacker {
    ITaskEscrow public immutable escrow;
    bytes32 public targetHash;

    constructor(address escrow_) {
        escrow = ITaskEscrow(escrow_);
    }

    function setTarget(bytes32 hash) external {
        targetHash = hash;
    }

    receive() external payable {
        // Attempt re-entry; swallow any revert so the outer transfer succeeds.
        // If reentrancy guard works, this call reverts silently and the attacker
        // receives only the legitimate single payout.
        try escrow.release(targetHash) {} catch {}
    }
}
