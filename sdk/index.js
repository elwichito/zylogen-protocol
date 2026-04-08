// zylogen-sdk/index.js
// Zylogen Protocol SDK v2.0.0
// The easiest way to integrate AI-validated escrow into your app.
//
// Usage:
//   import { ZylogenSDK } from 'zylogen-sdk';
//   const zylogen = new ZylogenSDK(signer);
//   await zylogen.createTaskUSDC(provider, amount, "Build me a website");

const { ethers } = require("ethers");

// ─── Contract Addresses (Base Mainnet) ────────────────────────────────────

const ADDRESSES = {
  ESCROW_V1: "0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f",
  ESCROW_V2: "0xC10D9b263612733C1752eFDe9CD617887216832c",
  USDC:      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  CHAIN_ID:  8453,
};

// ─── ABIs (minimal, only what SDK needs) ──────────────────────────────────

const ESCROW_V2_ABI = [
  // Write
  "function createTaskETH(bytes32 taskHash, address provider) payable",
  "function createTaskToken(bytes32 taskHash, address provider, address token, uint96 amount)",
  "function release(bytes32 taskHash)",
  "function reclaim(bytes32 taskHash)",
  "function setAllowedToken(address token, bool allowed)",
  // Read
  "function getEscrow(bytes32 taskHash) view returns (address sender, uint96 amount, address provider, uint40 deadline, address token)",
  "function isActive(bytes32 taskHash) view returns (bool)",
  "function allowedTokens(address token) view returns (bool)",
  "function oracle() view returns (address)",
  "function treasury() view returns (address)",
  "function FEE_BPS() view returns (uint256)",
  // Events
  "event TaskCreated(bytes32 indexed taskHash, address indexed sender, address indexed provider, address token, uint96 amount, uint40 deadline)",
  "event TaskReleased(bytes32 indexed taskHash, address indexed provider, address token, uint96 providerAmount, uint96 fee)",
  "event TaskReclaimed(bytes32 indexed taskHash, address indexed sender, address token, uint96 amount)",
  "event TokenAllowed(address indexed token, bool allowed)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// ─── SDK Class ────────────────────────────────────────────────────────────

class ZylogenSDK {
  /**
   * @param {ethers.Signer} signer - An ethers.js signer connected to Base Mainnet
   * @param {object} [options]
   * @param {string} [options.escrowAddress] - Override escrow contract address
   * @param {string} [options.usdcAddress]   - Override USDC address
   */
  constructor(signer, options = {}) {
    this.signer   = signer;
    this.addresses = {
      escrow: options.escrowAddress || ADDRESSES.ESCROW_V2,
      usdc:   options.usdcAddress   || ADDRESSES.USDC,
    };

    this.escrow = new ethers.Contract(
      this.addresses.escrow,
      ESCROW_V2_ABI,
      signer
    );

    this.usdc = new ethers.Contract(
      this.addresses.usdc,
      ERC20_ABI,
      signer
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TASK CREATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate a deterministic taskHash from a description string
   * @param {string} description - Human-readable task description
   * @returns {string} bytes32 taskHash
   */
  hashTask(description) {
    return ethers.keccak256(ethers.toUtf8Bytes(description));
  }

  /**
   * Generate a unique taskHash with timestamp to avoid collisions
   * @param {string} description - Task description
   * @returns {string} bytes32 taskHash
   */
  hashTaskUnique(description) {
    const unique = `${description}::${Date.now()}::${Math.random()}`;
    return ethers.keccak256(ethers.toUtf8Bytes(unique));
  }

  /**
   * Create a task with ETH escrow
   * @param {string} provider    - Provider wallet address
   * @param {string} amountETH   - Amount in ETH (e.g. "0.01")
   * @param {string} description - Task description (used to generate taskHash)
   * @returns {object} { taskHash, tx, receipt }
   */
  async createTaskETH(provider, amountETH, description) {
    const taskHash = this.hashTaskUnique(description);
    const value    = ethers.parseEther(amountETH);

    const tx = await this.escrow.createTaskETH(taskHash, provider, { value });
    const receipt = await tx.wait();

    return {
      taskHash,
      tx,
      receipt,
      description,
      amount: amountETH,
      token: "ETH",
    };
  }

  /**
   * Create a task with USDC escrow
   * Automatically handles USDC approval if needed
   * @param {string} provider    - Provider wallet address
   * @param {number} amountUSDC  - Amount in USDC (e.g. 10.50 = $10.50)
   * @param {string} description - Task description
   * @returns {object} { taskHash, tx, receipt, approvalTx? }
   */
  async createTaskUSDC(provider, amountUSDC, description) {
    const taskHash = this.hashTaskUnique(description);
    // USDC has 6 decimals: $10.50 = 10_500_000
    const amount   = BigInt(Math.round(amountUSDC * 1_000_000));

    // Check and set approval if needed
    let approvalTx = null;
    const signerAddr = await this.signer.getAddress();
    const currentAllowance = await this.usdc.allowance(
      signerAddr,
      this.addresses.escrow
    );

    if (currentAllowance < amount) {
      approvalTx = await this.usdc.approve(
        this.addresses.escrow,
        ethers.MaxUint256  // Infinite approval (approve once, use forever)
      );
      await approvalTx.wait();
    }

    const tx = await this.escrow.createTaskToken(
      taskHash,
      provider,
      this.addresses.usdc,
      amount
    );
    const receipt = await tx.wait();

    return {
      taskHash,
      tx,
      receipt,
      approvalTx,
      description,
      amount: amountUSDC,
      token: "USDC",
    };
  }

  /**
   * Create a task with any whitelisted ERC-20 token
   * @param {string} provider     - Provider wallet address
   * @param {string} tokenAddress - ERC-20 token contract address
   * @param {number} amount       - Human-readable amount (auto-scales to token decimals)
   * @param {string} description  - Task description
   * @returns {object} { taskHash, tx, receipt }
   */
  async createTaskToken(provider, tokenAddress, amount, description) {
    const token    = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
    const decimals = await token.decimals();
    const symbol   = await token.symbol();
    const rawAmount = BigInt(Math.round(amount * (10 ** Number(decimals))));
    const taskHash  = this.hashTaskUnique(description);

    // Approve if needed
    const signerAddr = await this.signer.getAddress();
    const allowance  = await token.allowance(signerAddr, this.addresses.escrow);
    if (allowance < rawAmount) {
      const appTx = await token.approve(this.addresses.escrow, ethers.MaxUint256);
      await appTx.wait();
    }

    const tx = await this.escrow.createTaskToken(
      taskHash, provider, tokenAddress, rawAmount
    );
    const receipt = await tx.wait();

    return { taskHash, tx, receipt, description, amount, token: symbol };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TASK MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get full escrow details for a task
   * @param {string} taskHash - bytes32 task hash
   * @returns {object|null} Escrow details or null if not found
   */
  async getTask(taskHash) {
    const e = await this.escrow.getEscrow(taskHash);
    if (e.amount === 0n) return null;

    const isUSDC = e.token.toLowerCase() === this.addresses.usdc.toLowerCase();
    const isETH  = e.token === ethers.ZeroAddress;

    return {
      taskHash,
      sender:   e.sender,
      provider: e.provider,
      amount:   isETH ? ethers.formatEther(e.amount)
              : isUSDC ? Number(e.amount) / 1_000_000
              : e.amount.toString(),
      rawAmount: e.amount,
      deadline:  new Date(Number(e.deadline) * 1000),
      token:     isETH ? "ETH" : isUSDC ? "USDC" : e.token,
      tokenAddress: e.token,
      isExpired: Date.now() > Number(e.deadline) * 1000,
    };
  }

  /**
   * Check if a task is active
   * @param {string} taskHash
   * @returns {boolean}
   */
  async isActive(taskHash) {
    return this.escrow.isActive(taskHash);
  }

  /**
   * Release escrow funds to provider (oracle only)
   * @param {string} taskHash
   * @returns {object} { tx, receipt }
   */
  async release(taskHash) {
    const tx = await this.escrow.release(taskHash);
    const receipt = await tx.wait();
    return { tx, receipt };
  }

  /**
   * Reclaim funds after timeout (sender only)
   * @param {string} taskHash
   * @returns {object} { tx, receipt }
   */
  async reclaim(taskHash) {
    const tx = await this.escrow.reclaim(taskHash);
    const receipt = await tx.wait();
    return { tx, receipt };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS (for agents and bots)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Listen for new tasks being created
   * @param {function} callback - Called with (taskHash, sender, provider, token, amount, deadline)
   * @returns {ethers.Contract} The contract (call .removeAllListeners() to stop)
   */
  onTaskCreated(callback) {
    this.escrow.on("TaskCreated", (taskHash, sender, provider, token, amount, deadline) => {
      const isETH  = token === ethers.ZeroAddress;
      const isUSDC = token.toLowerCase() === this.addresses.usdc.toLowerCase();
      callback({
        taskHash,
        sender,
        provider,
        token:  isETH ? "ETH" : isUSDC ? "USDC" : token,
        amount: isETH ? ethers.formatEther(amount)
              : isUSDC ? Number(amount) / 1_000_000
              : amount.toString(),
        deadline: new Date(Number(deadline) * 1000),
      });
    });
    return this.escrow;
  }

  /**
   * Listen for task releases
   * @param {function} callback
   */
  onTaskReleased(callback) {
    this.escrow.on("TaskReleased", (taskHash, provider, token, providerAmount, fee) => {
      const isETH  = token === ethers.ZeroAddress;
      const isUSDC = token.toLowerCase() === this.addresses.usdc.toLowerCase();
      callback({
        taskHash,
        provider,
        token:  isETH ? "ETH" : isUSDC ? "USDC" : token,
        payout: isETH ? ethers.formatEther(providerAmount)
              : isUSDC ? Number(providerAmount) / 1_000_000
              : providerAmount.toString(),
        fee:    isETH ? ethers.formatEther(fee)
              : isUSDC ? Number(fee) / 1_000_000
              : fee.toString(),
      });
    });
    return this.escrow;
  }

  /**
   * Listen for task reclaims
   * @param {function} callback
   */
  onTaskReclaimed(callback) {
    this.escrow.on("TaskReclaimed", (taskHash, sender, token, amount) => {
      callback({ taskHash, sender, token: token === ethers.ZeroAddress ? "ETH" : token, amount });
    });
    return this.escrow;
  }

  /**
   * Stop all event listeners
   */
  stopListening() {
    this.escrow.removeAllListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get USDC balance of an address
   * @param {string} address
   * @returns {number} Balance in USDC (e.g. 10.50)
   */
  async getUSDCBalance(address) {
    const bal = await this.usdc.balanceOf(address);
    return Number(bal) / 1_000_000;
  }

  /**
   * Get protocol info
   * @returns {object} { oracle, treasury, feeBps, feePercent }
   */
  async getProtocolInfo() {
    const [oracle, treasury, feeBps] = await Promise.all([
      this.escrow.oracle(),
      this.escrow.treasury(),
      this.escrow.FEE_BPS(),
    ]);
    return {
      oracle,
      treasury,
      feeBps: Number(feeBps),
      feePercent: Number(feeBps) / 100,
      escrowAddress: this.addresses.escrow,
      usdcAddress:   this.addresses.usdc,
      chainId:       ADDRESSES.CHAIN_ID,
    };
  }

  /**
   * Check if a token is whitelisted
   * @param {string} tokenAddress
   * @returns {boolean}
   */
  async isTokenAllowed(tokenAddress) {
    return this.escrow.allowedTokens(tokenAddress);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────

module.exports = { ZylogenSDK, ADDRESSES, ESCROW_V2_ABI, ERC20_ABI };
