"use strict";

/**
 * subscriptions.js — DB layer for the Nova subscription model.
 *
 * Identity is the wallet (lowercase 0x...). At most one 'active' subscription
 * per wallet at any time (partial unique index enforces this in SQLite).
 *
 * Founding slots: capped at 100 lifetime, tracked via the `scarcity` table.
 * `claimFoundingSlot()` is the atomic operation — succeeds only if a slot
 * was available AND was just claimed.
 */

const db = require("../db/sqlite");
const { getAddress } = require("ethers");

const FOUNDING_CAP = 100;

function normalizeWallet(addr) {
  return getAddress(addr);
}

// ─── Founding slot accounting ────────────────────────────────────────────────

/**
 * Atomically claim a founding slot. Returns true if a slot was available and
 * is now reserved, false if all 100 are gone. SQLite's update-with-where is
 * atomic and the row is unique (id=1), so this is race-free.
 */
function claimFoundingSlot() {
  const res = db.prepare(
    `UPDATE scarcity SET claimed = claimed + 1 WHERE id = 1 AND claimed < ?`
  ).run(FOUNDING_CAP);
  return res.changes > 0;
}

function foundingSlotsRemaining() {
  const row = db.prepare(`SELECT claimed FROM scarcity WHERE id = 1`).get();
  const claimed = row?.claimed ?? 0;
  return { remaining: Math.max(0, FOUNDING_CAP - claimed), claimed, cap: FOUNDING_CAP };
}

// ─── Subscription lifecycle ─────────────────────────────────────────────────

/**
 * Inserts a brand-new subscription row. Caller is responsible for claiming
 * a founding slot first if `founding === true`. Throws if the wallet already
 * has an 'active' row (partial unique index).
 */
function insertSubscription({
  walletInput,
  email = null,
  source,
  stripeSubscriptionId = null,
  stripeCustomerId = null,
  status,
  founding = false,
  currentPeriodStart = null,
  currentPeriodEnd = null,
}) {
  const wallet = normalizeWallet(walletInput);

  return db.prepare(`
    INSERT INTO subscriptions (
      wallet, email, source, stripe_subscription_id, stripe_customer_id,
      status, founding_member, current_period_start, current_period_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wallet, email, source, stripeSubscriptionId, stripeCustomerId,
    status, founding ? 1 : 0, currentPeriodStart, currentPeriodEnd
  ).lastInsertRowid;
}

function getActiveSubscription(walletInput) {
  const wallet = normalizeWallet(walletInput);
  return db.prepare(
    `SELECT * FROM subscriptions WHERE wallet = ? AND status = 'active'`
  ).get(wallet) ?? null;
}

function getSubscriptionByStripeId(stripeSubscriptionId) {
  return db.prepare(
    `SELECT * FROM subscriptions WHERE stripe_subscription_id = ?`
  ).get(stripeSubscriptionId) ?? null;
}

function getLatestSubscription(walletInput) {
  const wallet = normalizeWallet(walletInput);
  return db.prepare(
    `SELECT * FROM subscriptions WHERE wallet = ? ORDER BY created_at DESC LIMIT 1`
  ).get(wallet) ?? null;
}

/**
 * Updates status and period bounds for an existing subscription row identified
 * by Stripe ID. Sets updated_at. If status becomes 'canceled', records canceled_at.
 */
function updateSubscriptionByStripeId(stripeSubscriptionId, {
  status,
  currentPeriodStart,
  currentPeriodEnd,
  stripeCustomerId,
} = {}) {
  const fields = ["updated_at = CURRENT_TIMESTAMP"];
  const values = [];

  if (status !== undefined) {
    fields.push("status = ?");
    values.push(status);
    if (status === "canceled") fields.push("canceled_at = CURRENT_TIMESTAMP");
  }
  if (currentPeriodStart !== undefined) {
    fields.push("current_period_start = ?");
    values.push(currentPeriodStart);
  }
  if (currentPeriodEnd !== undefined) {
    fields.push("current_period_end = ?");
    values.push(currentPeriodEnd);
  }
  if (stripeCustomerId !== undefined) {
    fields.push("stripe_customer_id = ?");
    values.push(stripeCustomerId);
  }

  values.push(stripeSubscriptionId);
  const sql = `UPDATE subscriptions SET ${fields.join(", ")} WHERE stripe_subscription_id = ?`;
  return db.prepare(sql).run(...values);
}

/**
 * The gate. Returns true iff:
 *   - wallet has an active subscription
 *   - current_period_end is in the future (NULL is treated as "not yet
 *     provisioned" and rejected — webhook must have set it)
 *
 * As decided 2026-05-19: no grace period. past_due === access cut.
 */
function hasActiveAccess(walletInput) {
  const sub = getActiveSubscription(walletInput);
  if (!sub) return false;
  if (sub.status !== "active") return false;
  if (!sub.current_period_end) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

module.exports = {
  FOUNDING_CAP,
  claimFoundingSlot,
  foundingSlotsRemaining,
  insertSubscription,
  getActiveSubscription,
  getSubscriptionByStripeId,
  getLatestSubscription,
  updateSubscriptionByStripeId,
  hasActiveAccess,
};
