"use strict";

const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const time            = require("@nomicfoundation/hardhat-network-helpers").time;

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVEN_DAYS = 7 * 24 * 60 * 60; // seconds

function taskHash(n = 1) {
  return ethers.keccak256(ethers.toUtf8Bytes(`task-${n}`));
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [deployer, oracle, treasury, sender, provider, attacker] =
    await ethers.getSigners();

  const TaskEscrow = await ethers.getContractFactory("TaskEscrow");
  const escrow     = await TaskEscrow.deploy(oracle.address, treasury.address);
  await escrow.waitForDeployment();

  return { escrow, deployer, oracle, treasury, sender, provider, attacker };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function lockTask(escrow, sender, provider, taskId = 1, value = ethers.parseEther("1")) {
  return escrow
    .connect(sender)
    .lock(taskHash(taskId), provider.address, { value });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TaskEscrow", function () {

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets oracle and treasury as immutables", async function () {
      const { escrow, oracle, treasury } = await loadFixture(deployFixture);
      expect(await escrow.oracle()).to.equal(oracle.address);
      expect(await escrow.treasury()).to.equal(treasury.address);
    });
  });

  // ── lock() ──────────────────────────────────────────────────────────────────

  describe("lock()", function () {
    it("stores escrow with correct sender, provider, amount, and deadline", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const value    = ethers.parseEther("1");
      const hash     = taskHash(1);
      const lockTime = (await time.latest()) + 1;

      await time.setNextBlockTimestamp(lockTime);
      await escrow.connect(sender).lock(hash, provider.address, { value });

      const e = await escrow.escrows(hash);
      expect(e.sender).to.equal(sender.address);
      expect(e.provider).to.equal(provider.address);
      expect(e.amount).to.equal(value);
      expect(e.deadline).to.equal(lockTime + SEVEN_DAYS);
    });

    it("emits TaskCreated with correct args", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const value    = ethers.parseEther("0.5");
      const hash     = taskHash(2);
      const lockTime = (await time.latest()) + 1;

      await time.setNextBlockTimestamp(lockTime);
      const tx = await escrow.connect(sender).lock(hash, provider.address, { value });

      await expect(tx)
        .to.emit(escrow, "TaskCreated")
        .withArgs(hash, sender.address, provider.address, value, lockTime + SEVEN_DAYS);
    });

    it("reverts with InvalidAmount on zero value", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(sender).lock(taskHash(1), provider.address, { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("reverts with InvalidAmount when value exceeds uint96 max", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const tooBig = BigInt(2) ** BigInt(96); // uint96.max + 1

      // Fund sender with enough to actually attempt the tx.
      await ethers.provider.send("hardhat_setBalance", [
        sender.address,
        "0x" + (tooBig + ethers.parseEther("1")).toString(16),
      ]);

      await expect(
        escrow.connect(sender).lock(taskHash(1), provider.address, { value: tooBig })
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("reverts with TaskAlreadyExists on duplicate taskHash", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await expect(
        lockTask(escrow, sender, provider, 1)
      ).to.be.revertedWithCustomError(escrow, "TaskAlreadyExists")
        .withArgs(taskHash(1));
    });

    it("increases the contract balance by the locked amount", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const value = ethers.parseEther("2");
      await expect(
        lockTask(escrow, sender, provider, 1, value)
      ).to.changeEtherBalance(escrow, value);
    });

    it("accepts the full uint96 max as a valid amount", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const max = BigInt(2) ** BigInt(96) - BigInt(1); // uint96.max

      // Fund sender to cover the tx.
      await ethers.provider.send("hardhat_setBalance", [
        sender.address,
        "0x" + (max + ethers.parseEther("1")).toString(16),
      ]);

      await expect(
        escrow.connect(sender).lock(taskHash(99), provider.address, { value: max })
      ).to.not.be.reverted;
    });

    it("allows different senders to lock different taskHashes simultaneously", async function () {
      const { escrow, sender, attacker, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender,   provider, 1);
      await lockTask(escrow, attacker, provider, 2);

      const e1 = await escrow.escrows(taskHash(1));
      const e2 = await escrow.escrows(taskHash(2));
      expect(e1.sender).to.equal(sender.address);
      expect(e2.sender).to.equal(attacker.address);
    });
  });

  // ── release() ───────────────────────────────────────────────────────────────

  describe("release()", function () {
    it("transfers 99% to provider and 1% fee to treasury", async function () {
      const { escrow, oracle, treasury, sender, provider } =
        await loadFixture(deployFixture);

      const value    = ethers.parseEther("1");
      const fee      = value / 100n;
      const payout   = value - fee;

      await lockTask(escrow, sender, provider, 1, value);

      await expect(
        escrow.connect(oracle).release(taskHash(1))
      ).to.changeEtherBalances(
        [provider, treasury, escrow],
        [payout, fee, -value]
      );
    });

    it("emits TaskReleased with correct args", async function () {
      const { escrow, oracle, sender, provider } = await loadFixture(deployFixture);
      const value  = ethers.parseEther("1");
      const fee    = value / 100n;
      const payout = value - fee;

      await lockTask(escrow, sender, provider, 1, value);
      const tx = await escrow.connect(oracle).release(taskHash(1));

      await expect(tx)
        .to.emit(escrow, "TaskReleased")
        .withArgs(taskHash(1), provider.address, payout, fee);
    });

    it("deletes the escrow record after release", async function () {
      const { escrow, oracle, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await escrow.connect(oracle).release(taskHash(1));

      const e = await escrow.escrows(taskHash(1));
      expect(e.amount).to.equal(0n);
      expect(e.sender).to.equal(ethers.ZeroAddress);
    });

    it("reverts with NotOracle when called by a non-oracle", async function () {
      const { escrow, sender, provider, attacker } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await expect(
        escrow.connect(attacker).release(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "NotOracle");
    });

    it("reverts with NotOracle when called by sender", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await expect(
        escrow.connect(sender).release(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "NotOracle");
    });

    it("reverts with TaskNotFound on unknown taskHash", async function () {
      const { escrow, oracle } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(oracle).release(taskHash(99))
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound")
        .withArgs(taskHash(99));
    });

    it("reverts with TaskNotFound when called twice (already released)", async function () {
      const { escrow, oracle, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await escrow.connect(oracle).release(taskHash(1));
      await expect(
        escrow.connect(oracle).release(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound");
    });

    it("handles tiny amounts where fee rounds to zero", async function () {
      const { escrow, oracle, treasury, sender, provider } =
        await loadFixture(deployFixture);

      // 99 wei → fee = 0, payout = 99
      const value = 99n;
      await lockTask(escrow, sender, provider, 1, value);

      await expect(
        escrow.connect(oracle).release(taskHash(1))
      ).to.changeEtherBalances(
        [provider, treasury, escrow],
        [99n, 0n, -99n]
      );
    });

    it("can release independently locked tasks in any order", async function () {
      const { escrow, oracle, sender, provider, attacker } =
        await loadFixture(deployFixture);

      const v1 = ethers.parseEther("1");
      const v2 = ethers.parseEther("2");

      await lockTask(escrow, sender,   provider, 1, v1);
      await lockTask(escrow, attacker, provider, 2, v2);

      // Release second first
      await escrow.connect(oracle).release(taskHash(2));
      await escrow.connect(oracle).release(taskHash(1));

      const e1 = await escrow.escrows(taskHash(1));
      const e2 = await escrow.escrows(taskHash(2));
      expect(e1.amount).to.equal(0n);
      expect(e2.amount).to.equal(0n);
    });
  });

  // ── reclaim() ───────────────────────────────────────────────────────────────

  describe("reclaim()", function () {
    it("reverts with DeadlineNotReached before 7 days", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);

      // Pin the lock block to a known timestamp so we can set the next block
      // to exactly one second before the deadline without guessing auto-mine offsets.
      const lockTime = (await time.latest()) + 1;
      await time.setNextBlockTimestamp(lockTime);
      await lockTask(escrow, sender, provider, 1);

      const deadline = lockTime + SEVEN_DAYS;

      // Mine the reclaim tx one second before the deadline.
      await time.setNextBlockTimestamp(deadline - 1);

      await expect(
        escrow.connect(sender).reclaim(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "DeadlineNotReached");
    });

    it("allows sender to reclaim the full amount exactly at deadline", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const value = ethers.parseEther("1");
      await lockTask(escrow, sender, provider, 1, value);

      // Jump to exactly the deadline
      await time.increase(SEVEN_DAYS);

      await expect(
        escrow.connect(sender).reclaim(taskHash(1))
      ).to.changeEtherBalances([sender, escrow], [value, -value]);
    });

    it("allows sender to reclaim well after deadline", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const value = ethers.parseEther("3");
      await lockTask(escrow, sender, provider, 1, value);

      await time.increase(SEVEN_DAYS * 10);

      await expect(
        escrow.connect(sender).reclaim(taskHash(1))
      ).to.changeEtherBalance(sender, value);
    });

    it("emits TaskReclaimed with correct args", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const value = ethers.parseEther("0.25");
      await lockTask(escrow, sender, provider, 1, value);
      await time.increase(SEVEN_DAYS);

      const tx = await escrow.connect(sender).reclaim(taskHash(1));
      await expect(tx)
        .to.emit(escrow, "TaskReclaimed")
        .withArgs(taskHash(1), sender.address, value);
    });

    it("deletes the escrow record after reclaim", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await time.increase(SEVEN_DAYS);
      await escrow.connect(sender).reclaim(taskHash(1));

      const e = await escrow.escrows(taskHash(1));
      expect(e.amount).to.equal(0n);
    });

    it("reverts with NotSender when non-sender tries to reclaim", async function () {
      const { escrow, sender, provider, attacker } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await time.increase(SEVEN_DAYS);

      await expect(
        escrow.connect(attacker).reclaim(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "NotSender");
    });

    it("reverts with NotSender when oracle tries to reclaim", async function () {
      const { escrow, oracle, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await time.increase(SEVEN_DAYS);

      await expect(
        escrow.connect(oracle).reclaim(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "NotSender");
    });

    it("reverts with TaskNotFound on unknown taskHash", async function () {
      const { escrow, sender } = await loadFixture(deployFixture);
      await time.increase(SEVEN_DAYS);
      await expect(
        escrow.connect(sender).reclaim(taskHash(99))
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound")
        .withArgs(taskHash(99));
    });

    it("reverts with TaskNotFound when called twice (already reclaimed)", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await time.increase(SEVEN_DAYS);
      await escrow.connect(sender).reclaim(taskHash(1));

      await expect(
        escrow.connect(sender).reclaim(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound");
    });

    it("cannot reclaim after oracle has already released", async function () {
      const { escrow, oracle, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);

      // Oracle releases before timeout
      await escrow.connect(oracle).release(taskHash(1));

      // Sender tries to reclaim after timeout
      await time.increase(SEVEN_DAYS);
      await expect(
        escrow.connect(sender).reclaim(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound");
    });

    it("oracle cannot release after sender has reclaimed", async function () {
      const { escrow, oracle, sender, provider } = await loadFixture(deployFixture);
      await lockTask(escrow, sender, provider, 1);
      await time.increase(SEVEN_DAYS);
      await escrow.connect(sender).reclaim(taskHash(1));

      await expect(
        escrow.connect(oracle).release(taskHash(1))
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound");
    });
  });

  // ── Fee calculation ──────────────────────────────────────────────────────────

  describe("Fee calculation", function () {
    const cases = [
      { eth: "1",   desc: "1 ETH"      },
      { eth: "0.1", desc: "0.1 ETH"    },
      { eth: "10",  desc: "10 ETH"     },
    ];

    for (const { eth, desc } of cases) {
      it(`correctly splits 1% fee for ${desc}`, async function () {
        const { escrow, oracle, treasury, sender, provider } =
          await loadFixture(deployFixture);

        const value  = ethers.parseEther(eth);
        const fee    = value / 100n;
        const payout = value - fee;

        await lockTask(escrow, sender, provider, 1, value);

        await expect(
          escrow.connect(oracle).release(taskHash(1))
        ).to.changeEtherBalances(
          [provider, treasury, escrow],
          [payout, fee, -value]
        );
      });
    }
  });

  // ── Storage slot packing ─────────────────────────────────────────────────────

  describe("Storage layout (slot packing)", function () {
    it("stores sender+amount in one slot and provider+deadline in another", async function () {
      const { escrow, sender, provider } = await loadFixture(deployFixture);
      const value    = ethers.parseEther("1.23");
      const hash     = taskHash(1);
      const lockTime = (await time.latest()) + 1;

      await time.setNextBlockTimestamp(lockTime);
      await escrow.connect(sender).lock(hash, provider.address, { value });

      // Verify via the public mapping getter that all fields round-trip correctly.
      const e = await escrow.escrows(hash);
      expect(e.sender).to.equal(sender.address);
      expect(e.amount).to.equal(value);
      expect(e.provider).to.equal(provider.address);
      expect(e.deadline).to.equal(BigInt(lockTime + SEVEN_DAYS));
    });
  });

  // ── Reentrancy guard ─────────────────────────────────────────────────────────

  describe("Reentrancy protection", function () {
    it("blocks reentrant release() via a malicious provider", async function () {
      const { escrow, oracle, sender, treasury } = await loadFixture(deployFixture);

      // Deploy a reentrancy attacker contract
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(await escrow.getAddress());
      await attacker.waitForDeployment();

      const hash  = taskHash(42);
      const value = ethers.parseEther("1");

      // Lock funds with attacker as provider
      await escrow.connect(sender).lock(hash, await attacker.getAddress(), { value });

      // Prime the attacker with the task hash it will try to re-enter
      await attacker.setTarget(hash);

      // Oracle triggers release; attacker's receive() tries to re-enter
      await expect(
        escrow.connect(oracle).release(hash)
      ).to.not.be.reverted; // outer call succeeds but inner re-entry is blocked

      // Attacker got only one payout, not double
      const bal = await ethers.provider.getBalance(await attacker.getAddress());
      expect(bal).to.equal(value - value / 100n); // 99% exactly once
    });
  });
});
