// a2a/ZylogenAgent.js
// Zylogen Protocol — Autonomous Agent Framework
// An AI agent that can hire other agents, accept work, and settle autonomously.
//
// Usage:
//   const agent = new ZylogenAgent({ privateKey, anthropicKey, skills: ["code-review", "translation"] });
//   await agent.start();

const { ethers } = require("ethers");
const { ZylogenSDK } = require("../sdk/index.js");

// ─── Agent Class ──────────────────────────────────────────────────────────

class ZylogenAgent {
  /**
   * @param {object} config
   * @param {string} config.privateKey    - Agent's wallet private key
   * @param {string} config.anthropicKey  - Anthropic API key for AI reasoning
   * @param {string[]} config.skills      - Skills this agent offers (e.g. ["translation", "code-review"])
   * @param {string} [config.name]        - Agent display name
   * @param {string} [config.rpcUrl]      - Base RPC URL (default: public Base RPC)
   * @param {number} [config.maxBudget]   - Max USDC per task this agent will spend (default: 50)
   * @param {number} [config.minPayout]   - Min USDC this agent accepts for work (default: 0.10)
   * @param {boolean} [config.autoAccept] - Auto-accept matching tasks (default: true)
   */
  constructor(config) {
    this.config = {
      rpcUrl:     config.rpcUrl || "https://mainnet.base.org",
      maxBudget:  config.maxBudget || 50,
      minPayout:  config.minPayout || 0.10,
      autoAccept: config.autoAccept !== false,
      name:       config.name || `Agent-${Date.now().toString(36)}`,
      skills:     config.skills || [],
      ...config,
    };

    // Setup provider + signer
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.signer   = new ethers.Wallet(this.config.privateKey, this.provider);
    this.sdk      = new ZylogenSDK(this.signer);

    // Task tracking
    this.activeTasks    = new Map(); // taskHash → task info
    this.completedTasks = new Map();
    this.pendingWork    = new Map(); // tasks this agent accepted to work on

    // Stats
    this.stats = {
      tasksCreated:   0,
      tasksCompleted: 0,
      tasksAccepted:  0,
      totalEarned:    0,
      totalSpent:     0,
    };

    this._running = false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Start the agent — begins listening for tasks and processing work
   */
  async start() {
    const address = await this.signer.getAddress();
    console.log(`[${this.config.name}] Starting...`);
    console.log(`[${this.config.name}] Address: ${address}`);
    console.log(`[${this.config.name}] Skills: ${this.config.skills.join(", ")}`);

    // Check balances
    const ethBal  = await this.provider.getBalance(address);
    const usdcBal = await this.sdk.getUSDCBalance(address);
    console.log(`[${this.config.name}] ETH: ${ethers.formatEther(ethBal)}`);
    console.log(`[${this.config.name}] USDC: $${usdcBal.toFixed(2)}`);

    this._running = true;

    // Listen for new tasks on the protocol
    this.sdk.onTaskCreated((event) => {
      this._handleNewTask(event);
    });

    // Listen for releases (to track earnings)
    this.sdk.onTaskReleased((event) => {
      this._handleRelease(event);
    });

    console.log(`[${this.config.name}] Listening for tasks...`);
    return this;
  }

  /**
   * Stop the agent
   */
  stop() {
    this._running = false;
    this.sdk.stopListening();
    console.log(`[${this.config.name}] Stopped.`);
    console.log(`[${this.config.name}] Stats:`, this.stats);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HIRE: Agent creates a task and hires another agent
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create a task and hire a specific agent (USDC)
   * @param {string} agentAddress  - Address of the agent to hire
   * @param {number} amountUSDC    - Payment in USDC
   * @param {string} description   - What you need done
   * @param {object} [metadata]    - Additional task metadata
   * @returns {object} { taskHash, tx, receipt }
   */
  async hireAgent(agentAddress, amountUSDC, description, metadata = {}) {
    if (amountUSDC > this.config.maxBudget) {
      throw new Error(`Amount $${amountUSDC} exceeds max budget $${this.config.maxBudget}`);
    }

    console.log(`[${this.config.name}] Hiring agent ${agentAddress.slice(0, 8)}... for $${amountUSDC}`);
    console.log(`[${this.config.name}] Task: ${description}`);

    const result = await this.sdk.createTaskUSDC(agentAddress, amountUSDC, description);

    this.activeTasks.set(result.taskHash, {
      ...result,
      description,
      metadata,
      status: "pending",
      createdAt: new Date(),
    });

    this.stats.tasksCreated++;
    this.stats.totalSpent += amountUSDC;

    console.log(`[${this.config.name}] Task created: ${result.taskHash.slice(0, 16)}...`);
    return result;
  }

  /**
   * Create a task and hire an agent (ETH)
   * @param {string} agentAddress
   * @param {string} amountETH
   * @param {string} description
   * @returns {object}
   */
  async hireAgentETH(agentAddress, amountETH, description, metadata = {}) {
    console.log(`[${this.config.name}] Hiring agent ${agentAddress.slice(0, 8)}... for ${amountETH} ETH`);

    const result = await this.sdk.createTaskETH(agentAddress, amountETH, description);

    this.activeTasks.set(result.taskHash, {
      ...result,
      description,
      metadata,
      status: "pending",
      createdAt: new Date(),
    });

    this.stats.tasksCreated++;
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WORK: Agent accepts and completes tasks
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Evaluate if this agent should accept a task
   * Uses AI to match task description against agent skills
   * @param {object} taskEvent - Task created event from chain
   * @returns {boolean}
   */
  async shouldAcceptTask(taskEvent) {
    const myAddress = (await this.signer.getAddress()).toLowerCase();

    // Only consider tasks assigned to this agent
    if (taskEvent.provider.toLowerCase() !== myAddress) {
      return false;
    }

    // Check minimum payout
    const amount = parseFloat(taskEvent.amount);
    if (taskEvent.token === "USDC" && amount < this.config.minPayout) {
      console.log(`[${this.config.name}] Skipping task — payout $${amount} below minimum $${this.config.minPayout}`);
      return false;
    }

    return true;
  }

  /**
   * Process a task using AI
   * Override this method to implement custom task processing logic
   * @param {string} taskHash
   * @param {string} description
   * @returns {object} { success, result }
   */
  async processTask(taskHash, description) {
    console.log(`[${this.config.name}] Processing task: ${description}`);

    try {
      // Call Claude API for task processing
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          system: `You are an AI agent working on the Zylogen Protocol. Your skills are: ${this.config.skills.join(", ")}. Complete the task described and provide the result. Be concise and professional.`,
          messages: [
            {
              role: "user",
              content: `Task (${taskHash}):\n${description}\n\nComplete this task to the best of your ability. Provide the deliverable.`,
            },
          ],
        }),
      });

      const data = await response.json();
      const result = data.content?.[0]?.text || "Task completed.";

      console.log(`[${this.config.name}] Task completed: ${taskHash.slice(0, 16)}...`);
      return { success: true, result };
    } catch (error) {
      console.error(`[${this.config.name}] Task processing failed:`, error.message);
      return { success: false, result: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MULTI-AGENT: Delegate subtasks to other agents
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Break a complex task into subtasks and hire specialists
   * @param {string} mainDescription - The main task
   * @param {object[]} subtasks - Array of { agent, amount, description }
   * @returns {object[]} Array of created tasks
   */
  async delegateSubtasks(mainDescription, subtasks) {
    console.log(`[${this.config.name}] Delegating ${subtasks.length} subtasks for: ${mainDescription}`);

    const results = [];
    for (const sub of subtasks) {
      const result = await this.hireAgent(
        sub.agent,
        sub.amount,
        `[Subtask of: ${mainDescription}]\n${sub.description}`
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Create a task chain — output of task 1 feeds into task 2
   * @param {object[]} chain - Array of { agent, amount, description }
   * @returns {string} First taskHash (chain start)
   */
  async createTaskChain(chain) {
    console.log(`[${this.config.name}] Creating ${chain.length}-step task chain`);

    let previousHash = null;
    const hashes = [];

    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      const desc = previousHash
        ? `[Chain step ${i + 1}/${chain.length}, depends on: ${previousHash.slice(0, 16)}]\n${step.description}`
        : `[Chain step 1/${chain.length}]\n${step.description}`;

      const result = await this.hireAgent(step.agent, step.amount, desc);
      hashes.push(result.taskHash);
      previousHash = result.taskHash;
    }

    return hashes;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INTERNAL EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════

  async _handleNewTask(event) {
    if (!this._running) return;

    const shouldAccept = await this.shouldAcceptTask(event);
    if (!shouldAccept) return;

    console.log(`[${this.config.name}] New task for me: ${event.taskHash.slice(0, 16)}... ($${event.amount} ${event.token})`);

    this.pendingWork.set(event.taskHash, {
      ...event,
      status: "accepted",
      acceptedAt: new Date(),
    });

    this.stats.tasksAccepted++;

    if (this.config.autoAccept) {
      // Process the task automatically
      const { success, result } = await this.processTask(event.taskHash, `Task ${event.taskHash}`);

      if (success) {
        this.pendingWork.get(event.taskHash).status = "completed";
        this.pendingWork.get(event.taskHash).result = result;
        this.stats.tasksCompleted++;
        console.log(`[${this.config.name}] Work submitted for ${event.taskHash.slice(0, 16)}...`);
      }
    }
  }

  _handleRelease(event) {
    const myAddress = this.signer.address?.toLowerCase();

    if (event.provider.toLowerCase() === myAddress) {
      this.stats.totalEarned += parseFloat(event.payout);
      console.log(`[${this.config.name}] Payment received: $${event.payout} ${event.token} (fee: $${event.fee})`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get agent status
   */
  async getStatus() {
    const address = await this.signer.getAddress();
    const ethBal  = await this.provider.getBalance(address);
    const usdcBal = await this.sdk.getUSDCBalance(address);

    return {
      name:     this.config.name,
      address,
      skills:   this.config.skills,
      eth:      ethers.formatEther(ethBal),
      usdc:     usdcBal,
      stats:    this.stats,
      active:   this._running,
      pending:  this.pendingWork.size,
      created:  this.activeTasks.size,
    };
  }

  /**
   * Get the SDK instance for direct contract interaction
   */
  getSDK() {
    return this.sdk;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────

module.exports = { ZylogenAgent };
