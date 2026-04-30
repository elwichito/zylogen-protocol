// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

// ZYL Genesis Pass 2 — Foundry mirror of the named vector tests.
//
// Setup:
//   1. forge install foundry-rs/forge-std
//   2. Add to remappings.txt:
//        forge-std/=lib/forge-std/src/
//        @openzeppelin/=node_modules/@openzeppelin/
//   3. forge test --match-contract ZylGenesisVectors -vv
//
// The Hardhat suite at test/zyl/ZylGenesis.test.js is the runnable equivalent
// kept in lock-step with this file. Both suites cover every Pass 1 vector
// listed in spec §V/§XIII.

import "forge-std/Test.sol";

import {ZYL} from "contracts/zyl/ZYL.sol";
import {TaskEscrowV2} from "contracts/zyl/TaskEscrowV2.sol";
import {SparkStaking} from "contracts/zyl/SparkStaking.sol";
import {AgentID} from "contracts/zyl/AgentID.sol";
import {ZylogenDeployer} from "contracts/zyl/ZylogenDeployer.sol";
import {MockERC20} from "contracts/MockERC20.sol";

contract ZylGenesisVectors is Test {
    ZYL zyl;
    TaskEscrowV2 escrow;
    SparkStaking spark;
    MockERC20 usdc;
    ZylogenDeployer factory;

    address multisig    = makeAddr("multisig");
    address oracle      = makeAddr("oracle");
    address repOracle   = makeAddr("repOracle");
    address slashOracle = makeAddr("slashOracle");
    address lpReserve   = makeAddr("lp");
    address grants      = makeAddr("grants");
    address pool        = makeAddr("pool");
    address alice       = makeAddr("alice");
    address bob         = makeAddr("bob");
    address carol       = makeAddr("carol"); // used as agent in tests

    uint256 constant ZYL_RATE = 100; // 1 USDC base unit = 100 ZYL wei

    function setUp() public {
        // Atomic factory deploy.
        factory = new ZylogenDeployer();
        address[] memory team = new address[](1);
        team[0] = alice;
        uint128[] memory amts = new uint128[](1);
        amts[0] = uint128(150_000_000 ether);

        ZylogenDeployer.DeployParams memory p = ZylogenDeployer.DeployParams({
            multisig: multisig,
            stakingPool: pool,
            lpReserve: lpReserve,
            grantsMultisig: grants,
            teamBeneficiaries: team,
            teamAmounts: amts,
            vestStart: uint64(block.timestamp)
        });
        factory.deploy(p);
        zyl = ZYL(factory.deployedZYL());

        usdc = new MockERC20("USDC", "USDC", 6);
        usdc.mint(alice, 10_000 * 1e6);
        usdc.mint(bob, 10_000 * 1e6);

        escrow = new TaskEscrowV2(address(zyl), multisig, oracle, multisig);
        spark = new SparkStaking(address(zyl), multisig);

        vm.startPrank(multisig);
        zyl.setBurnWhitelist(address(escrow), true);
        escrow.setSparkStaking(address(spark));
        escrow.setRepOracle(repOracle);
        escrow.setZylRatePerToken(address(usdc), ZYL_RATE);
        spark.setRewardDistributor(address(escrow), true);
        zyl.transfer(address(escrow), 10_000_000 ether);
        zyl.transfer(alice, 50_000 ether);
        zyl.transfer(bob, 50_000 ether);
        zyl.transfer(carol, 50_000 ether);
        vm.stopPrank();
    }

    // ─── Vector tests (every one named per spec) ──────────────────────────────

    function test_Vector_1_1_burnFrom_reverts() public {
        vm.prank(alice);
        zyl.approve(bob, 1 ether);
        vm.expectRevert(ZYL.BurnFromDisabled.selector);
        vm.prank(bob);
        zyl.burnFrom(alice, 1 ether);

        vm.expectRevert(ZYL.NotWhitelisted.selector);
        vm.prank(alice);
        zyl.burn(1 ether);
    }

    function test_Vector_1_2_no_eoa_ownership_window() public view {
        assertEq(zyl.owner(), multisig);
        assertEq(zyl.balanceOf(address(factory)), 0);
    }

    function test_Vector_1_3_fee_table_all_tiers() public view {
        uint16[11] memory expected = [uint16(200),175,150,130,110,95,80,70,60,55,50];
        for (uint256 i = 0; i <= 10; i++) {
            uint16 lo = uint16(i * 1000);
            uint16 hi = i == 10 ? 65535 : uint16(i * 1000 + 999);
            assertEq(escrow.getFeeBps(lo), expected[i]);
            assertEq(escrow.getFeeBps(hi), expected[i]);
        }
        (uint16 b, uint16 t, uint16 s) = escrow.decomposeFee(200);
        assertEq(b, 50); assertEq(t, 50); assertEq(s, 100);
        (b, t, s) = escrow.decomposeFee(50);
        assertEq(b, 50); assertEq(t, 0); assertEq(s, 0);
    }

    function test_Vector_1_4_separate_oracle_keys() public {
        assertTrue(escrow.oracle() != escrow.repOracle());
        vm.expectRevert(TaskEscrowV2.NotRepOracle.selector);
        vm.prank(oracle);
        escrow.setAgentReputation(carol, 4000);
    }

    function test_Vector_1_5_burn_decreases_totalSupply() public {
        uint256 before = zyl.totalSupply();
        _lock(bytes32("t1"), 100 * 1e6, carol);
        vm.prank(oracle);
        escrow.settle(bytes32("t1"));
        assertLt(zyl.totalSupply(), before);
        assertEq(before - zyl.totalSupply(), 50_000_000); // 0.5% × 100 USDC × 100 rate
    }

    function test_Vector_1_6_slash_owner_snapshot_persists() public {
        AgentID a = new AgentID(address(zyl), slashOracle, multisig);
        vm.prank(multisig);
        zyl.setBurnWhitelist(address(a), true);
        vm.prank(multisig);
        a.mint(alice);
        vm.prank(alice);
        zyl.approve(address(a), 1000 ether);
        vm.prank(alice);
        a.bond(1, 1000 ether);

        vm.prank(slashOracle);
        a.initiateSlash(1, 500 ether, bytes32("evidence"));
        (, , , , , address snapshot) = a.bonds(1);
        assertEq(snapshot, alice);

        // Transfer blocked.
        vm.expectRevert(AgentID.PendingSlashBlocksTransfer.selector);
        vm.prank(alice);
        a.transferFrom(alice, bob, 1);
    }

    function test_Vector_2_1_no_release_function() public view {
        assertFalse(escrow.hasReleaseFunction());
    }

    function test_Vector_2_2_timeout_burns_at_floor() public {
        _lock(bytes32("tout"), 100 * 1e6, carol);
        uint256 before = zyl.totalSupply();
        vm.warp(block.timestamp + 30 days + 1);
        escrow.timeout(bytes32("tout"));
        assertEq(before - zyl.totalSupply(), 50_000_000);
    }

    function test_Vector_2_3_fee_crystallized_at_lock() public {
        _lock(bytes32("crys"), 1000 * 1e6, carol);
        ( , , , , , , , , , , , uint16 feeBps, , , ) = escrow.escrows(bytes32("crys"));
        assertEq(feeBps, 130); // bootstrap rep 3000 → tier 3 → 130 bps

        // Move rep up; fee on already-locked escrow does not change.
        vm.warp(block.timestamp + 6 hours + 1);
        vm.prank(repOracle);
        escrow.setAgentReputation(carol, 3200);
        ( , , , , , , , , , , , uint16 feeBpsAfter, , , ) = escrow.escrows(bytes32("crys"));
        assertEq(feeBpsAfter, 130);
    }

    function test_Vector_2_6_min_escrow_enforced() public {
        vm.prank(alice);
        usdc.approve(address(escrow), 999_999);
        vm.expectRevert(TaskEscrowV2.AmountTooSmall.selector);
        vm.prank(alice);
        escrow.lock(
            bytes32("dust"), alice, bob, carol,
            address(usdc), 999_999, bytes32(0)
        );
    }

    function test_Vector_2_7_sponsor_snapshot_at_lock() public {
        // Cooldown-mitigated front-run: late delegators don't earn.
        vm.prank(alice);
        zyl.approve(address(spark), 2000 ether);
        vm.prank(alice);
        spark.stake(2000 ether);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        spark.delegate(carol, 2000 ether);
        vm.warp(block.timestamp + 24 hours + 1);

        _lock(bytes32("fr"), 1000 * 1e6, carol);

        vm.prank(bob);
        zyl.approve(address(spark), 2000 ether);
        vm.prank(bob);
        spark.stake(2000 ether);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(bob);
        spark.delegate(carol, 2000 ether);

        vm.prank(oracle);
        escrow.settle(bytes32("fr"));
        assertEq(spark.pendingRewards(bob, carol), 0);
        assertGt(spark.pendingRewards(alice, carol), 0);
    }

    function test_Vector_3_2_no_iteration_in_settle() public {
        // Pull-over-push: settle gas is independent of sponsor count.
        _lock(bytes32("g0"), 100 * 1e6, carol);
        uint256 g0Before = gasleft();
        vm.prank(oracle);
        escrow.settle(bytes32("g0"));
        uint256 g0Used = g0Before - gasleft();

        vm.prank(alice);
        zyl.approve(address(spark), 2000 ether);
        vm.prank(alice);
        spark.stake(2000 ether);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        spark.delegate(carol, 2000 ether);
        vm.warp(block.timestamp + 24 hours + 1);

        _lock(bytes32("g1"), 100 * 1e6, carol);
        uint256 g1Before = gasleft();
        vm.prank(oracle);
        escrow.settle(bytes32("g1"));
        uint256 g1Used = g1Before - gasleft();

        // Delta bounded: sponsors don't add per-sponsor work.
        uint256 delta = g1Used > g0Used ? g1Used - g0Used : g0Used - g1Used;
        assertLt(delta, 100_000);
    }

    function test_Vector_3_3_incremental_stake_separate_activation() public {
        vm.prank(alice);
        zyl.approve(address(spark), 4000 ether);
        vm.prank(alice);
        spark.stake(2000 ether);
        vm.warp(block.timestamp + 20 hours);
        vm.prank(alice);
        spark.stake(2000 ether);

        // 5h further: only first activated.
        vm.warp(block.timestamp + 5 hours);
        assertEq(spark.activeSpark(alice), 2000 ether);
        // 24h further: both.
        vm.warp(block.timestamp + 24 hours);
        assertEq(spark.activeSpark(alice), 4000 ether);
    }

    function test_Vector_3_4_unstake_immediate_deactivation() public {
        vm.prank(alice);
        zyl.approve(address(spark), 2000 ether);
        vm.prank(alice);
        spark.stake(2000 ether);
        vm.warp(block.timestamp + 24 hours + 1);
        assertEq(spark.activeSpark(alice), 2000 ether);

        vm.prank(alice);
        spark.unstake(0);
        assertEq(spark.activeSpark(alice), 0);

        vm.expectRevert(SparkStaking.CooldownActive.selector);
        vm.prank(alice);
        spark.withdraw(0);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        spark.withdraw(0);
    }

    function test_Vector_3_6_atomic_deployment() public {
        assertEq(zyl.balanceOf(address(factory)), 0);
        // 1B is fully distributed; verify allocation totals match expected.
        uint256 sum = zyl.balanceOf(multisig)
            + zyl.balanceOf(factory.deployedVesting())
            + zyl.balanceOf(pool)
            + zyl.balanceOf(lpReserve)
            + zyl.balanceOf(grants)
            + zyl.balanceOf(address(escrow))
            + zyl.balanceOf(alice)
            + zyl.balanceOf(bob)
            + zyl.balanceOf(carol);
        assertEq(sum, 1_000_000_000 ether);
    }

    function test_Vector_5_3_slash_zeros_agent_spark() public {
        AgentID a = new AgentID(address(zyl), slashOracle, multisig);
        vm.startPrank(multisig);
        zyl.setBurnWhitelist(address(a), true);
        a.setSparkStaking(address(spark));
        spark.setAgentID(address(a));
        a.mint(carol);
        vm.stopPrank();

        vm.prank(carol);
        zyl.approve(address(a), 1000 ether);
        vm.prank(carol);
        a.bond(1, 1000 ether);

        vm.prank(alice);
        zyl.approve(address(spark), 2000 ether);
        vm.prank(alice);
        spark.stake(2000 ether);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(alice);
        spark.delegate(carol, 2000 ether);

        assertEq(spark.agentSpark(carol), 2000 ether);

        vm.prank(slashOracle);
        a.initiateSlash(1, 1000 ether, bytes32("ev"));
        vm.warp(block.timestamp + 48 hours + 1);
        a.finalizeSlash(1);

        assertEq(spark.agentSpark(carol), 0);
        assertTrue(spark.agentSlashed(carol));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _lock(bytes32 tid, uint256 amount, address agent) internal {
        vm.prank(alice);
        usdc.approve(address(escrow), amount);
        vm.prank(alice);
        escrow.lock(tid, alice, bob, agent, address(usdc), amount, bytes32(0));
    }
}
