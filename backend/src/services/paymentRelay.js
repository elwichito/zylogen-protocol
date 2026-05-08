"use strict";

/**
 * paymentRelay.js  —  MVP v2
 *
 * Stripe Webhook → TaskEscrow.lock() on Base
 *
 * Flow:
 *   1. Stripe fires checkout.session.completed ($9.99)
 *   2. Verify webhook signature
 *   3. Idempotency check (SQLite)
 *   4. Relayer approves USDC transfer, then calls TaskEscrow.lock()
 *   5. Persist result + increment scarcity counter
 *
 * Contract: TaskEscrowV2 @ 0xBE464859Fb6f09fa93b6212f616F3AD19ebe48B1 (Base Mainnet)
 */

const Stripe = require("stripe");
const { ethers } = require("ethers");
const db = require("../db/sqlite");
const { payment: log, webhook: webhookLog } = require("../lib/logger");
const { sendPaymentConfirmedEmail } = require("./email");
const retryQueue = require("./retryQueue");
const { invalidateTodayCache: invalidateZylScoreCache } = require("./zylScore");

const FOUNDING_100_PRICE_CENTS = 999; // $9.99

// ─── Lazy Stripe ─────────────────────────────────────────────────────────────

let _stripe;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// ─── Chain config ─────────────────────────────────────────────────────────────

const TASK_ESCROW_ADDRESS = process.env.TASK_ESCROW_ADDRESS
  || "0xBE464859Fb6f09fa93b6212f616F3AD19ebe48B1";

// USDC on Base Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
// USDC on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
const USDC_ADDRESS = process.env.USDC_ADDRESS
  || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// How much USDC to lock (6 decimals). Default: $9.00 — keeps $0.99 for gas margin.
const USDC_LOCK_AMOUNT = BigInt(process.env.USDC_LOCK_AMOUNT || "9000000");

// Minimal ABIs — only what we call
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

// TaskEscrowV2 ABI — ZYL Genesis (Base Sepolia: 0x9b1516C79855F8E01A5Eb4B4E3A34430041Ae254)
const ESCROW_ABI = [
  "function lock(bytes32 taskId, address client, address worker, address agent, address token, uint256 amount, bytes32 sponsorRoot) external payable",
  "function settle(bytes32 taskId) external",
  "function refund(bytes32 taskId) external",
  "function escrows(bytes32 taskId) external view returns (uint8 status, address client, address worker, address agent, address tokenAddr, uint256 amount, uint256 workerAmountToken, uint256 treasuryAmountToken, uint256 burnAmountZyl, uint256 sparkAmountZyl, uint64 lockedAt)",
  "event Locked(bytes32 indexed taskId, address indexed client, address indexed worker, address agent, address token, uint256 amount)",
];

// Deterministic taskId from Stripe session + client wallet + timestamp
function generateTaskId(stripeSessionId, clientAddress, timestamp) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "uint256"],
      [stripeSessionId, clientAddress, timestamp]
    )
  );
}

// ─── Provider + relayer ───────────────────────────────────────────────────────

function getRelayer() {
  const provider = new ethers.JsonRpcProvider(
    process.env.BASE_RPC_URL || "https://mainnet.base.org"
  );
  // Normalize: ethers v6 requires the 0x prefix
  let pk = process.env.RELAYER_PRIVATE_KEY || "";
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  return new ethers.Wallet(pk, provider);
}

// ─── Core relay ───────────────────────────────────────────────────────────────

/**
 * Approves USDC spend and calls TaskEscrow.lock() for the client.
 * The client address is the MetaMask wallet they provided at checkout
 * (passed as client_reference_id on the Stripe session).
 *
 * @param {string} clientAddress  — client's MetaMask wallet (0x...)
 * @param {string} customerEmail
 * @param {string} stripeSessionId
 * @returns {{ taskId: string, txHash: string }}
 */
async function relayPaymentToEscrow(clientAddress, customerEmail, stripeSessionId) {
  // ── DRY RUN MODE ──────────────────────────────────────────────────────────
  // Set DRY_RUN=true in .env to test the full webhook → DB path without
  // making any on-chain calls. Used for local SQLite verification before
  // the relayer wallet is funded.
  if (process.env.DRY_RUN === "true") {
    const mockTaskId = `DRY-${Date.now()}`;
    const mockTxHash = `0xdryrun_${Date.now().toString(16)}`;

    db.prepare(`
      INSERT INTO escrow_records
        (stripe_session_id, client_email, client_wallet, escrow_id, amount_cents, tx_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, 'locked')
      ON CONFLICT (stripe_session_id) DO UPDATE SET
        client_wallet = excluded.client_wallet,
        escrow_id     = excluded.escrow_id,
        tx_hash       = excluded.tx_hash,
        status        = 'locked'
    `).run(stripeSessionId, customerEmail, clientAddress, mockTaskId, FOUNDING_100_PRICE_CENTS, mockTxHash);

    db.prepare(`UPDATE scarcity SET claimed = claimed + 1 WHERE id = 1`).run();

    // Create Nova session profile (DRY RUN)
    db.prepare(`
      INSERT OR IGNORE INTO nova_sessions (client_email, stripe_session_id)
      VALUES (?, ?)
    `).run(customerEmail, stripeSessionId);

    // Invalidate ZYL Score cache (new order affects score)
    invalidateZylScoreCache();

    log.info({ taskId: mockTaskId, email: customerEmail, dryRun: true }, "DRY RUN: Mock escrow record created");
    return { taskId: mockTaskId, txHash: mockTxHash, dryRun: true };
  }
  // ── END DRY RUN ───────────────────────────────────────────────────────────

  const relayer = getRelayer();

  const usdc   = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, relayer);
  const escrow = new ethers.Contract(TASK_ESCROW_ADDRESS, ESCROW_ABI, relayer);

  // 1. Approve USDC transfer if allowance is insufficient
  const allowance = await usdc.allowance(relayer.address, TASK_ESCROW_ADDRESS);
  if (allowance < USDC_LOCK_AMOUNT) {
    const approveTx = await usdc.approve(TASK_ESCROW_ADDRESS, USDC_LOCK_AMOUNT);
    await approveTx.wait();
    log.info({ escrow: TASK_ESCROW_ADDRESS }, "USDC spending approved");
  }

  // 2. Generate deterministic taskId
  const timestamp = Math.floor(Date.now() / 1000);
  const taskId = generateTaskId(stripeSessionId, clientAddress, timestamp);

  // 3. Call lock() — TaskEscrowV2 signature
  const workerAddress = process.env.NOVA_WORKER_ADDRESS || relayer.address;
  const agentAddress = process.env.NOVA_AGENT_ADDRESS || relayer.address;
  const sponsorRoot = ethers.ZeroHash; // No sponsor tree for now

  const tx = await escrow.lock(
    taskId,
    clientAddress,    // client
    workerAddress,    // worker (Nova)
    agentAddress,     // agent (Nova's AgentID)
    USDC_ADDRESS,     // payment token
    USDC_LOCK_AMOUNT, // amount
    sponsorRoot       // sponsorRoot
  );
  const receipt = await tx.wait();

  // 4. Persist to SQLite
  db.prepare(`
    INSERT INTO escrow_records
      (stripe_session_id, client_email, client_wallet, escrow_id, amount_cents, tx_hash, status)
    VALUES (?, ?, ?, ?, ?, ?, 'locked')
    ON CONFLICT (stripe_session_id) DO UPDATE SET
      client_wallet = excluded.client_wallet,
      escrow_id     = excluded.escrow_id,
      tx_hash       = excluded.tx_hash,
      status        = 'locked'
  `).run(stripeSessionId, customerEmail, clientAddress, taskId, FOUNDING_100_PRICE_CENTS, receipt.hash);

  // 5. Increment scarcity counter
  db.prepare(`UPDATE scarcity SET claimed = claimed + 1 WHERE id = 1`).run();

  // 6. Create Nova session profile (so Nova "knows" the client before first message)
  db.prepare(`
    INSERT OR IGNORE INTO nova_sessions (client_email, stripe_session_id)
    VALUES (?, ?)
  `).run(customerEmail, stripeSessionId);

  // Invalidate ZYL Score cache (new order affects score)
  invalidateZylScoreCache();

  log.info({ taskId, email: customerEmail, txHash: receipt.hash }, "Task locked on-chain");
  return { taskId, txHash: receipt.hash };
}

// ─── Settlement ───────────────────────────────────────────────────────────────

/**
 * Calls TaskEscrow.releaseFunds() after Nova delivers the branding kit.
 * The relayer wallet is the worker — it collects the USDC it originally locked.
 *
 * @param {string} escrowId  — taskId returned by lock() (or tx hash fallback)
 * @param {string} email     — used to update SQLite status
 */
async function releasePayment(escrowId, email) {
  // DRY RUN: just update status, no on-chain call
  if (process.env.DRY_RUN === "true") {
    db.prepare(`
      UPDATE escrow_records SET status = 'released' WHERE client_email = ? AND escrow_id = ?
    `).run(email, escrowId);
    log.info({ escrowId, email, dryRun: true }, "DRY RUN: Escrow released");
    return { released: true, dryRun: true };
  }

  // Skip if escrowId is a mock from DRY_RUN
  if (!escrowId || escrowId.startsWith("DRY-")) {
    log.warn({ escrowId, email }, "Release skipped - escrowId is mock or tx hash");
    db.prepare(`
      UPDATE escrow_records SET status = 'released' WHERE client_email = ? AND escrow_id = ?
    `).run(email, escrowId);
    return { released: true, skippedOnChain: true };
  }

  const relayer = getRelayer();
  const escrow  = new ethers.Contract(TASK_ESCROW_ADDRESS, ESCROW_ABI, relayer);

  // TaskEscrowV2 uses settle() instead of release()
  const tx      = await escrow.settle(escrowId);
  const receipt = await tx.wait();

  db.prepare(`
    UPDATE escrow_records SET status = 'released' WHERE client_email = ? AND escrow_id = ?
  `).run(email, escrowId);

  log.info({ escrowId, email, txHash: receipt.hash }, "Escrow settled on-chain (ZYL burned + worker paid)");
  return { released: true, txHash: receipt.hash };
}

// ─── Raw body middleware (Stripe requires this) ───────────────────────────────

function rawBodyMiddleware(req, res, next) {
  let data = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => { req.rawBody = data; next(); });
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

async function handleStripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    webhookLog.error({ err }, "Invalid webhook signature");
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type !== "checkout.session.completed") {
    return res.json({ received: true });
  }

  const session     = event.data.object;
  const amountCents = session.amount_total;
  const email       = session.customer_details?.email;

  // client_reference_id carries the MetaMask address set at checkout creation
  const clientWallet = session.client_reference_id ?? null;

  if (amountCents !== FOUNDING_100_PRICE_CENTS) {
    return res.json({ received: true });
  }

  if (!clientWallet || !ethers.isAddress(clientWallet)) {
    webhookLog.warn({ sessionId: session.id, email }, "Missing or invalid client wallet");
    // Still record the payment — can be manually reconciled
    db.prepare(`
      INSERT OR IGNORE INTO escrow_records
        (stripe_session_id, client_email, amount_cents, status)
      VALUES (?, ?, ?, 'pending_wallet')
    `).run(session.id, email, amountCents);
    return res.json({ received: true });
  }

  // Idempotency guard
  const existing = db.prepare(
    `SELECT status FROM escrow_records WHERE stripe_session_id = ?`
  ).get(session.id);
  if (existing && existing.status !== "pending_wallet") {
    return res.json({ received: true });
  }

  try {
    await relayPaymentToEscrow(clientWallet, email, session.id);

    // Send payment confirmation email (fire-and-forget, don't block webhook response)
    if (email) {
      sendPaymentConfirmedEmail(email, "stripe").catch((err) =>
        webhookLog.error({ err, email }, "Payment confirmation email failed")
      );
    }
  } catch (err) {
    webhookLog.error({ err, sessionId: session.id, email }, "On-chain relay failed");

    // Record the failure with pending_retry status
    db.prepare(`
      INSERT OR IGNORE INTO escrow_records
        (stripe_session_id, client_email, client_wallet, amount_cents, status)
      VALUES (?, ?, ?, ?, 'pending_retry')
    `).run(session.id, email, clientWallet, amountCents);

    // Queue for retry with full event payload
    retryQueue.queueForRetry(event.type, {
      sessionId: session.id,
      clientWallet,
      email,
      amountCents,
    }, err.message || "Unknown error");
  }

  res.json({ received: true });
}

// ─── Retry processing ─────────────────────────────────────────────────────────

/**
 * Process a single retry attempt from the queue.
 * Called by the internal retry processor endpoint.
 *
 * @param {object} retry - Retry record from webhook_retries table
 * @returns {{ success: boolean, error?: string }}
 */
async function processRetry(retry) {
  const payload = JSON.parse(retry.payload);
  const { sessionId, clientWallet, email } = payload;

  webhookLog.info(
    { retryId: retry.id, sessionId, attempt: retry.attempts },
    "Processing webhook retry"
  );

  try {
    await relayPaymentToEscrow(clientWallet, email, sessionId);

    // Mark retry as completed
    retryQueue.markCompleted(retry.id);

    // Send payment confirmation email (fire-and-forget)
    if (email) {
      sendPaymentConfirmedEmail(email, "stripe").catch((err) =>
        webhookLog.error({ err, email }, "Payment confirmation email failed")
      );
    }

    return { success: true };
  } catch (err) {
    const errorMessage = err.message || "Unknown error";
    webhookLog.error(
      { err, retryId: retry.id, sessionId, attempt: retry.attempts },
      "Retry attempt failed"
    );

    // Schedule next retry or mark as permanently failed
    const scheduled = retryQueue.scheduleNextRetry(retry.id, retry.attempts, errorMessage);

    if (!scheduled) {
      // Max retries exhausted — update escrow record to relay_failed
      db.prepare(`
        UPDATE escrow_records
        SET status = 'relay_failed'
        WHERE stripe_session_id = ? AND status = 'pending_retry'
      `).run(sessionId);

      webhookLog.error(
        { retryId: retry.id, sessionId, email },
        "All retries exhausted - marked as relay_failed"
      );
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Process all pending retries that are due.
 * Called by POST /api/internal/process-retries
 *
 * @param {number} limit - Max retries to process in one batch
 * @returns {{ processed: number, succeeded: number, failed: number, results: Array }}
 */
async function processPendingRetries(limit = 10) {
  const pendingRetries = retryQueue.getPendingRetries(limit);

  if (pendingRetries.length === 0) {
    webhookLog.debug("No pending retries to process");
    return { processed: 0, succeeded: 0, failed: 0, results: [] };
  }

  webhookLog.info({ count: pendingRetries.length }, "Processing pending retries");

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (const retry of pendingRetries) {
    const result = await processRetry(retry);
    results.push({ retryId: retry.id, ...result });

    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  // Cleanup old completed/failed retries periodically (1% chance per batch)
  if (Math.random() < 0.01) {
    retryQueue.cleanupOldRetries();
  }

  return {
    processed: pendingRetries.length,
    succeeded,
    failed,
    results,
  };
}

module.exports = {
  handleStripeWebhook,
  rawBodyMiddleware,
  relayPaymentToEscrow,
  releasePayment,
  processRetry,
  processPendingRetries,
};
