"use strict";

/**
 * internal.js routes — Internal API endpoints
 *
 * Protected by INTERNAL_API_KEY. Used by Railway cron or external scheduler.
 */

const express = require("express");
const { server: log } = require("../lib/logger");
const { processPendingRetries } = require("../services/paymentRelay");
const retryQueue = require("../services/retryQueue");

const router = express.Router();

/**
 * Middleware to verify internal API key
 */
function requireInternalKey(req, res, next) {
  const apiKey = req.headers["x-internal-key"];
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    log.error("INTERNAL_API_KEY not configured");
    return res.status(500).json({ error: "Internal API not configured" });
  }

  if (!apiKey || apiKey !== expectedKey) {
    log.warn({ ip: req.ip }, "Unauthorized internal API access attempt");
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}

// Apply auth to all internal routes
router.use(requireInternalKey);

// ─── POST /api/internal/process-retries ──────────────────────────────────────
// Process pending webhook retries. Call via cron every 1-5 minutes.

router.post("/process-retries", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  try {
    const result = await processPendingRetries(limit);

    log.info(
      { processed: result.processed, succeeded: result.succeeded, failed: result.failed },
      "Retry processing complete"
    );

    res.json(result);
  } catch (err) {
    log.error({ err }, "Retry processing failed");
    res.status(500).json({ error: "Retry processing failed" });
  }
});

// ─── GET /api/internal/retry-stats ───────────────────────────────────────────
// Get retry queue statistics for monitoring

router.get("/retry-stats", (_req, res) => {
  try {
    const stats = retryQueue.getRetryStats();
    res.json(stats);
  } catch (err) {
    log.error({ err }, "Failed to get retry stats");
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// ─── POST /api/internal/cleanup-retries ──────────────────────────────────────
// Manually trigger cleanup of old retry records

router.post("/cleanup-retries", (_req, res) => {
  try {
    const deleted = retryQueue.cleanupOldRetries();
    res.json({ deleted });
  } catch (err) {
    log.error({ err }, "Retry cleanup failed");
    res.status(500).json({ error: "Cleanup failed" });
  }
});

module.exports = router;
