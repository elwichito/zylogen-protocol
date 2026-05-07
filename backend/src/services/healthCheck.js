"use strict";

/**
 * healthCheck.js
 *
 * Service health checks for monitoring.
 * Checks: database, blockchain RPC, Stripe, Anthropic.
 */

const { ethers } = require("ethers");
const Stripe = require("stripe");
const db = require("../db/sqlite");
const { logger } = require("../lib/logger");

const log = logger.child({ module: "health" });

/**
 * Check database connectivity with a simple query.
 * @returns {{ status: "ok"|"error", latency_ms: number, error?: string }}
 */
function checkDatabase() {
  const start = Date.now();
  try {
    // Simple query that touches the database
    db.prepare("SELECT 1 AS ok").get();
    return {
      status: "ok",
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    log.error({ err }, "Database health check failed");
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error: err.message,
    };
  }
}

/**
 * Check blockchain RPC connectivity with eth_blockNumber call.
 * @returns {Promise<{ status: "ok"|"error", latency_ms: number, block?: number, error?: string }>}
 */
async function checkBlockchain() {
  const start = Date.now();
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const blockNumber = await provider.getBlockNumber();
    return {
      status: "ok",
      latency_ms: Date.now() - start,
      block: blockNumber,
    };
  } catch (err) {
    log.error({ err, rpcUrl }, "Blockchain health check failed");
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error: err.message,
    };
  }
}

/**
 * Check Stripe connectivity with a lightweight API call.
 * Uses balance.retrieve() which is low-cost and doesn't create resources.
 * @returns {Promise<{ status: "ok"|"error"|"unchecked", latency_ms?: number, error?: string }>}
 */
async function checkStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: "unchecked", error: "STRIPE_SECRET_KEY not configured" };
  }

  const start = Date.now();
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    await stripe.balance.retrieve();
    return {
      status: "ok",
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    log.error({ err }, "Stripe health check failed");
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error: err.message,
    };
  }
}

/**
 * Check Anthropic API connectivity.
 * Returns "unchecked" since there's no cheap ping endpoint.
 * A real check would consume API credits.
 * @returns {{ status: "unchecked", reason: string }}
 */
function checkAnthropic() {
  // Anthropic doesn't have a free health/ping endpoint.
  // Making a real API call would consume credits.
  // We could check if the key is configured at least.
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: "unchecked", reason: "ANTHROPIC_API_KEY not configured" };
  }
  return { status: "unchecked", reason: "no free health endpoint" };
}

/**
 * Get queue statistics from the database.
 * @returns {{ pending_retries: number, pending_deliveries: number }}
 */
function getQueueStats() {
  try {
    // Count escrow records that need retry (relay_failed status)
    const retries = db.prepare(
      `SELECT COUNT(*) AS count FROM escrow_records WHERE status = 'relay_failed'`
    ).get();

    // Count sessions with pending delivery
    const deliveries = db.prepare(
      `SELECT COUNT(*) AS count FROM nova_sessions WHERE delivery_status = 'pending' OR delivery_status = 'in_progress'`
    ).get();

    return {
      pending_retries: retries?.count ?? 0,
      pending_deliveries: deliveries?.count ?? 0,
    };
  } catch (err) {
    log.error({ err }, "Queue stats query failed");
    return {
      pending_retries: -1,
      pending_deliveries: -1,
    };
  }
}

/**
 * Get order statistics from the database.
 * @returns {{ total_orders: number, delivered: number, pending: number }}
 */
function getOrderStats() {
  try {
    const total = db.prepare(
      `SELECT COUNT(*) AS count FROM nova_sessions`
    ).get();

    const delivered = db.prepare(
      `SELECT COUNT(*) AS count FROM nova_sessions WHERE stage = 'kit_delivered'`
    ).get();

    const pending = db.prepare(
      `SELECT COUNT(*) AS count FROM nova_sessions WHERE stage != 'kit_delivered'`
    ).get();

    return {
      total_orders: total?.count ?? 0,
      delivered: delivered?.count ?? 0,
      pending: pending?.count ?? 0,
    };
  } catch (err) {
    log.error({ err }, "Order stats query failed");
    return {
      total_orders: -1,
      delivered: -1,
      pending: -1,
    };
  }
}

/**
 * Compute overall system status based on individual service statuses.
 * @param {Object} services - The services status object
 * @returns {"ok"|"degraded"|"down"}
 */
function computeOverallStatus(services) {
  const statuses = Object.values(services).map((s) => s.status);

  // If database is down, system is down
  if (services.database?.status === "error") {
    return "down";
  }

  // If any critical service is errored, system is degraded
  const criticalServices = ["database", "blockchain", "stripe"];
  const hasError = criticalServices.some(
    (name) => services[name]?.status === "error"
  );

  if (hasError) {
    return "degraded";
  }

  return "ok";
}

/**
 * Run all health checks and return full status report.
 * @returns {Promise<Object>} Full health status object
 */
async function getFullHealthStatus() {
  // Run checks in parallel where possible
  const [blockchainResult, stripeResult] = await Promise.all([
    checkBlockchain(),
    checkStripe(),
  ]);

  const services = {
    database: checkDatabase(),
    blockchain: blockchainResult,
    stripe: stripeResult,
    anthropic: checkAnthropic(),
  };

  const status = computeOverallStatus(services);

  return {
    status,
    timestamp: new Date().toISOString(),
    services,
    queues: getQueueStats(),
    stats: getOrderStats(),
  };
}

/**
 * Simple health check for load balancers.
 * Only checks database - fast and reliable.
 * @returns {{ status: "ok"|"down" }}
 */
function getSimpleHealthStatus() {
  const dbCheck = checkDatabase();
  return {
    status: dbCheck.status === "ok" ? "ok" : "down",
  };
}

module.exports = {
  checkDatabase,
  checkBlockchain,
  checkStripe,
  checkAnthropic,
  getQueueStats,
  getOrderStats,
  getFullHealthStatus,
  getSimpleHealthStatus,
};
