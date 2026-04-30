// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  TeamVesting — 4-year linear vest with 12-month cliff per beneficiary.
/// @notice Holds the team allocation (15% = 150M ZYL). Each beneficiary's
///         tokens vest linearly after a 12-month cliff. Read-only after
///         deployment except for `release()` and per-beneficiary refunds.
contract TeamVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant CLIFF = 365 days;
    uint64 public constant DURATION = 4 * 365 days;

    IERC20 public immutable ZYL;
    uint64 public immutable startTimestamp;

    struct Schedule {
        uint128 totalAmount;
        uint128 released;
    }
    mapping(address => Schedule) public schedules;

    event Released(address indexed beneficiary, uint256 amount);

    error ZeroAddress();
    error AlreadyConfigured();
    error NothingToRelease();
    error LengthMismatch();

    constructor(address zyl, address[] memory beneficiaries, uint128[] memory amounts, uint64 _start) {
        if (zyl == address(0)) revert ZeroAddress();
        if (beneficiaries.length != amounts.length) revert LengthMismatch();
        ZYL = IERC20(zyl);
        startTimestamp = _start;
        for (uint256 i; i < beneficiaries.length; ++i) {
            if (beneficiaries[i] == address(0)) revert ZeroAddress();
            if (schedules[beneficiaries[i]].totalAmount != 0) revert AlreadyConfigured();
            schedules[beneficiaries[i]] = Schedule({totalAmount: amounts[i], released: 0});
        }
    }

    function vested(address beneficiary, uint64 timestamp) public view returns (uint256) {
        Schedule memory s = schedules[beneficiary];
        if (s.totalAmount == 0) return 0;
        if (timestamp < startTimestamp + CLIFF) return 0;
        uint64 elapsed = timestamp - startTimestamp;
        if (elapsed >= DURATION) return s.totalAmount;
        return (uint256(s.totalAmount) * elapsed) / DURATION;
    }

    function releasable(address beneficiary) public view returns (uint256) {
        return vested(beneficiary, uint64(block.timestamp)) - schedules[beneficiary].released;
    }

    function release() external nonReentrant {
        uint256 amount = releasable(msg.sender);
        if (amount == 0) revert NothingToRelease();
        schedules[msg.sender].released += uint128(amount);
        ZYL.safeTransfer(msg.sender, amount);
        emit Released(msg.sender, amount);
    }
}
