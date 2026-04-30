// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ZYL} from "./ZYL.sol";
import {TeamVesting} from "./TeamVesting.sol";

/// @title  ZylogenDeployer — atomic factory for ZYL Genesis (Vector 1.2 + 3.6)
/// @notice Single transaction:
///           1. Deploys ZYL with this contract as initial owner+holder
///           2. Deploys TeamVesting with team beneficiaries
///           3. Distributes:
///                Treasury     200M  → multisig
///                TeamVesting  150M  → vesting contract
///                StakingPool  400M  → SparkStaking pool address
///                LP Reserve   150M  → LP-seeding multisig
///                Grants       100M  → grants multisig
///           4. Transfers ZYL ownership to multisig
///         The factory holds the entire 1B for at most one transaction —
///         ZYL never resides in a bare EOA.
contract ZylogenDeployer {
    using SafeERC20 for IERC20;

    error MultisigOwnerMismatch();
    error AllocationMismatch();
    error AlreadyDeployed();

    struct DeployParams {
        address multisig;          // ZYL owner + treasury (200M)
        address stakingPool;       // SparkStaking rewards reserve (400M)
        address lpReserve;         // LP seeding wallet/contract (150M)
        address grantsMultisig;    // grants pool (100M)
        address[] teamBeneficiaries;
        uint128[] teamAmounts;     // sum must equal 150M
        uint64  vestStart;
    }

    event Deployed(
        address indexed zyl,
        address indexed teamVesting,
        address indexed multisig
    );

    address public deployedZYL;
    address public deployedVesting;

    function deploy(DeployParams calldata p) external returns (address zyl, address vesting) {
        if (deployedZYL != address(0)) revert AlreadyDeployed();
        if (p.multisig == address(0) || p.stakingPool == address(0) || p.lpReserve == address(0) || p.grantsMultisig == address(0)) {
            revert AllocationMismatch();
        }

        // 1) Deploy ZYL with this contract as initial owner & supply recipient.
        ZYL token = new ZYL(address(this), address(this));
        zyl = address(token);

        // 2) Deploy TeamVesting (it must hold its allocation).
        TeamVesting tv = new TeamVesting(zyl, p.teamBeneficiaries, p.teamAmounts, p.vestStart);
        vesting = address(tv);

        // Sanity: team amounts sum to exactly 150M.
        uint256 teamSum;
        for (uint256 i; i < p.teamAmounts.length; ++i) {
            teamSum += p.teamAmounts[i];
        }
        if (teamSum != 150_000_000 ether) revert AllocationMismatch();

        IERC20 t = IERC20(zyl);

        // 3) Distribute (in same tx; ZYL never reaches a bare EOA pre-distribution).
        t.safeTransfer(p.multisig,        200_000_000 ether);
        t.safeTransfer(vesting,           150_000_000 ether);
        t.safeTransfer(p.stakingPool,     400_000_000 ether);
        t.safeTransfer(p.lpReserve,       150_000_000 ether);
        t.safeTransfer(p.grantsMultisig,  100_000_000 ether);

        // Verify zero residual.
        if (t.balanceOf(address(this)) != 0) revert AllocationMismatch();

        // 4) Transfer ownership to multisig.
        token.transferOwnership(p.multisig);
        if (token.owner() != p.multisig) revert MultisigOwnerMismatch();

        deployedZYL = zyl;
        deployedVesting = vesting;
        emit Deployed(zyl, vesting, p.multisig);
    }
}
