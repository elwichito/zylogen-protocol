"use strict";

/**
 * setup-stripe-products.js
 *
 * Run-once script (idempotent) that provisions the two Nova subscription
 * prices in your Stripe account:
 *
 *   - "nova-founding-monthly"  → $9.99/month  (first 100 members)
 *   - "nova-regular-monthly"   → $29.99/month (everyone else)
 *
 * Uses `lookup_key` on prices so a second run finds the existing prices
 * instead of creating duplicates. Prints the IDs to paste into .env:
 *
 *   STRIPE_PRICE_FOUNDING=price_...
 *   STRIPE_PRICE_REGULAR=price_...
 *
 * Run with the Stripe key matching the mode you want to provision in
 * (test mode: sk_test_..., live mode: sk_live_...).
 *
 *   cd backend && node scripts/setup-stripe-products.js
 */

require("dotenv").config();
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const Stripe = require("stripe");

const PRODUCT_NAME        = "Nova — 1:1 AI consultant by Zylogen";
const PRODUCT_DESCRIPTION =
  "Monthly 1:1 chat with Nova: an AI consultant for solo founders on Base. Naming, copy, GTM, and product decisions on demand.";

const FOUNDING_LOOKUP_KEY = "nova-founding-monthly";
const REGULAR_LOOKUP_KEY  = "nova-regular-monthly";

const FOUNDING_AMOUNT_CENTS = 999;   // $9.99
const REGULAR_AMOUNT_CENTS  = 2999;  // $29.99

async function ensureProduct(stripe) {
  // Find by name (Stripe doesn't index products by lookup_key, only prices).
  // We list and match — there should be only one Nova product.
  const list = await stripe.products.list({ limit: 100, active: true });
  const existing = list.data.find((p) => p.name === PRODUCT_NAME);
  if (existing) {
    console.log(`✓ Product exists: ${existing.id}`);
    return existing;
  }
  const created = await stripe.products.create({
    name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
    type: "service",
    metadata: { owner: "zylogen", product: "nova" },
  });
  console.log(`+ Product created: ${created.id}`);
  return created;
}

async function ensurePrice(stripe, product, { lookupKey, amount, nickname }) {
  // lookup_key makes this idempotent
  const list = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (list.data.length > 0) {
    console.log(`✓ Price exists  [${lookupKey}]: ${list.data[0].id}`);
    return list.data[0];
  }
  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    nickname,
    metadata: { tier: lookupKey === FOUNDING_LOOKUP_KEY ? "founding" : "regular" },
  });
  console.log(`+ Price created [${lookupKey}]: ${created.id}`);
  return created;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set. Aborting.");
    process.exit(1);
  }
  const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";
  console.log(`\nStripe mode: ${mode}\n`);

  const stripe = new Stripe(key);
  const product = await ensureProduct(stripe);
  const founding = await ensurePrice(stripe, product, {
    lookupKey: FOUNDING_LOOKUP_KEY,
    amount: FOUNDING_AMOUNT_CENTS,
    nickname: "Nova Founding $9.99/mo",
  });
  const regular = await ensurePrice(stripe, product, {
    lookupKey: REGULAR_LOOKUP_KEY,
    amount: REGULAR_AMOUNT_CENTS,
    nickname: "Nova Regular $29.99/mo",
  });

  console.log("\n──────────────────────────────────────");
  console.log("Add to backend/.env:");
  console.log("──────────────────────────────────────");
  console.log(`STRIPE_PRICE_FOUNDING=${founding.id}`);
  console.log(`STRIPE_PRICE_REGULAR=${regular.id}`);
  console.log("──────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
