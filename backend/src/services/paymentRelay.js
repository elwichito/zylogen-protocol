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
 * Contract: TaskEscrow @ 0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f (Base Mainnet)
 * KNOWN BLOCKER: Relayer wallet needs ETH for gas before this can execute on-chain.
 *
 * NOTE: lock() ABI below assumes the deployed interface — adjust if your
 * actual function signature differs (check Basescan for the verified ABI).
 */

const Stripe = require("stripe");
const { ethers } = require("ethers");
const db = require("../db/sqlite");

const FOUNDING_100_PRICE_CENTS = 999; // $9.99

// ─── Lazy Stripe ─────────────────────────────────────────────────────────────

let _stripe;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// ─── Chain config ─────────────────────────────────────────────────────────────

const TASK_ESCROW_ADDRESS = process.env.TASK_ESCROW_ADDRESS
  || "0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f";

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

// TaskEscrow ABI — lock() confirmed by Logen; releaseFunds() matches deployed interface
const ESCROW_ABI = [
  "function lock(address client, uint256 amount) external returns (uint256 taskId)",
  "function releaseFunds(uint256 escrowId, address worker) external",
  "event Locked(uint256 indexed taskId, address indexed client, uint256 amount)",
];

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

    console.log(`[paymentRelay] DRY RUN — wrote mock record taskId=${mockTaskId}`);
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
    console.log(`[paymentRelay] USDC approved for ${TASK_ESCROW_ADDRESS}`);
  }

  // 2. Call lock()
  const tx = await escrow.lock(clientAddress, USDC_LOCK_AMOUNT);
  const receipt = await tx.wait();

  // 3. Parse taskId from Locked event (best-effort — falls back to tx hash)
  const iface = new ethers.Interface(ESCROW_ABI);
  let taskId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "Locked") {
        taskId = parsed.args.taskId.toString();
        break;
      }
    } catch (_) { /* not our event */ }
  }
  // If the deployed contract emits no events, use the tx hash as the task reference
  if (!taskId) taskId = receipt.hash;

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

  console.log(`[paymentRelay] Locked task #${taskId} for ${customerEmail} | tx: ${receipt.hash}`);
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
    console.log(`[paymentRelay] DRY RUN — released escrow ${escrowId} for ${email}`);
    return { released: true, dryRun: true };
  }

  // Skip if escrowId is a tx hash fallback (no on-chain task ID available)
  if (!escrowId || escrowId.startsWith("0x") || escrowId.startsWith("DRY-")) {
    console.warn(`[paymentRelay] releasePayment skipped — escrowId is a tx hash or mock: ${escrowId}`);
    db.prepare(`
      UPDATE escrow_records SET status = 'released' WHERE client_email = ? AND escrow_id = ?
    `).run(email, escrowId);
    return { released: true, skippedOnChain: true };
  }

  const relayer = getRelayer();
  const escrow  = new ethers.Contract(TASK_ESCROW_ADDRESS, ESCROW_ABI, relayer);

  const tx      = await escrow.releaseFunds(BigInt(escrowId), relayer.address);
  const receipt = await tx.wait();

  db.prepare(`
    UPDATE escrow_records SET status = 'released' WHERE client_email = ? AND escrow_id = ?
  `).run(email, escrowId);

  console.log(`[paymentRelay] Released escrow #${escrowId} for ${email} | tx: ${receipt.hash}`);
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
    console.error("[paymentRelay] Bad webhook signature:", err.message);
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
    console.warn(`[paymentRelay] Missing or invalid client wallet in session ${session.id}`);
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
  } catch (err) {
    console.error("[paymentRelay] on-chain relay failed:", err.message);
    // Record the failure for manual retry — do NOT let Stripe retry (return 200)
    db.prepare(`
      INSERT OR IGNORE INTO escrow_records
        (stripe_session_id, client_email, client_wallet, amount_cents, status)
      VALUES (?, ?, ?, ?, 'relay_failed')
    `).run(session.id, email, clientWallet, amountCents);
  }

  res.json({ received: true });
}

module.exports = { handleStripeWebhook, rawBodyMiddleware, relayPaymentToEscrow, releasePayment };
