"use strict";

/**
 * nova.js routes  —  MVP v2
 * No Privy. Identified by email (supplied by frontend after Stripe success).
 */

const express = require("express");
const Stripe  = require("stripe");
const db      = require("../db/sqlite");
const { nova: log } = require("../lib/logger");
const { processClientMessage } = require("../agents/novaBrain");
const { releasePayment }       = require("../services/paymentRelay");
const { sendPaymentConfirmedEmail, sendKitDeliveredEmail } = require("../services/email");

const router = express.Router();

const FOUNDING_100_CAP    = 100;
const FOUNDING_100_CENTS  = 999;

let _stripe;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// ─── GET /api/nova/scarcity — public ─────────────────────────────────────────

router.get("/scarcity", (_req, res) => {
  const row = db.prepare(`SELECT claimed FROM scarcity WHERE id = 1`).get();
  const claimed   = row?.claimed ?? 0;
  const remaining = Math.max(0, FOUNDING_100_CAP - claimed);
  res.json({ remaining, claimed, cap: FOUNDING_100_CAP });
});

// ─── POST /api/nova/checkout — create Stripe session ─────────────────────────
// client_reference_id = the user's MetaMask address (provided by frontend)

router.post("/checkout", async (req, res) => {
  const { walletAddress, email } = req.body;

  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "valid walletAddress required" });
  }

  const { claimed } = db.prepare(`SELECT claimed FROM scarcity WHERE id = 1`).get();
  if (claimed >= FOUNDING_100_CAP) {
    return res.status(410).json({ error: "sold_out" });
  }

  log.info({ wallet: walletAddress, email: email || null }, "Checkout initiated");

  try {
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email || undefined,
      client_reference_id: walletAddress,   // → paymentRelay uses this for lock()
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: FOUNDING_100_CENTS,
          product_data: {
            name: "Nova — Founding 100 Branding Kit",
            description: "One-time premium Instagram branding kit by Nova AI.",
          },
        },
        quantity: 1,
      }],
      // email param lets the dashboard poll /api/nova/status immediately on landing.
      success_url: `${process.env.FRONTEND_URL}/nova/dashboard?email=${encodeURIComponent(email || "")}`,
      cancel_url:  `${process.env.FRONTEND_URL}/nova?payment=cancelled`,
    });

    log.info({ sessionId: session.id, wallet: walletAddress }, "Stripe session created");
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    log.error({ err, wallet: walletAddress }, "Checkout session creation failed");
    res.status(500).json({ error: "Could not create checkout session" });
  }
});

// ─── POST /api/nova/message — Nova chat ──────────────────────────────────────
// Gate: email must have a locked escrow record

router.post("/message", async (req, res) => {
  const { email, message } = req.body;

  if (!email || !message) {
    return res.status(400).json({ error: "email and message required" });
  }

  // Simple payment gate — check SQLite for a locked record
  const paid = db.prepare(
    `SELECT id FROM escrow_records WHERE client_email = ? AND status = 'locked' LIMIT 1`
  ).get(email);

  if (!paid) {
    return res.status(402).json({ error: "payment_required" });
  }

  try {
    const result = await processClientMessage(email, message.trim());

    // Trigger on-chain settlement and send email when kit is delivered for the first time
    if (result.stage === "kit_delivered") {
      const record = db.prepare(
        `SELECT escrow_id FROM escrow_records WHERE client_email = ? AND status = 'locked' LIMIT 1`
      ).get(email);

      if (record?.escrow_id) {
        releasePayment(record.escrow_id, email).catch((err) =>
          log.error({ err, email, escrowId: record.escrow_id }, "Release payment failed")
        );
      }

      // Send kit delivered email (fire-and-forget)
      sendKitDeliveredEmail(email, result.kit || null).catch((err) =>
        log.error({ err, email }, "Kit delivered email failed")
      );
    }

    res.json(result);
  } catch (err) {
    log.error({ err, email }, "Nova message processing failed");
    res.status(500).json({ error: "Nova encountered an error." });
  }
});

// ─── POST /api/nova/verify-payment — direct USDC (wallet) flow ──────────────
// Called by the frontend after the user's wallet lock() tx is confirmed on Base.
// Creates the escrow_record + nova_session so the user can access Nova chat.

router.post("/verify-payment", async (req, res) => {
  const { walletAddress, email, txHash } = req.body;

  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "valid walletAddress required" });
  }
  if (!email) {
    return res.status(400).json({ error: "email required" });
  }
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: "valid txHash required" });
  }

  // Idempotency — already processed this tx?
  const existing = db.prepare(
    `SELECT id FROM escrow_records WHERE stripe_session_id = ?`
  ).get(txHash);

  if (existing) {
    return res.json({ ok: true, message: "already verified" });
  }

  // Verify scarcity
  const { claimed } = db.prepare(`SELECT claimed FROM scarcity WHERE id = 1`).get();
  if (claimed >= FOUNDING_100_CAP) {
    return res.status(410).json({ error: "sold_out" });
  }

  try {
    // Insert escrow record (use txHash as stripe_session_id for idempotency)
    db.prepare(`
      INSERT INTO escrow_records (stripe_session_id, client_email, client_wallet, tx_hash, amount_cents, status)
      VALUES (?, ?, ?, ?, ?, 'locked')
    `).run(txHash, email, walletAddress, txHash, FOUNDING_100_CENTS);

    // Increment scarcity counter
    db.prepare(`UPDATE scarcity SET claimed = claimed + 1 WHERE id = 1`).run();

    // Create Nova session
    db.prepare(`
      INSERT OR IGNORE INTO nova_sessions (client_email) VALUES (?)
    `).run(email);

    log.info({ email, wallet: walletAddress, txHash }, "Wallet payment verified");

    // Send payment confirmation email (fire-and-forget)
    sendPaymentConfirmedEmail(email, "crypto").catch((err) =>
      log.error({ err, email }, "Payment confirmation email failed")
    );

    res.json({ ok: true });
  } catch (err) {
    log.error({ err, email, wallet: walletAddress }, "Payment verification failed");
    res.status(500).json({ error: "Could not verify payment" });
  }
});

// ─── POST /api/nova/deliver-kit — admin endpoint to deliver kit + release escrow ───

router.post("/deliver-kit", async (req, res) => {
  // Admin API key auth
  const adminKey = req.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { email, kit } = req.body;

  if (!email) {
    return res.status(400).json({ error: "email required" });
  }
  if (!kit || typeof kit !== "object") {
    return res.status(400).json({ error: "kit (JSON object) required" });
  }

  // Check session exists
  const session = db.prepare(
    `SELECT id FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  // Update nova_sessions with kit delivery
  db.prepare(`
    UPDATE nova_sessions
    SET branding_kit = ?, delivery_status = 'delivered', stage = 'kit_delivered', updated_at = CURRENT_TIMESTAMP
    WHERE client_email = ?
  `).run(JSON.stringify(kit), email);

  log.info({ email }, "Kit delivered");

  // Release escrow payment
  let released = false;
  const record = db.prepare(
    `SELECT escrow_id FROM escrow_records WHERE client_email = ? AND status = 'locked' LIMIT 1`
  ).get(email);

  if (record?.escrow_id) {
    try {
      await releasePayment(record.escrow_id, email);
      released = true;
      log.info({ email, escrowId: record.escrow_id }, "Escrow released");
    } catch (err) {
      log.error({ err, email, escrowId: record.escrow_id }, "Escrow release failed");
    }
  } else {
    log.warn({ email }, "No locked escrow found for kit delivery");
  }

  // Send kit delivered notification email (fire-and-forget)
  sendKitDeliveredEmail(email, kit).catch((err) =>
    log.error({ err, email }, "Kit delivery email failed")
  );

  res.json({ success: true, released });
});

// ─── GET /api/nova/status ─────────────────────────────────────────────────────

router.get("/status", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "email required" });

  const session = db.prepare(
    `SELECT stage, language, business_type, vibe_tags, brand_description, delivery_status, branding_kit FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  if (!session) return res.json({ stage: "not_started" });

  res.json({
    stage: session.stage,
    language: session.language || "en",
    businessType: session.business_type,
    vibeTags: session.vibe_tags ? JSON.parse(session.vibe_tags) : null,
    brandDescription: session.brand_description,
    deliveryStatus: session.delivery_status,
    kit: session.branding_kit ? JSON.parse(session.branding_kit) : null,
  });
});

module.exports = router;
