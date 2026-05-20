"use strict";

/**
 * cryptoPayments.js — verify USDC transfers and credit subscription months.
 *
 * Flow (manual monthly model, decided 2026-05-19):
 *   1. User sends USDC.transfer(treasury, amount) on Base mainnet
 *   2. Frontend POSTs the resulting txHash + their wallet to /crypto-verify
 *   3. We read the receipt, scan for a Transfer log matching our criteria,
 *      and — if it's a fresh tx — credit 30 days to that wallet's subscription.
 *
 * The (wallet, treasury, amount, USDC contract, confirmed status) tuple
 * is the proof. UNIQUE(tx_hash) prevents replay.
 */

const { JsonRpcProvider, Interface, getAddress } = require("ethers");
const db = require("../db/sqlite");
const { payment: log } = require("../lib/logger");
const {
  claimFoundingSlot,
  insertSubscription,
  getActiveSubscription,
  updateSubscriptionByStripeId,
} = require("./subscriptions");

const PERIOD_DAYS         = 30;
const ERC20_IFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

let _provider;
function getProvider() {
  if (!_provider) {
    const url = process.env.BASE_RPC_URL || "https://mainnet.base.org";
    _provider = new JsonRpcProvider(url);
  }
  return _provider;
}

function getTreasuryAddress() {
  const addr = process.env.NOVA_TREASURY_ADDRESS || process.env.NOVA_WORKER_ADDRESS;
  if (!addr) throw new Error("NOVA_TREASURY_ADDRESS not configured");
  return getAddress(addr);
}

function getMonthlyAmount() {
  return BigInt(process.env.USDC_MONTHLY_AMOUNT || "9990000");
}

// ─── On-chain verification ──────────────────────────────────────────────────

/**
 * Scans the tx receipt for a USDC Transfer log that matches:
 *   from = the user's wallet
 *   to   = our treasury
 *   value >= USDC_MONTHLY_AMOUNT
 *   token = USDC_ADDRESS (Base mainnet)
 *
 * Returns the matched amount (bigint) on success. Throws on any failure.
 */
async function verifyUsdcTransfer({ walletInput, txHash }) {
  const wallet   = getAddress(walletInput);
  const treasury = getTreasuryAddress();
  const usdcAddr = getAddress(process.env.USDC_ADDRESS);
  const expected = getMonthlyAmount();

  const receipt = await getProvider().getTransactionReceipt(txHash);
  if (!receipt) {
    const err = new Error("tx_not_found");
    err.code = "tx_not_found";
    throw err;
  }
  if (receipt.status !== 1) {
    const err = new Error("tx_reverted");
    err.code = "tx_reverted";
    throw err;
  }

  for (const ev of receipt.logs) {
    if (getAddress(ev.address) !== usdcAddr) continue;

    let parsed;
    try { parsed = ERC20_IFACE.parseLog(ev); } catch { continue; }
    if (!parsed || parsed.name !== "Transfer") continue;

    const from  = getAddress(parsed.args.from);
    const to    = getAddress(parsed.args.to);
    const value = BigInt(parsed.args.value);

    if (from === wallet && to === treasury && value >= expected) {
      return value;
    }
  }

  const err = new Error("no_matching_transfer");
  err.code = "no_matching_transfer";
  throw err;
}

// ─── Period math ────────────────────────────────────────────────────────────

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

function txHashAlreadyRedeemed(txHash) {
  return !!db.prepare(
    `SELECT id FROM crypto_payments WHERE tx_hash = ?`
  ).get(txHash);
}

// Update a crypto-source subscription's period fields. We can't use the
// stripe-id helper because crypto rows have null stripe_subscription_id.
function extendCryptoSubscriptionPeriod(subscriptionId, periodStartIso, periodEndIso) {
  db.prepare(`
    UPDATE subscriptions
       SET status = 'active',
           current_period_start = ?,
           current_period_end   = ?,
           updated_at           = CURRENT_TIMESTAMP
     WHERE id = ?
  `).run(periodStartIso, periodEndIso, subscriptionId);
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Atomically: verify the tx, then either bootstrap a new subscription for
 * this wallet OR extend the existing one by PERIOD_DAYS.
 *
 * Returns { newSubscription, foundingMember, currentPeriodEnd }.
 *
 * Errors codes:
 *   tx_not_found, tx_reverted, no_matching_transfer (from verifyUsdcTransfer)
 *   tx_already_redeemed (replay attempt)
 */
async function verifyAndCredit({ walletInput, txHash, email = null }) {
  if (txHashAlreadyRedeemed(txHash)) {
    const err = new Error("tx_already_redeemed");
    err.code = "tx_already_redeemed";
    throw err;
  }

  const amount = await verifyUsdcTransfer({ walletInput, txHash });
  const wallet = getAddress(walletInput);
  const now    = new Date();

  const existing = getActiveSubscription(wallet);
  let subscriptionId;
  let newSubscription;
  let foundingMember;
  let periodEnd;

  if (existing) {
    // Extend: new period starts at max(now, current_period_end) so adjacent
    // renewals stack instead of overlapping.
    const prevEnd = existing.current_period_end ? new Date(existing.current_period_end) : now;
    const startFrom = prevEnd > now ? prevEnd : now;
    periodEnd = addDays(startFrom, PERIOD_DAYS);

    extendCryptoSubscriptionPeriod(
      existing.id,
      now.toISOString(),
      periodEnd.toISOString(),
    );

    subscriptionId  = existing.id;
    newSubscription = false;
    foundingMember  = !!existing.founding_member;
    log.info({ wallet, subscriptionId, txHash, periodEnd: periodEnd.toISOString() },
      "Crypto subscription extended");
  } else {
    // Bootstrap a new subscription. Claim founding if slots remain.
    const founding = claimFoundingSlot();
    periodEnd = addDays(now, PERIOD_DAYS);

    subscriptionId = insertSubscription({
      walletInput: wallet,
      email,
      source: "crypto",
      status: "active",
      founding,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd:   periodEnd.toISOString(),
    });

    newSubscription = true;
    foundingMember  = founding;
    log.info({ wallet, subscriptionId, txHash, founding },
      "Crypto subscription bootstrapped");
  }

  db.prepare(`
    INSERT INTO crypto_payments (tx_hash, wallet, subscription_id, amount_units)
    VALUES (?, ?, ?, ?)
  `).run(txHash, wallet, subscriptionId, amount.toString());

  return {
    newSubscription,
    foundingMember,
    currentPeriodEnd: periodEnd.toISOString(),
  };
}

module.exports = {
  verifyAndCredit,
  // exported for tests / introspection
  _internals: { verifyUsdcTransfer, txHashAlreadyRedeemed, getTreasuryAddress, getMonthlyAmount },
};
