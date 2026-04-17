"use strict";

/**
 * nova.js routes  —  MVP v2
 * No Privy. Identified by email (supplied by frontend after Stripe success).
 */

const express = require("express");
const Stripe  = require("stripe");
const db      = require("../db/sqlite");
const { processClientMessage } = require("../agents/novaBrain");
const { releasePayment }       = require("../services/paymentRelay");

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

  console.log(`[nova/checkout] Incoming → wallet=${walletAddress} email=${email || "(none)"}`);

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

    console.log(`[nova/checkout] STRIPE_HANDSHAKE_SUCCESS — session=${session.id} client_reference_id=${walletAddress} → ${session.url.split("?")[0]}`);
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("[nova/checkout]", err);
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

    // Trigger on-chain settlement when kit is delivered for the first time
    if (result.stage === "kit_delivered") {
      const record = db.prepare(
        `SELECT escrow_id FROM escrow_records WHERE client_email = ? AND status = 'locked' LIMIT 1`
      ).get(email);

      if (record?.escrow_id) {
        releasePayment(record.escrow_id, email).catch((err) =>
          console.error("[nova/message] releasePayment failed:", err.message)
        );
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[nova/message]", err);
    res.status(500).json({ error: "Nova encountered an error." });
  }
});

// ─── GET /api/nova/status ─────────────────────────────────────────────────────

router.get("/status", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "email required" });

  const session = db.prepare(
    `SELECT stage, branding_kit FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  if (!session) return res.json({ stage: "not_started" });
  res.json({ stage: session.stage, kit: session.branding_kit ? JSON.parse(session.branding_kit) : null });
});

module.exports = router;
