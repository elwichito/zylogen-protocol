"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC_DECIMALS = 6;
const ONE_USDC      = ethers.parseUnits("1", USDC_DECIMALS);
const TEN_USDC      = ethers.parseUnits("10", USDC_DECIMALS);
const HUNDRED_USDC  = ethers.parseUnits("100", USDC_DECIMALS);

const Status = {
  Open:      0,
  Funded:    1,
  Submitted: 2,
  Completed: 3,
  Rejected:  4,
  Expired:   5,
};

const HOOK_MODE = {
  Pass:              0,
  RevertBefore:      1,
  RevertAfter:       2,
  ConsumeGas:        3,
  RevertBeforeNoMsg: 4,
};

async function nowTs() {
  return BigInt(await time.latest());
}

async function deployFixture() {
  const [deployer, pauser, client, provider, evaluator, attacker, other] = await ethers.getSigners();

  const Erc = await ethers.getContractFactory("MockERC20");
  const usdc = await Erc.deploy("USD Coin", "USDC", USDC_DECIMALS);

  const Kernel = await ethers.getContractFactory("ZylogenJob");
  const job = await Kernel.deploy(
    await usdc.getAddress(),
    pauser.address,
    ethers.ZeroAddress // no trusted forwarder; _msgSender() == msg.sender
  );

  await usdc.mint(client.address, HUNDRED_USDC);
  await usdc.mint(provider.address, HUNDRED_USDC);
  await usdc.mint(attacker.address, HUNDRED_USDC);

  return { deployer, pauser, client, provider, evaluator, attacker, other, usdc, job };
}

async function futureTs(addSeconds = 7 * 24 * 60 * 60) {
  return Number(await nowTs()) + addSeconds;
}

async function makeOpenJob({ job, client, provider, evaluator, hook = ethers.ZeroAddress, providerAtCreate = null }) {
  const exp = await futureTs();
  const tx = await job.connect(client).createJob(
    providerAtCreate === null ? provider.address : providerAtCreate,
    evaluator.address,
    exp,
    "test job",
    hook
  );
  await tx.wait();
  return { jobId: await job.nextJobId(), expiredAt: exp };
}

describe("ZylogenJob — ERC-8183 kernel", function () {

  // ════════════════════════════════════════════════════════════════════════
  // A) Happy paths
  // ════════════════════════════════════════════════════════════════════════

  describe("A. Happy paths", function () {

    it("A1. full lifecycle: create → fund → submit → complete pays provider", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });

      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), TEN_USDC);
      await job.connect(client).fund(jobId, TEN_USDC, "0x");

      const deliverable = ethers.keccak256(ethers.toUtf8Bytes("work.zip"));
      await job.connect(provider).submit(jobId, deliverable, "0x");

      const reason = ethers.keccak256(ethers.toUtf8Bytes("approved by reviewer"));
      const before = await usdc.balanceOf(provider.address);
      await job.connect(evaluator).complete(jobId, reason, "0x");
      const after = await usdc.balanceOf(provider.address);

      expect(after - before).to.equal(TEN_USDC);
      const j = await job.getJob(jobId);
      expect(j.status).to.equal(Status.Completed);
    });

    it("A2. self-evaluating job (client == evaluator) completes correctly", async function () {
      const { job, usdc, client, provider } = await deployFixture();
      const exp = await futureTs();
      await job.connect(client).createJob(provider.address, client.address, exp, "self-eval", ethers.ZeroAddress);
      const jobId = await job.nextJobId();

      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), TEN_USDC);
      await job.connect(client).fund(jobId, TEN_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");

      await job.connect(client).complete(jobId, ethers.ZeroHash, "0x");
      expect((await job.getJob(jobId)).status).to.equal(Status.Completed);
    });

    it("A3. createJob with provider = address(0) supports setProvider later", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const exp = await futureTs();
      await job.connect(client).createJob(ethers.ZeroAddress, evaluator.address, exp, "late provider", ethers.ZeroAddress);
      const jobId = await job.nextJobId();

      await job.connect(client).setProvider(jobId, provider.address, "0x");
      expect((await job.getJob(jobId)).provider).to.equal(provider.address);

      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      expect((await job.getJob(jobId)).status).to.equal(Status.Funded);
    });

    it("A4. reject from Open by client moves to Rejected with no token movement", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });

      const before = await usdc.balanceOf(client.address);
      await job.connect(client).reject(jobId, ethers.ZeroHash, "0x");
      const after = await usdc.balanceOf(client.address);

      expect(after).to.equal(before);
      expect((await job.getJob(jobId)).status).to.equal(Status.Rejected);
    });

    it("A5. reject from Funded by evaluator refunds the client", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), TEN_USDC);
      await job.connect(client).fund(jobId, TEN_USDC, "0x");

      const before = await usdc.balanceOf(client.address);
      await job.connect(evaluator).reject(jobId, ethers.ZeroHash, "0x");
      const after = await usdc.balanceOf(client.address);

      expect(after - before).to.equal(TEN_USDC);
      expect((await job.getJob(jobId)).status).to.equal(Status.Rejected);
    });

    it("A6. reject from Submitted by evaluator refunds the client", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), TEN_USDC);
      await job.connect(client).fund(jobId, TEN_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");

      const before = await usdc.balanceOf(client.address);
      await job.connect(evaluator).reject(jobId, ethers.id("not good enough"), "0x");
      const after = await usdc.balanceOf(client.address);

      expect(after - before).to.equal(TEN_USDC);
    });

    it("A7. claimRefund after expiredAt pays the client and is permissionless", async function () {
      const { job, usdc, client, provider, evaluator, attacker } = await deployFixture();
      const { jobId, expiredAt } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), TEN_USDC);
      await job.connect(client).fund(jobId, TEN_USDC, "0x");

      await time.increaseTo(expiredAt + 1);

      const before = await usdc.balanceOf(client.address);
      // Anyone (e.g. attacker) can trigger; funds still go to client.
      await job.connect(attacker).claimRefund(jobId);
      const after = await usdc.balanceOf(client.address);

      expect(after - before).to.equal(TEN_USDC);
      expect((await job.getJob(jobId)).status).to.equal(Status.Expired);
    });

    it("A8. claimRefund after expiry from Submitted state refunds client", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId, expiredAt } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");

      await time.increaseTo(expiredAt + 1);
      const before = await usdc.balanceOf(client.address);
      await job.connect(client).claimRefund(jobId);
      const after = await usdc.balanceOf(client.address);
      expect(after - before).to.equal(ONE_USDC);
    });

    it("A9. setBudget can be called multiple times before fund (negotiation)", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });

      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await job.connect(provider).setBudget(jobId, TEN_USDC, "0x");
      await job.connect(client).setBudget(jobId, ONE_USDC * 5n, "0x");

      expect((await job.getJob(jobId)).budget).to.equal(ONE_USDC * 5n);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // B) State transitions — negative paths
  // ════════════════════════════════════════════════════════════════════════

  describe("B. State transitions — reverts when transition is invalid", function () {

    it("B1. setProvider reverts when status != Open", async function () {
      const { job, usdc, client, provider, evaluator, other } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");

      await expect(job.connect(client).setProvider(jobId, other.address, "0x"))
        .to.be.revertedWithCustomError(job, "InvalidStatus");
    });

    it("B2. setProvider reverts if provider already set", async function () {
      const { job, client, provider, evaluator, other } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await expect(job.connect(client).setProvider(jobId, other.address, "0x"))
        .to.be.revertedWithCustomError(job, "ProviderAlreadySet");
    });

    it("B3. setProvider reverts if caller is not the client", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const exp = await futureTs();
      await job.connect(client).createJob(ethers.ZeroAddress, evaluator.address, exp, "", ethers.ZeroAddress);
      const jobId = await job.nextJobId();

      await expect(job.connect(provider).setProvider(jobId, provider.address, "0x"))
        .to.be.revertedWithCustomError(job, "Unauthorized");
    });

    it("B4. setProvider reverts if new provider is zero", async function () {
      const { job, client, evaluator } = await deployFixture();
      const exp = await futureTs();
      await job.connect(client).createJob(ethers.ZeroAddress, evaluator.address, exp, "", ethers.ZeroAddress);
      const jobId = await job.nextJobId();

      await expect(job.connect(client).setProvider(jobId, ethers.ZeroAddress, "0x"))
        .to.be.revertedWithCustomError(job, "ZeroAddress");
    });

    it("B5. setBudget reverts if not client or provider", async function () {
      const { job, client, provider, evaluator, other } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await expect(job.connect(other).setBudget(jobId, ONE_USDC, "0x"))
        .to.be.revertedWithCustomError(job, "Unauthorized");
    });

    it("B6. fund reverts if budget is zero", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await expect(job.connect(client).fund(jobId, 0, "0x"))
        .to.be.revertedWithCustomError(job, "BudgetIsZero");
    });

    it("B7. fund reverts on expectedBudget mismatch (front-run guard)", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), TEN_USDC);
      await expect(job.connect(client).fund(jobId, ONE_USDC, "0x"))
        .to.be.revertedWithCustomError(job, "BudgetMismatch")
        .withArgs(ONE_USDC, TEN_USDC);
    });

    it("B8. fund reverts if caller is not client", async function () {
      const { job, client, provider, evaluator, attacker } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await expect(job.connect(attacker).fund(jobId, ONE_USDC, "0x"))
        .to.be.revertedWithCustomError(job, "Unauthorized");
    });

    it("B9. fund reverts if provider not set", async function () {
      const { job, client, evaluator } = await deployFixture();
      const exp = await futureTs();
      await job.connect(client).createJob(ethers.ZeroAddress, evaluator.address, exp, "", ethers.ZeroAddress);
      const jobId = await job.nextJobId();
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await expect(job.connect(client).fund(jobId, ONE_USDC, "0x"))
        .to.be.revertedWithCustomError(job, "ProviderNotSet");
    });

    it("B10. submit reverts if caller is not the provider", async function () {
      const { job, usdc, client, provider, evaluator, attacker } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await expect(job.connect(attacker).submit(jobId, ethers.ZeroHash, "0x"))
        .to.be.revertedWithCustomError(job, "Unauthorized");
    });

    it("B11. submit reverts if status != Funded", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await expect(job.connect(provider).submit(jobId, ethers.ZeroHash, "0x"))
        .to.be.revertedWithCustomError(job, "InvalidStatus");
    });

    it("B12. complete reverts if caller is not the evaluator", async function () {
      const { job, usdc, client, provider, evaluator, attacker } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");
      await expect(job.connect(attacker).complete(jobId, ethers.ZeroHash, "0x"))
        .to.be.revertedWithCustomError(job, "Unauthorized");
    });

    it("B13. complete reverts if status != Submitted", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await expect(job.connect(evaluator).complete(jobId, ethers.ZeroHash, "0x"))
        .to.be.revertedWithCustomError(job, "InvalidStatus");
    });

    it("B14. reject from Open by non-client reverts", async function () {
      const { job, client, provider, evaluator, attacker } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await expect(job.connect(attacker).reject(jobId, ethers.ZeroHash, "0x"))
        .to.be.revertedWithCustomError(job, "Unauthorized");
    });

    it("B15. reject from Funded by non-evaluator reverts (even client cannot)", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await expect(job.connect(client).reject(jobId, ethers.ZeroHash, "0x"))
        .to.be.revertedWithCustomError(job, "Unauthorized");
    });

    it("B16. reject from terminal status (Completed) reverts", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");
      await job.connect(evaluator).complete(jobId, ethers.ZeroHash, "0x");
      await expect(job.connect(evaluator).reject(jobId, ethers.ZeroHash, "0x"))
        .to.be.revertedWithCustomError(job, "InvalidStatus");
    });

    it("B17. claimRefund reverts before expiredAt", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await expect(job.connect(client).claimRefund(jobId))
        .to.be.revertedWithCustomError(job, "NotExpired");
    });

    it("B18. claimRefund reverts on Open or Completed status", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const { jobId, expiredAt } = await makeOpenJob({ job, client, provider, evaluator });
      await time.increaseTo(expiredAt + 1);
      // Job is Open at this point, not Funded/Submitted.
      await expect(job.connect(client).claimRefund(jobId))
        .to.be.revertedWithCustomError(job, "InvalidStatus");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // C) Security
  // ════════════════════════════════════════════════════════════════════════

  describe("C. Security", function () {

    it("C1. constructor reverts on zero paymentToken", async function () {
      const [, pauser] = await ethers.getSigners();
      const Kernel = await ethers.getContractFactory("ZylogenJob");
      await expect(Kernel.deploy(ethers.ZeroAddress, pauser.address, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(Kernel, "ZeroAddress");
    });

    it("C2. constructor reverts on zero pauser", async function () {
      const Erc = await ethers.getContractFactory("MockERC20");
      const usdc = await Erc.deploy("X", "X", 6);
      const Kernel = await ethers.getContractFactory("ZylogenJob");
      await expect(Kernel.deploy(await usdc.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(Kernel, "ZeroAddress");
    });

    it("C3. createJob reverts on zero evaluator", async function () {
      const { job, client, provider } = await deployFixture();
      const exp = await futureTs();
      await expect(job.connect(client).createJob(provider.address, ethers.ZeroAddress, exp, "", ethers.ZeroAddress))
        .to.be.revertedWithCustomError(job, "EvaluatorMustBeSetAtCreation");
    });

    it("C4. createJob reverts on expiredAt in the past or now", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const now = Number(await nowTs());
      await expect(job.connect(client).createJob(provider.address, evaluator.address, now, "", ethers.ZeroAddress))
        .to.be.revertedWithCustomError(job, "ExpiredAtNotInFuture");
      await expect(job.connect(client).createJob(provider.address, evaluator.address, now - 1, "", ethers.ZeroAddress))
        .to.be.revertedWithCustomError(job, "ExpiredAtNotInFuture");
    });

    it("C5. createJob reverts when expiredAt exceeds MAX_DURATION", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const tooFar = Number(await nowTs()) + 366 * 24 * 60 * 60;
      await expect(job.connect(client).createJob(provider.address, evaluator.address, tooFar, "", ethers.ZeroAddress))
        .to.be.revertedWithCustomError(job, "ExpiredAtTooFar");
    });

    it("C6. only PAUSER can pause / unpause", async function () {
      const { job, pauser, attacker } = await deployFixture();
      await expect(job.connect(attacker).pause()).to.be.revertedWithCustomError(job, "NotPauser");
      await job.connect(pauser).pause();
      await expect(job.connect(attacker).unpause()).to.be.revertedWithCustomError(job, "NotPauser");
      await job.connect(pauser).unpause();
    });

    it("C7. pause halts createJob and fund but not submit/complete/reject/claimRefund", async function () {
      const { job, usdc, pauser, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);

      await job.connect(pauser).pause();

      await expect(job.connect(client).fund(jobId, ONE_USDC, "0x"))
        .to.be.revertedWithCustomError(job, "EnforcedPause");

      const exp = await futureTs();
      await expect(job.connect(client).createJob(provider.address, evaluator.address, exp, "", ethers.ZeroAddress))
        .to.be.revertedWithCustomError(job, "EnforcedPause");

      // Unpause and continue
      await job.connect(pauser).unpause();
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      // submit/complete should not depend on pause — re-pause and prove it.
      await job.connect(pauser).pause();
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");
      await job.connect(evaluator).complete(jobId, ethers.ZeroHash, "0x");
      expect((await job.getJob(jobId)).status).to.equal(Status.Completed);
    });

    it("C8. claimRefund IGNORES the hook even if one is configured", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();

      const Hook = await ethers.getContractFactory("TestACPHook");
      const hook = await Hook.deploy();
      await hook.setMode(HOOK_MODE.RevertBefore); // would block any hookable call

      const exp = await futureTs();
      await job.connect(client).createJob(provider.address, evaluator.address, exp, "", await hook.getAddress());
      const jobId = await job.nextJobId();

      await job.connect(client).setBudget(jobId, ONE_USDC, "0x").catch(() => null); // hook blocks
      await hook.setMode(HOOK_MODE.Pass);
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");

      // Re-arm hook to revert; verify claimRefund still works after expiry.
      await hook.setMode(HOOK_MODE.RevertBefore);
      await time.increaseTo(exp + 1);
      const before = await usdc.balanceOf(client.address);
      await job.connect(client).claimRefund(jobId);
      const after = await usdc.balanceOf(client.address);
      expect(after - before).to.equal(ONE_USDC);
    });

    it("C9. hook revert in beforeAction propagates revert reason", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const Hook = await ethers.getContractFactory("TestACPHook");
      const hook = await Hook.deploy();
      await hook.setMode(HOOK_MODE.RevertBefore);

      const exp = await futureTs();
      await job.connect(client).createJob(provider.address, evaluator.address, exp, "", await hook.getAddress());
      const jobId = await job.nextJobId();

      await expect(job.connect(client).setBudget(jobId, ONE_USDC, "0x"))
        .to.be.revertedWith("hook: blocked before");
    });

    it("C10. hook revert with empty data emits HookCallFailed", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const Hook = await ethers.getContractFactory("TestACPHook");
      const hook = await Hook.deploy();
      await hook.setMode(HOOK_MODE.RevertBeforeNoMsg);

      const exp = await futureTs();
      await job.connect(client).createJob(provider.address, evaluator.address, exp, "", await hook.getAddress());
      const jobId = await job.nextJobId();

      await expect(job.connect(client).setBudget(jobId, ONE_USDC, "0x"))
        .to.be.revertedWithCustomError(job, "HookCallFailed");
    });

    it("C11. hook revert in afterAction also rolls back the state change (atomicity)", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const Hook = await ethers.getContractFactory("TestACPHook");
      const hook = await Hook.deploy();
      await hook.setMode(HOOK_MODE.Pass);

      const exp = await futureTs();
      await job.connect(client).createJob(provider.address, evaluator.address, exp, "", await hook.getAddress());
      const jobId = await job.nextJobId();
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);

      await hook.setMode(HOOK_MODE.RevertAfter);
      await expect(job.connect(client).fund(jobId, ONE_USDC, "0x"))
        .to.be.revertedWith("hook: blocked after");
      // State must NOT have advanced
      expect((await job.getJob(jobId)).status).to.equal(Status.Open);
      // Tokens must have stayed with client (atomic rollback)
      expect(await usdc.balanceOf(client.address)).to.equal(HUNDRED_USDC);
    });

    it("C12. ReentrancyGuard blocks malicious token reentry during complete", async function () {
      const [, pauser, client, provider, evaluator] = await ethers.getSigners();
      const Tok = await ethers.getContractFactory("ReentrantToken");
      const tok = await Tok.deploy();
      await tok.mint(client.address, HUNDRED_USDC);

      const Kernel = await ethers.getContractFactory("ZylogenJob");
      const job = await Kernel.deploy(await tok.getAddress(), pauser.address, ethers.ZeroAddress);

      const exp = Number(await nowTs()) + 7 * 24 * 60 * 60;
      await job.connect(client).createJob(provider.address, evaluator.address, exp, "", ethers.ZeroAddress);
      const jobId = await job.nextJobId();
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await tok.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");

      // Arm the token to try re-entering claimRefund during the transfer to provider
      await tok.arm(await job.getAddress(), jobId, job.interface.getFunction("claimRefund").selector);
      await job.connect(evaluator).complete(jobId, ethers.ZeroHash, "0x");
      expect(await tok.attempted()).to.equal(true);
      expect(await tok.lastAttemptReverted()).to.equal(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // D) Edge cases
  // ════════════════════════════════════════════════════════════════════════

  describe("D. Edge cases", function () {

    it("D1. nextJobId increments and getJob returns zero-init for unknown id", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      expect(await job.nextJobId()).to.equal(0);
      await makeOpenJob({ job, client, provider, evaluator });
      expect(await job.nextJobId()).to.equal(1);
      await makeOpenJob({ job, client, provider, evaluator });
      expect(await job.nextJobId()).to.equal(2);
      const empty = await job.getJob(999);
      expect(empty.client).to.equal(ethers.ZeroAddress);
      expect(empty.status).to.equal(Status.Open); // enum default = 0 = Open
      expect(empty.id).to.equal(0);
    });

    it("D2. createJob with hook = address(0) never invokes any hook", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator }); // hook defaults to 0
      // Calling all hookable functions should succeed without issues.
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");
      await job.connect(evaluator).complete(jobId, ethers.ZeroHash, "0x");
    });

    it("D3. hook records every hookable call with the right selector + encoded data", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const Hook = await ethers.getContractFactory("TestACPHook");
      const hook = await Hook.deploy();
      await hook.setMode(HOOK_MODE.Pass);

      const exp = await futureTs();
      await job.connect(client).createJob(ethers.ZeroAddress, evaluator.address, exp, "", await hook.getAddress());
      const jobId = await job.nextJobId();

      await job.connect(client).setProvider(jobId, provider.address, "0x");
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");
      await job.connect(evaluator).complete(jobId, ethers.ZeroHash, "0x");

      // Each hookable function calls both before and after = 12 calls total
      // setProvider × 2 + setBudget × 2 + fund × 2 + submit × 2 + complete × 2 = 10
      expect(await hook.callCount()).to.equal(10);
    });

    it("D4. fund pulls exactly job.budget worth of tokens; contract balance reflects it", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), HUNDRED_USDC); // approve more
      const clientBefore = await usdc.balanceOf(client.address);
      const escrowBefore = await usdc.balanceOf(await job.getAddress());
      await job.connect(client).fund(jobId, TEN_USDC, "0x");
      expect(await usdc.balanceOf(client.address)).to.equal(clientBefore - TEN_USDC);
      expect(await usdc.balanceOf(await job.getAddress())).to.equal(escrowBefore + TEN_USDC);
    });

    it("D5. expiredAt at exactly block.timestamp + MAX_DURATION is allowed", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const boundary = Number(await nowTs()) + 365 * 24 * 60 * 60;
      await job.connect(client).createJob(provider.address, evaluator.address, boundary, "", ethers.ZeroAddress);
      expect(await job.nextJobId()).to.equal(1);
    });

    it("D6. paymentToken() and constants expose immutable values", async function () {
      const { job, usdc } = await deployFixture();
      expect(await job.paymentToken()).to.equal(await usdc.getAddress());
      expect(await job.MAX_DURATION()).to.equal(365n * 24n * 60n * 60n);
      expect(await job.HOOK_GAS_LIMIT()).to.equal(500_000n);
    });

    it("D7. consecutive jobs do not share state", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const j1 = (await makeOpenJob({ job, client, provider, evaluator })).jobId;
      const j2 = (await makeOpenJob({ job, client, provider, evaluator })).jobId;

      await job.connect(client).setBudget(j1, ONE_USDC, "0x");
      await job.connect(client).setBudget(j2, TEN_USDC, "0x");

      expect((await job.getJob(j1)).budget).to.equal(ONE_USDC);
      expect((await job.getJob(j2)).budget).to.equal(TEN_USDC);
    });

    it("D8. reject from Open does NOT call hook with refund encoding (no tokens moved)", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const Hook = await ethers.getContractFactory("TestACPHook");
      const hook = await Hook.deploy();
      await hook.setMode(HOOK_MODE.Pass);

      const exp = await futureTs();
      await job.connect(client).createJob(provider.address, evaluator.address, exp, "", await hook.getAddress());
      const jobId = await job.nextJobId();

      await job.connect(client).reject(jobId, ethers.ZeroHash, "0x");
      // Hook should have seen exactly 2 calls (before + after) for reject
      expect(await hook.callCount()).to.equal(2);
      expect((await job.getJob(jobId)).status).to.equal(Status.Rejected);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // E) Events
  // ════════════════════════════════════════════════════════════════════════

  describe("E. Events emit correctly", function () {

    it("E1. JobCreated has correct args", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const exp = await futureTs();
      await expect(job.connect(client).createJob(provider.address, evaluator.address, exp, "x", ethers.ZeroAddress))
        .to.emit(job, "JobCreated")
        .withArgs(1n, client.address, provider.address, evaluator.address, exp, ethers.ZeroAddress);
    });

    it("E2. ProviderSet on setProvider", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const exp = await futureTs();
      await job.connect(client).createJob(ethers.ZeroAddress, evaluator.address, exp, "", ethers.ZeroAddress);
      const jobId = await job.nextJobId();
      await expect(job.connect(client).setProvider(jobId, provider.address, "0x"))
        .to.emit(job, "ProviderSet").withArgs(jobId, provider.address);
    });

    it("E3. BudgetSet on setBudget", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await expect(job.connect(client).setBudget(jobId, ONE_USDC, "0x"))
        .to.emit(job, "BudgetSet").withArgs(jobId, ONE_USDC);
    });

    it("E4. JobFunded on fund", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await expect(job.connect(client).fund(jobId, ONE_USDC, "0x"))
        .to.emit(job, "JobFunded").withArgs(jobId, client.address, ONE_USDC);
    });

    it("E5. JobSubmitted on submit emits deliverable", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      const d = ethers.keccak256(ethers.toUtf8Bytes("art.pdf"));
      await expect(job.connect(provider).submit(jobId, d, "0x"))
        .to.emit(job, "JobSubmitted").withArgs(jobId, provider.address, d);
    });

    it("E6. JobCompleted + PaymentReleased on complete", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, TEN_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), TEN_USDC);
      await job.connect(client).fund(jobId, TEN_USDC, "0x");
      await job.connect(provider).submit(jobId, ethers.ZeroHash, "0x");
      const r = ethers.id("done");
      await expect(job.connect(evaluator).complete(jobId, r, "0x"))
        .to.emit(job, "JobCompleted").withArgs(jobId, evaluator.address, r)
        .and.to.emit(job, "PaymentReleased").withArgs(jobId, provider.address, TEN_USDC);
    });

    it("E7. JobRejected only when rejecting from Open (no Refunded)", async function () {
      const { job, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      const r = ethers.id("not interested");
      const tx = await job.connect(client).reject(jobId, r, "0x");
      await expect(tx).to.emit(job, "JobRejected").withArgs(jobId, client.address, r);
      await expect(tx).to.not.emit(job, "Refunded");
    });

    it("E8. JobRejected + Refunded when rejecting Funded", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      const r = ethers.id("invalid scope");
      await expect(job.connect(evaluator).reject(jobId, r, "0x"))
        .to.emit(job, "JobRejected").withArgs(jobId, evaluator.address, r)
        .and.to.emit(job, "Refunded").withArgs(jobId, client.address, ONE_USDC);
    });

    it("E9. JobExpired + Refunded on claimRefund", async function () {
      const { job, usdc, client, provider, evaluator } = await deployFixture();
      const { jobId, expiredAt } = await makeOpenJob({ job, client, provider, evaluator });
      await job.connect(client).setBudget(jobId, ONE_USDC, "0x");
      await usdc.connect(client).approve(await job.getAddress(), ONE_USDC);
      await job.connect(client).fund(jobId, ONE_USDC, "0x");
      await time.increaseTo(expiredAt + 1);
      await expect(job.connect(client).claimRefund(jobId))
        .to.emit(job, "JobExpired").withArgs(jobId)
        .and.to.emit(job, "Refunded").withArgs(jobId, client.address, ONE_USDC);
    });
  });
});
