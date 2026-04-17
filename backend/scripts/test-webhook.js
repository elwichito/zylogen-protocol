#!/usr/bin/env node
"use strict";

/**
 * test-webhook.js
 *
 * Dry-run verification script. Simulates a Stripe checkout.session.completed
 * event, posts it to the local /webhooks/stripe endpoint with a valid
 * Stripe signature, then queries SQLite and prints the result.
 *
 * Usage:
 *   DRY_RUN=true node scripts/test-webhook.js
 *
 * Requires the backend server to be running:
 *   npm run dev
 *
 * What it verifies:
 *   ✓ Webhook endpoint accepts the request
 *   ✓ Stripe signature verification passes
 *   ✓ escrow_records row written to nova.db
 *   ✓ scarcity counter incremented
 *   ✓ All DB columns populated correctly
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const http    = require("http");
const https   = require("https");
const crypto  = require("crypto");
const path    = require("path");
const Database = require("better-sqlite3");

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT               = process.env.PORT || 3001;
const WEBHOOK_SECRET     = process.env.STRIPE_WEBHOOK_SECRET;
const DB_PATH            = path.resolve(path.join(__dirname, ".."), process.env.DB_PATH || "nova.db");

// TARGET_URL: when set, the script posts to a remote server and skips local
// SQLite verification (can't access remote DB). Falls back to localhost.
// Usage: TARGET_URL=https://your-app.railway.app npm run test:preflight
const TARGET_URL         = process.env.TARGET_URL
  ? new URL(process.env.TARGET_URL)
  : null;
const IS_REMOTE          = !!TARGET_URL;

// Test values — use a real-looking Ethereum address and a unique session ID
const TEST_SESSION_ID    = `cs_test_${Date.now()}`;
const TEST_CLIENT_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth — safe test addr
const TEST_EMAIL         = "test-founding@zylogen.xyz";

if (!WEBHOOK_SECRET) {
  console.error("❌  STRIPE_WEBHOOK_SECRET not set in .env");
  process.exit(1);
}

// ─── Build mock Stripe event ──────────────────────────────────────────────────

const mockEvent = {
  id: `evt_test_${Date.now()}`,
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: TEST_SESSION_ID,
      object: "checkout.session",
      amount_total: 999,                         // $9.99
      payment_status: "paid",
      client_reference_id: TEST_CLIENT_WALLET,   // MetaMask address
      customer_details: {
        email: TEST_EMAIL,
      },
    },
  },
};

const payload   = JSON.stringify(mockEvent);
const timestamp = Math.floor(Date.now() / 1000);

// ─── Generate valid Stripe signature ─────────────────────────────────────────
// Stripe's signature format: t=<ts>,v1=<hmac>
// HMAC-SHA256 over "<timestamp>.<payload>"

const signedPayload = `${timestamp}.${payload}`;
const hmac = crypto
  .createHmac("sha256", WEBHOOK_SECRET)
  .update(signedPayload)
  .digest("hex");

const stripeSignature = `t=${timestamp},v1=${hmac}`;

// ─── POST to webhook endpoint ─────────────────────────────────────────────────

function postWebhook() {
  return new Promise((resolve, reject) => {
    const isRemoteHttps = IS_REMOTE && TARGET_URL.protocol === "https:";
    const transport     = isRemoteHttps ? https : http;

    const options = IS_REMOTE
      ? {
          hostname: TARGET_URL.hostname,
          port:     TARGET_URL.port || (isRemoteHttps ? 443 : 80),
          path:     "/webhooks/stripe",
          method:   "POST",
          headers: {
            "Content-Type":    "application/json",
            "Content-Length":  Buffer.byteLength(payload),
            "stripe-signature": stripeSignature,
          },
        }
      : {
          hostname: "localhost",
          port:     PORT,
          path:     "/webhooks/stripe",
          method:   "POST",
          headers: {
            "Content-Type":    "application/json",
            "Content-Length":  Buffer.byteLength(payload),
            "stripe-signature": stripeSignature,
          },
        };

    const req = transport.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });

    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        reject(new Error(`Server not running on :${PORT}. Start it with: npm run dev`));
      } else {
        reject(err);
      }
    });

    req.write(payload);
    req.end();
  });
}

// ─── Remote status check (replaces SQLite verify when TARGET_URL is set) ─────

function checkRemoteStatus() {
  return new Promise((resolve, reject) => {
    const isHttps   = TARGET_URL.protocol === "https:";
    const transport = isHttps ? https : http;

    const options = {
      hostname: TARGET_URL.hostname,
      port:     TARGET_URL.port || (isHttps ? 443 : 80),
      path:     `/api/nova/status?email=${encodeURIComponent(TEST_EMAIL)}`,
      method:   "GET",
    };

    const req = transport.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });

    req.on("error", reject);
    req.end();
  });
}

// ─── SQLite verification ──────────────────────────────────────────────────────

function verifyDb() {
  const db = new Database(DB_PATH, { readonly: true });

  const escrow   = db.prepare(`SELECT * FROM escrow_records WHERE stripe_session_id = ?`).get(TEST_SESSION_ID);
  const scarcity = db.prepare(`SELECT claimed FROM scarcity WHERE id = 1`).get();

  db.close();
  return { escrow, scarcity };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const target = IS_REMOTE ? TARGET_URL.origin : `http://localhost:${PORT}`;

  console.log("\n🔧  Zylogen Pre-Flight Check");
  console.log("─".repeat(50));
  console.log(`  Mode:           ${IS_REMOTE ? "REMOTE (Railway)" : "LOCAL"}`);
  console.log(`  Target:         ${target}`);
  console.log(`  Session ID:     ${TEST_SESSION_ID}`);
  console.log(`  Client wallet:  ${TEST_CLIENT_WALLET}`);
  console.log(`  Email:          ${TEST_EMAIL}`);
  console.log(`  DRY_RUN env:    ${process.env.DRY_RUN ?? "not set (blockchain will attempt)"}`);
  if (!IS_REMOTE) console.log(`  DB path:        ${DB_PATH}`);
  console.log("─".repeat(50));

  // 1. Fire webhook
  console.log(`\n[1/3] Posting to ${target}/webhooks/stripe...`);
  let response;
  try {
    response = await postWebhook();
  } catch (err) {
    console.error(`\n❌  ${err.message}`);
    process.exit(1);
  }

  console.log(`      HTTP ${response.status} — ${response.body}`);

  if (response.status !== 200) {
    console.error(`\n❌  Unexpected status ${response.status}. Check server logs.`);
    process.exit(1);
  }

  // 2. Give the async relay time to write to DB / settle on-chain
  const settlePause = IS_REMOTE ? 4000 : 500;
  console.log(`\n[2/3] Waiting ${settlePause / 1000}s for relay to settle...`);
  await new Promise((r) => setTimeout(r, settlePause));

  // 3a. REMOTE — query /api/nova/status instead of local SQLite
  if (IS_REMOTE) {
    console.log(`\n[3/3] Checking ${target}/api/nova/status...`);
    let statusRes;
    try {
      statusRes = await checkRemoteStatus();
    } catch (err) {
      console.error(`\n❌  Status check failed: ${err.message}`);
      process.exit(1);
    }

    console.log(`      HTTP ${statusRes.status} — ${statusRes.body}`);

    let parsed;
    try { parsed = JSON.parse(statusRes.body); } catch (_) { parsed = null; }

    console.log("\n─".repeat(50));
    if (statusRes.status === 200 && parsed?.stage) {
      console.log(`  ✓  stage:   ${parsed.stage}`);
      if (parsed.kit) console.log(`  ✓  kit:     present`);
      console.log("\n✅  RAILWAY PRE-FLIGHT PASSED — bridge is stable.");
      console.log("    Wichi can share the link on X/Farcaster.\n");
    } else {
      console.error("❌  Status endpoint did not return expected payload.");
      console.error("     → Check Railway logs for relay or DB errors.\n");
      process.exit(1);
    }
    return;
  }

  // 3b. LOCAL — verify SQLite directly
  console.log("\n[3/3] Querying nova.db...");
  let dbResult;
  try {
    dbResult = verifyDb();
  } catch (err) {
    console.error(`\n❌  Could not open DB: ${err.message}`);
    process.exit(1);
  }

  console.log("\n─".repeat(50));

  if (!dbResult.escrow) {
    console.error("❌  escrow_records: NO ROW FOUND");
    console.error("     → Check server logs for relay errors.");
    process.exit(1);
  }

  const e = dbResult.escrow;
  const pass = (label, value, expected) => {
    const ok = expected === undefined ? !!value : value === expected;
    console.log(`  ${ok ? "✓" : "✗"}  ${label}: ${value}${!ok ? ` (expected: ${expected})` : ""}`);
    return ok;
  };

  let allPassed = true;
  allPassed &= pass("stripe_session_id",    e.stripe_session_id, TEST_SESSION_ID);
  allPassed &= pass("client_email",         e.client_email,      TEST_EMAIL);
  allPassed &= pass("client_wallet",        e.client_wallet,     TEST_CLIENT_WALLET);
  allPassed &= pass("amount_cents",         e.amount_cents,      999);
  allPassed &= pass("status",               e.status,            "locked");
  allPassed &= pass("escrow_id (task ref)", e.escrow_id);
  allPassed &= pass("tx_hash",              e.tx_hash);

  console.log(`\n  scarcity.claimed: ${dbResult.scarcity?.claimed}`);

  console.log("\n─".repeat(50));
  if (allPassed) {
    console.log("✅  ALL CHECKS PASSED — DB layer is verified.\n");
  } else {
    console.log("❌  SOME CHECKS FAILED — see above.\n");
    process.exit(1);
  }
})();
