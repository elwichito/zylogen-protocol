"use strict";

/**
 * nova.js routes  —  MVP v2
 * No Privy. Identified by email (supplied by frontend after Stripe success).
 */

const express = require("express");
const Stripe  = require("stripe");
const db      = require("../db/sqlite");
const { nova: log } = require("../lib/logger");
const { processClientMessage, chatWithNova, handleSupportQuestion, getPlatformStats } = require("../agents/novaBrain");
const { releasePayment }       = require("../services/paymentRelay");
const { sendPaymentConfirmedEmail, sendKitDeliveredEmail } = require("../services/email");
const { generateAndSaveKit, markKitDelivered } = require("../services/kitGenerator");
const { getZylScoreResponse, invalidateTodayCache } = require("../services/zylScore");
const {
  foundingSlotsRemaining,
  getActiveSubscription,
  hasActiveAccess,
} = require("../services/subscriptions");
const { requireWallet } = require("../middleware/auth");

const router = express.Router();

const FOUNDING_100_CAP    = 100;
const FOUNDING_100_CENTS  = 999;
const crypto = require("crypto");

// Generate a unique referral code (8 chars, alphanumeric uppercase)
function generateReferralCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

let _stripe;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// ─── GET /api/nova/scarcity — public ─────────────────────────────────────────
// Counts founding subscription slots remaining (1 of 100 cap).

router.get("/scarcity", (_req, res) => {
  res.json(foundingSlotsRemaining());
});

// ─── GET /api/zyl-score — public ZYL Score endpoint ─────────────────────────

router.get("/zyl-score", (_req, res) => {
  try {
    const scoreData = getZylScoreResponse();
    res.json(scoreData);
  } catch (err) {
    log.error({ err }, "ZYL Score fetch failed");
    res.status(500).json({ error: "Could not fetch ZYL Score" });
  }
});

// ─── POST /api/nova/support — public customer support chat ───────────────────
// No auth required — anyone can ask questions about Zylogen Protocol

router.post("/support", async (req, res) => {
  const { message, lang } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message required" });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: "message too long (max 1000 chars)" });
  }

  try {
    const result = await handleSupportQuestion(message.trim(), lang);
    res.json(result);
  } catch (err) {
    log.error({ err }, "Support chat failed");
    res.status(500).json({ error: "Nova encountered an error. Please try again." });
  }
});

// ─── GET /api/nova/stats — public platform stats ─────────────────────────────

router.get("/stats", (_req, res) => {
  try {
    const stats = getPlatformStats();
    res.json(stats);
  } catch (err) {
    log.error({ err }, "Stats fetch failed");
    res.status(500).json({ error: "Could not fetch stats" });
  }
});

// ─── POST /api/nova/subscribe — Stripe Checkout (subscription mode) ─────────
// Open endpoint (no auth) — the wallet is the only link between this
// unauthenticated payment and the authenticated session created afterward.
// The dashboard cookie-signs the same wallet to unlock chat.

router.post("/subscribe", async (req, res) => {
  const { walletAddress, email } = req.body ?? {};

  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "valid walletAddress required" });
  }

  const slots = foundingSlotsRemaining();
  const useFounding = slots.remaining > 0;
  const priceId = useFounding
    ? process.env.STRIPE_PRICE_FOUNDING
    : process.env.STRIPE_PRICE_REGULAR;

  if (!priceId) {
    log.error({ useFounding }, "Stripe price id not configured");
    return res.status(500).json({ error: "billing_misconfigured" });
  }

  log.info({ wallet: walletAddress, email: email || null, useFounding }, "Subscribe initiated");

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email || undefined,
      client_reference_id: walletAddress,
      line_items: [{ price: priceId, quantity: 1 }],
      // Propagate the tier to the resulting Subscription so the webhook can
      // decide whether to claim a founding slot.
      subscription_data: {
        metadata: { tier: useFounding ? "founding" : "regular", wallet: walletAddress },
      },
      allow_promotion_codes: true,
      success_url: `${process.env.FRONTEND_URL}/nova/dashboard?subscribed=1`,
      cancel_url:  `${process.env.FRONTEND_URL}/nova?payment=cancelled`,
    });

    log.info({ sessionId: session.id, wallet: walletAddress }, "Stripe subscription session created");
    res.json({ checkoutUrl: session.url, tier: useFounding ? "founding" : "regular" });
  } catch (err) {
    log.error({ err, wallet: walletAddress }, "Subscribe session creation failed");
    res.status(500).json({ error: "Could not create subscription session" });
  }
});

// ─── POST /api/nova/billing-portal ──────────────────────────────────────────
// Returns a Stripe Customer Portal URL so the user can cancel, update
// card, view invoices — Stripe handles the UI, we don't.

router.post("/billing-portal", requireWallet, async (req, res) => {
  const sub = getActiveSubscription(req.wallet);
  if (!sub?.stripe_customer_id) {
    return res.status(404).json({ error: "no_subscription" });
  }
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/nova/dashboard`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    log.error({ err, wallet: req.wallet }, "Billing portal creation failed");
    res.status(500).json({ error: "Could not open billing portal" });
  }
});

// ─── GET /api/nova/subscription/status ──────────────────────────────────────
// Returns the wallet's current subscription state. Authed.

router.get("/subscription/status", requireWallet, (req, res) => {
  const sub = getActiveSubscription(req.wallet);
  if (!sub) return res.json({ active: false, foundingMember: false });

  res.json({
    active: hasActiveAccess(req.wallet),
    status: sub.status,
    foundingMember: !!sub.founding_member,
    source: sub.source,
    currentPeriodEnd: sub.current_period_end,
    canceledAt: sub.canceled_at,
  });
});

// ─── GET /api/nova/history ──────────────────────────────────────────────────
// Returns the wallet's chat history (oldest first), capped to last 200 turns.

router.get("/history", requireWallet, (req, res) => {
  const rows = db.prepare(
    `SELECT role, text, created_at
       FROM nova_messages
      WHERE wallet = ?
      ORDER BY created_at DESC
      LIMIT 200`
  ).all(req.wallet).reverse();
  res.json({ messages: rows });
});

// ─── POST /api/nova/message ─────────────────────────────────────────────────
// Authed. Gated by active subscription. Persists both turns to nova_messages.

router.post("/message", requireWallet, async (req, res) => {
  const { message } = req.body ?? {};

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message required" });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: "message too long (max 4000 chars)" });
  }

  if (!hasActiveAccess(req.wallet)) {
    return res.status(402).json({ error: "subscription_required" });
  }

  // Load recent history from DB (last 20 turns) so the LLM has context.
  // Map our schema to the {role: 'user'|'assistant', content} shape chatWithNova expects.
  const recent = db.prepare(
    `SELECT role, text FROM nova_messages
      WHERE wallet = ?
      ORDER BY created_at DESC
      LIMIT 20`
  ).all(req.wallet).reverse();

  const history = recent.map((r) => ({
    role:    r.role === "nova" ? "assistant" : "user",
    content: r.text,
  }));

  const userText = message.trim();

  // Persist user turn before calling Claude, so a crash mid-call doesn't
  // lose their input.
  db.prepare(
    `INSERT INTO nova_messages (wallet, role, text) VALUES (?, 'user', ?)`
  ).run(req.wallet, userText);

  try {
    const reply = await chatWithNova(req.wallet, userText, history);
    db.prepare(
      `INSERT INTO nova_messages (wallet, role, text) VALUES (?, 'nova', ?)`
    ).run(req.wallet, reply);
    res.json({ reply });
  } catch (err) {
    log.error({ err, wallet: req.wallet }, "Nova message processing failed");
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

    // Generate unique referral code for new user
    let referralCode = generateReferralCode();
    let attempts = 0;
    while (attempts < 10) {
      const exists = db.prepare(`SELECT id FROM nova_sessions WHERE referral_code = ?`).get(referralCode);
      if (!exists) break;
      referralCode = generateReferralCode();
      attempts++;
    }

    // Check for pending referral (someone referred this user)
    const pendingReferral = db.prepare(
      `SELECT referrer_email FROM referrals WHERE referee_email = ? AND status = 'pending'`
    ).get(email);

    // Create Nova session with referral code
    db.prepare(`
      INSERT OR IGNORE INTO nova_sessions (client_email, referral_code, referred_by) VALUES (?, ?, ?)
    `).run(email, referralCode, pendingReferral?.referrer_email || null);

    // If there was a pending referral, convert it and increment referrer's count
    if (pendingReferral) {
      db.prepare(`
        UPDATE referrals SET status = 'converted', converted_at = CURRENT_TIMESTAMP
        WHERE referee_email = ? AND status = 'pending'
      `).run(email);

      db.prepare(`
        UPDATE nova_sessions SET referral_count = referral_count + 1
        WHERE client_email = ?
      `).run(pendingReferral.referrer_email);

      log.info({ referrer: pendingReferral.referrer_email, referee: email }, "Referral converted");
    }

    log.info({ email, wallet: walletAddress, txHash, referralCode }, "Wallet payment verified");

    // Invalidate ZYL Score cache (new order affects score)
    invalidateTodayCache();

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
    `SELECT stage, language, business_type, vibe_tags, brand_description, delivery_status, branding_kit, referral_code, referral_count, referred_by FROM nova_sessions WHERE client_email = ?`
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
    referralCode: session.referral_code,
    referralCount: session.referral_count || 0,
    wasReferred: !!session.referred_by,
  });
});

// ─── POST /api/nova/admin/generate-kit — manually trigger kit generation ──────

router.post("/admin/generate-kit", async (req, res) => {
  // Admin API key auth
  const adminKey = req.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { email, deliver } = req.body;

  if (!email) {
    return res.status(400).json({ error: "email required" });
  }

  // Check session exists and has briefing data
  const session = db.prepare(
    `SELECT stage, business_type, brand_description FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  if (!session.business_type || !session.brand_description) {
    return res.status(400).json({ error: "briefing incomplete - need business_type and brand_description" });
  }

  try {
    log.info({ email, deliver }, "Admin triggered kit generation");

    const kit = await generateAndSaveKit(email);

    // Optionally mark as delivered immediately
    if (deliver) {
      markKitDelivered(email, kit);

      // Trigger on-chain settlement
      const record = db.prepare(
        `SELECT escrow_id FROM escrow_records WHERE client_email = ? AND status = 'locked' LIMIT 1`
      ).get(email);

      if (record?.escrow_id) {
        releasePayment(record.escrow_id, email).catch((err) =>
          log.error({ err, email, escrowId: record.escrow_id }, "Release payment failed")
        );
      }

      // Send kit delivered email
      sendKitDeliveredEmail(email, kit).catch((err) =>
        log.error({ err, email }, "Kit delivered email failed")
      );
    }

    res.json({ success: true, delivered: !!deliver, kit });
  } catch (err) {
    log.error({ err, email }, "Admin kit generation failed");
    res.status(500).json({ error: err.message || "Kit generation failed" });
  }
});

// ─── GET /api/nova/admin/orders — list all orders for admin ───────────────────

router.get("/admin/orders", (req, res) => {
  // Admin API key auth
  const adminKey = req.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    // Get all nova_sessions with their escrow_records
    const orders = db.prepare(`
      SELECT
        ns.id,
        ns.client_email AS email,
        er.client_wallet AS wallet,
        ns.stage,
        ns.delivery_status,
        ns.branding_kit,
        ns.created_at,
        er.status AS escrow_status,
        er.tx_hash,
        er.amount_cents
      FROM nova_sessions ns
      LEFT JOIN escrow_records er ON er.client_email = ns.client_email
      ORDER BY ns.created_at DESC
    `).all();

    // Parse branding_kit JSON for each order
    const parsed = orders.map((o) => ({
      ...o,
      branding_kit: o.branding_kit ? JSON.parse(o.branding_kit) : null,
    }));

    log.info({ count: parsed.length }, "Admin orders fetched");
    res.json({ orders: parsed });
  } catch (err) {
    log.error({ err }, "Admin orders fetch failed");
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// ─── GET /api/nova/referral/:code — validate referral code ───────────────────

router.get("/referral/:code", (req, res) => {
  const { code } = req.params;

  if (!code || code.length !== 8) {
    return res.status(400).json({ error: "invalid referral code" });
  }

  const session = db.prepare(
    `SELECT client_email, referral_count FROM nova_sessions WHERE referral_code = ?`
  ).get(code.toUpperCase());

  if (!session) {
    return res.status(404).json({ error: "referral code not found", valid: false });
  }

  // Don't expose full email, just confirm valid
  const maskedEmail = session.client_email.replace(/(.{2})(.*)(@.*)/, "$1***$3");

  res.json({
    valid: true,
    referrerHint: maskedEmail,
    referralCount: session.referral_count || 0,
  });
});

// ─── POST /api/nova/apply-referral — link referee to referrer ────────────────

router.post("/apply-referral", (req, res) => {
  const { email, referralCode } = req.body;

  if (!email) {
    return res.status(400).json({ error: "email required" });
  }
  if (!referralCode || referralCode.length !== 8) {
    return res.status(400).json({ error: "invalid referral code" });
  }

  const code = referralCode.toUpperCase();

  // Find referrer by code
  const referrer = db.prepare(
    `SELECT client_email FROM nova_sessions WHERE referral_code = ?`
  ).get(code);

  if (!referrer) {
    return res.status(404).json({ error: "referral code not found" });
  }

  // Don't allow self-referral
  if (referrer.client_email.toLowerCase() === email.toLowerCase()) {
    return res.status(400).json({ error: "cannot refer yourself" });
  }

  // Check if referee already exists and has a referrer
  const existingSession = db.prepare(
    `SELECT referred_by FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  if (existingSession?.referred_by) {
    return res.json({ ok: true, message: "already referred", alreadyReferred: true });
  }

  // Check if referral already recorded
  const existingReferral = db.prepare(
    `SELECT id FROM referrals WHERE referee_email = ?`
  ).get(email);

  if (existingReferral) {
    return res.json({ ok: true, message: "referral already recorded" });
  }

  try {
    // Record the referral (pending until referee completes purchase)
    db.prepare(`
      INSERT INTO referrals (referrer_email, referee_email, status)
      VALUES (?, ?, 'pending')
    `).run(referrer.client_email, email);

    log.info({ referrer: referrer.client_email, referee: email, code }, "Referral applied");

    res.json({ ok: true, referrerEmail: referrer.client_email });
  } catch (err) {
    // Handle unique constraint violation gracefully
    if (err.code === "SQLITE_CONSTRAINT") {
      return res.json({ ok: true, message: "referral already recorded" });
    }
    log.error({ err, email, code }, "Apply referral failed");
    res.status(500).json({ error: "Could not apply referral" });
  }
});

// ─── GET /api/nova/my-referrals — get user's referral stats ──────────────────

router.get("/my-referrals", (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "email required" });
  }

  const session = db.prepare(
    `SELECT referral_code, referral_count FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  // Get detailed referral list
  const referrals = db.prepare(`
    SELECT referee_email, status, created_at, converted_at
    FROM referrals
    WHERE referrer_email = ?
    ORDER BY created_at DESC
  `).all(email);

  // Mask emails for privacy
  const maskedReferrals = referrals.map((r) => ({
    email: r.referee_email.replace(/(.{2})(.*)(@.*)/, "$1***$3"),
    status: r.status,
    createdAt: r.created_at,
    convertedAt: r.converted_at,
  }));

  res.json({
    referralCode: session.referral_code,
    referralCount: session.referral_count || 0,
    referrals: maskedReferrals,
  });
});

module.exports = router;
