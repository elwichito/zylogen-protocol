// test/TaskEscrowV2.test.js
const { expect } = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

describe("TaskEscrowV2", function () {
  let escrow, usdc;
  let deployer, oracle, treasury, sender, provider, stranger;
  const TIMEOUT  = 7 * 24 * 60 * 60; // 7 days
  const FEE_BPS  = 500n; // 5%

  // Helper: generate a random taskHash
  function taskHash(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  beforeEach(async function () {
    [deployer, oracle, treasury, sender, provider, stranger] =
      await ethers.getSigners();

    // Deploy mock USDC (6 decimals like real USDC)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    // Mint 10,000 USDC to sender
    await usdc.mint(sender.address, 10_000_000_000n); // 10,000 USDC (6 decimals)

    // Deploy TaskEscrowV2
    const Factory = await ethers.getContractFactory("TaskEscrowV2");
    escrow = await Factory.deploy(
      oracle.address,
      treasury.address,
      await usdc.getAddress()
    );
    await escrow.waitForDeployment();

    // Sender approves escrow to spend USDC
    await usdc.connect(sender).approve(
      await escrow.getAddress(),
      ethers.MaxUint256
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ETH ESCROW
  // ═══════════════════════════════════════════════════════════════════════════

  describe("ETH Escrow", function () {
    it("creates an ETH escrow", async function () {
      const hash = taskHash("eth-task-1");
      const amount = ethers.parseEther("0.01");

      await expect(
        escrow.connect(sender).createTaskETH(hash, provider.address, { value: amount })
      ).to.emit(escrow, "TaskCreated");

      const e = await escrow.getEscrow(hash);
      expect(e.sender).to.equal(sender.address);
      expect(e.provider).to.equal(provider.address);
      expect(e.amount).to.equal(amount);
      expect(e.token).to.equal(ethers.ZeroAddress);
    });

    it("reverts on zero ETH", async function () {
      const hash = taskHash("eth-zero");
      await expect(
        escrow.connect(sender).createTaskETH(hash, provider.address, { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("reverts on duplicate taskHash", async function () {
      const hash = taskHash("eth-dup");
      const amount = ethers.parseEther("0.01");

      await escrow.connect(sender).createTaskETH(hash, provider.address, { value: amount });

      await expect(
        escrow.connect(sender).createTaskETH(hash, provider.address, { value: amount })
      ).to.be.revertedWithCustomError(escrow, "TaskAlreadyExists");
    });

    it("oracle releases ETH with 5% fee", async function () {
      const hash = taskHash("eth-release");
      const amount = ethers.parseEther("1.0");

      await escrow.connect(sender).createTaskETH(hash, provider.address, { value: amount });

      const provBefore = await ethers.provider.getBalance(provider.address);
      const tresBefore = await ethers.provider.getBalance(treasury.address);

      await escrow.connect(oracle).release(hash);

      const provAfter = await ethers.provider.getBalance(provider.address);
      const tresAfter = await ethers.provider.getBalance(treasury.address);

      const expectedFee    = amount * FEE_BPS / 10_000n;
      const expectedPayout = amount - expectedFee;

      expect(provAfter - provBefore).to.equal(expectedPayout);
      expect(tresAfter - tresBefore).to.equal(expectedFee);
    });

    it("sender reclaims ETH after timeout", async function () {
      const hash = taskHash("eth-reclaim");
      const amount = ethers.parseEther("0.5");

      await escrow.connect(sender).createTaskETH(hash, provider.address, { value: amount });

      // Try before timeout — should fail
      await expect(
        escrow.connect(sender).reclaim(hash)
      ).to.be.revertedWithCustomError(escrow, "DeadlineNotReached");

      // Fast-forward 7 days
      await time.increase(TIMEOUT + 1);

      const balBefore = await ethers.provider.getBalance(sender.address);
      const tx = await escrow.connect(sender).reclaim(hash);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(sender.address);

      expect(balAfter - balBefore + gasCost).to.equal(amount);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // USDC / ERC-20 ESCROW
  // ═══════════════════════════════════════════════════════════════════════════

  describe("USDC Escrow", function () {
    const usdcAmount = 100_000_000n; // 100 USDC (6 decimals)

    it("creates a USDC escrow", async function () {
      const hash = taskHash("usdc-task-1");

      await expect(
        escrow.connect(sender).createTaskToken(
          hash, provider.address, await usdc.getAddress(), usdcAmount
        )
      ).to.emit(escrow, "TaskCreated");

      const e = await escrow.getEscrow(hash);
      expect(e.sender).to.equal(sender.address);
      expect(e.amount).to.equal(usdcAmount);
      expect(e.token).to.equal(await usdc.getAddress());
    });

    it("transfers USDC from sender to contract", async function () {
      const hash = taskHash("usdc-transfer");
      const contractAddr = await escrow.getAddress();

      const before = await usdc.balanceOf(contractAddr);
      await escrow.connect(sender).createTaskToken(
        hash, provider.address, await usdc.getAddress(), usdcAmount
      );
      const after_ = await usdc.balanceOf(contractAddr);

      expect(after_ - before).to.equal(usdcAmount);
    });

    it("reverts on zero amount", async function () {
      const hash = taskHash("usdc-zero");
      await expect(
        escrow.connect(sender).createTaskToken(
          hash, provider.address, await usdc.getAddress(), 0n
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("reverts on non-whitelisted token", async function () {
      const hash = taskHash("bad-token");
      // Deploy another token that's NOT whitelisted
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const fakeToken = await MockERC20.deploy("Fake", "FAKE", 18);

      await expect(
        escrow.connect(sender).createTaskToken(
          hash, provider.address, await fakeToken.getAddress(), 1000n
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidToken");
    });

    it("oracle releases USDC with 5% fee", async function () {
      const hash = taskHash("usdc-release");

      await escrow.connect(sender).createTaskToken(
        hash, provider.address, await usdc.getAddress(), usdcAmount
      );

      const provBefore = await usdc.balanceOf(provider.address);
      const tresBefore = await usdc.balanceOf(treasury.address);

      await escrow.connect(oracle).release(hash);

      const provAfter = await usdc.balanceOf(provider.address);
      const tresAfter = await usdc.balanceOf(treasury.address);

      const expectedFee    = usdcAmount * FEE_BPS / 10_000n;
      const expectedPayout = usdcAmount - expectedFee;

      expect(provAfter - provBefore).to.equal(expectedPayout);
      expect(tresAfter - tresBefore).to.equal(expectedFee);
    });

    it("sender reclaims USDC after timeout", async function () {
      const hash = taskHash("usdc-reclaim");

      await escrow.connect(sender).createTaskToken(
        hash, provider.address, await usdc.getAddress(), usdcAmount
      );

      await time.increase(TIMEOUT + 1);

      const before = await usdc.balanceOf(sender.address);
      await escrow.connect(sender).reclaim(hash);
      const after_ = await usdc.balanceOf(sender.address);

      expect(after_ - before).to.equal(usdcAmount);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Access Control", function () {
    it("only oracle can release", async function () {
      const hash = taskHash("access-release");
      await escrow.connect(sender).createTaskETH(hash, provider.address, {
        value: ethers.parseEther("0.01"),
      });

      await expect(
        escrow.connect(stranger).release(hash)
      ).to.be.revertedWithCustomError(escrow, "NotOracle");
    });

    it("only sender can reclaim", async function () {
      const hash = taskHash("access-reclaim");
      await escrow.connect(sender).createTaskETH(hash, provider.address, {
        value: ethers.parseEther("0.01"),
      });

      await time.increase(TIMEOUT + 1);

      await expect(
        escrow.connect(stranger).reclaim(hash)
      ).to.be.revertedWithCustomError(escrow, "NotSender");
    });

    it("only oracle can whitelist tokens", async function () {
      await expect(
        escrow.connect(stranger).setAllowedToken(ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(escrow, "NotOracle");
    });

    it("oracle can add new tokens", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const dai = await MockERC20.deploy("Dai", "DAI", 18);
      const daiAddr = await dai.getAddress();

      expect(await escrow.allowedTokens(daiAddr)).to.equal(false);

      await escrow.connect(oracle).setAllowedToken(daiAddr, true);

      expect(await escrow.allowedTokens(daiAddr)).to.equal(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Edge Cases", function () {
    it("release clears escrow — cannot release twice", async function () {
      const hash = taskHash("double-release");
      await escrow.connect(sender).createTaskETH(hash, provider.address, {
        value: ethers.parseEther("0.01"),
      });

      await escrow.connect(oracle).release(hash);

      await expect(
        escrow.connect(oracle).release(hash)
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound");
    });

    it("reclaim clears escrow — cannot reclaim twice", async function () {
      const hash = taskHash("double-reclaim");
      await escrow.connect(sender).createTaskETH(hash, provider.address, {
        value: ethers.parseEther("0.01"),
      });

      await time.increase(TIMEOUT + 1);
      await escrow.connect(sender).reclaim(hash);

      await expect(
        escrow.connect(sender).reclaim(hash)
      ).to.be.revertedWithCustomError(escrow, "TaskNotFound");
    });

    it("isActive returns correct state", async function () {
      const hash = taskHash("active-check");
      expect(await escrow.isActive(hash)).to.equal(false);

      await escrow.connect(sender).createTaskETH(hash, provider.address, {
        value: ethers.parseEther("0.01"),
      });
      expect(await escrow.isActive(hash)).to.equal(true);

      await escrow.connect(oracle).release(hash);
      expect(await escrow.isActive(hash)).to.equal(false);
    });

    it("rejects direct ETH transfers", async function () {
      await expect(
        sender.sendTransaction({
          to: await escrow.getAddress(),
          value: ethers.parseEther("1.0"),
        })
      ).to.be.revertedWithCustomError(escrow, "ETHNotAccepted");
    });

    it("handles minimum USDC amount (1 cent = 10000 units)", async function () {
      const hash = taskHash("micro-usdc");
      const microAmount = 10_000n; // $0.01 USDC

      await escrow.connect(sender).createTaskToken(
        hash, provider.address, await usdc.getAddress(), microAmount
      );

      await escrow.connect(oracle).release(hash);

      // Fee = 10000 * 500 / 10000 = 500 (0.05 cents)
      // Payout = 10000 - 500 = 9500
      expect(await usdc.balanceOf(provider.address)).to.equal(9_500n);
      expect(await usdc.balanceOf(treasury.address)).to.equal(500n);
    });
  });
});
