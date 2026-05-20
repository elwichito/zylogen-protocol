"use strict";

/**
 * stripeWebhook.js — Stripe webhook handler for the Nova subscription model.
 *
 * Replaces the one-time-payment relay flow. We listen to four events:
 *
 *   checkout.session.completed     → bootstrap local subscription row
 *   customer.subscription.updated  → keep status + period bounds in sync
 *   customer.subscription.deleted  → mark canceled (final)
 *   invoice.payment_failed         → status → past_due → access cut IMMEDIATELY
 *
 * The handler is idempotent: every event is safe to retry. Stripe's
 * delivery guarantees are at-least-once; we de-dup via stripe_subscription_id
 * unique constraint on inserts and full-state-replacement on updates.
 */

const Stripe = require("stripe");
const { webhook: log } = require("../lib/logger");
const {
  claimFoundingSlot,
  insertSubscription,
  getSubscriptionByStripeId,
  updateSubscriptionByStripeId,
} = require("./subscriptions");

let _stripe;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// ─── Raw body middleware (required by Stripe signature verification) ────────

function rawBodyMiddleware(req, _res, next) {
  let data = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => { req.rawBody = data; next(); });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toIso(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

// Stripe subscription.status → our enum
// Stripe values: incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid
function mapStatus(stripeStatus) {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    default:
      return "incomplete";
  }
}

// ─── Event handlers ─────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  if (session.mode !== "subscription") {
    log.info({ sessionId: session.id, mode: session.mode }, "Non-subscription checkout — ignoring");
    return;
  }

  const wallet = session.client_reference_id;
  if (!wallet) {
    log.warn({ sessionId: session.id }, "checkout.session.completed missing client_reference_id (wallet)");
    return;
  }

  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id;
  if (!subscriptionId) {
    log.warn({ sessionId: session.id }, "Subscription mode session without subscription id");
    return;
  }

  // De-dup: a retry after a successful insert just no-ops.
  const existing = getSubscriptionByStripeId(subscriptionId);
  if (existing) {
    log.info({ subscriptionId }, "Subscription row already exists — skipping bootstrap");
    return;
  }

  // Pull the full subscription so we have period bounds and status authoritatively.
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);

  // Founding tier carried via subscription_data.metadata.tier from /subscribe.
  const tier = sub.metadata?.tier ?? "regular";
  let founding = false;
  if (tier === "founding") {
    founding = claimFoundingSlot();
    if (!founding) {
      // Race: all slots gone between checkout creation and webhook arrival.
      // The user paid for the founding price but we honor the slot rule.
      // We still grant access (status active) — billing already happened —
      // but the row records founding_member=0, so future re-subscribes
      // will use the regular price naturally.
      log.warn({ subscriptionId, wallet }, "Founding race lost: cap reached between checkout and webhook");
    }
  }

  insertSubscription({
    walletInput: wallet,
    email: session.customer_details?.email ?? null,
    source: "stripe",
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    status: mapStatus(sub.status),
    founding,
    currentPeriodStart: toIso(sub.current_period_start),
    currentPeriodEnd: toIso(sub.current_period_end),
  });

  log.info({ subscriptionId, wallet, founding, status: sub.status }, "Subscription bootstrapped");
}

function handleSubscriptionUpdated(sub) {
  const existing = getSubscriptionByStripeId(sub.id);
  if (!existing) {
    // Race: subscription.updated arrived before checkout.session.completed.
    // Stripe will replay. Skip — the bootstrap path will catch up.
    log.info({ subscriptionId: sub.id }, "Update for unknown subscription — waiting for bootstrap");
    return;
  }

  updateSubscriptionByStripeId(sub.id, {
    status: mapStatus(sub.status),
    currentPeriodStart: toIso(sub.current_period_start),
    currentPeriodEnd: toIso(sub.current_period_end),
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
  });

  log.info({ subscriptionId: sub.id, status: sub.status }, "Subscription synced");
}

function handleSubscriptionDeleted(sub) {
  const existing = getSubscriptionByStripeId(sub.id);
  if (!existing) {
    log.info({ subscriptionId: sub.id }, "Delete for unknown subscription — ignoring");
    return;
  }
  updateSubscriptionByStripeId(sub.id, { status: "canceled" });
  log.info({ subscriptionId: sub.id }, "Subscription marked canceled");
}

function handleInvoicePaymentFailed(invoice) {
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subscriptionId) return;

  const existing = getSubscriptionByStripeId(subscriptionId);
  if (!existing) {
    log.info({ subscriptionId }, "Failed payment for unknown subscription — ignoring");
    return;
  }

  // Per product decision (2026-05-19): NO grace period. Cut immediately.
  // We don't wait for the subscription.updated event because that may lag.
  updateSubscriptionByStripeId(subscriptionId, { status: "past_due" });
  log.warn({ subscriptionId, invoiceId: invoice.id }, "Payment failed — access cut");
}

// ─── Main handler ───────────────────────────────────────────────────────────

async function handleStripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    log.error({ err: err.message }, "Invalid webhook signature");
    return res.status(400).json({ error: "invalid_signature" });
  }

  log.info({ type: event.type, id: event.id }, "Stripe event received");

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.updated":
        handleSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.payment_failed":
        handleInvoicePaymentFailed(event.data.object);
        break;
      default:
        // Ignore unhandled events — Stripe fires many we don't care about.
        break;
    }
  } catch (err) {
    log.error({ err, type: event.type, id: event.id }, "Webhook handler threw");
    // Return 500 so Stripe retries.
    return res.status(500).json({ error: "handler_failed" });
  }

  res.json({ received: true });
}

module.exports = {
  handleStripeWebhook,
  rawBodyMiddleware,
  // exported for tests
  _internals: {
    mapStatus,
    handleCheckoutCompleted,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handleInvoicePaymentFailed,
  },
};
