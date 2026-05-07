"use strict";

/**
 * retryQueue.js — Webhook retry queue with exponential backoff
 *
 * Stores failed webhook events in SQLite and retries them with increasing delays.
 * Backoff schedule: 1min, 5min, 30min, 2hr, 12hr (max 5 attempts)
 */

const db = require("../db/sqlite");
const { webhook: log } = require("../lib/logger");

// Backoff schedule in seconds: 1min, 5min, 30min, 2hr, 12hr
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200];
const MAX_ATTEMPTS = 5;

/**
 * Queue a failed webhook event for retry
 *
 * @param {string} eventType - Stripe event type (e.g., 'checkout.session.completed')
 * @param {object} payload - Full event payload to replay
 * @param {string} errorMessage - Error that caused the failure
 * @returns {{ id: number, nextRetryAt: string }}
 */
function queueForRetry(eventType, payload, errorMessage) {
  const nextRetryAt = new Date(Date.now() + BACKOFF_SECONDS[0] * 1000).toISOString();

  const result = db.prepare(`
    INSERT INTO webhook_retries (event_type, payload, attempts, last_error, next_retry_at, status)
    VALUES (?, ?, 1, ?, ?, 'pending')
  `).run(eventType, JSON.stringify(payload), errorMessage, nextRetryAt);

  log.info(
    { retryId: result.lastInsertRowid, eventType, nextRetryAt },
    "Webhook event queued for retry"
  );

  return { id: result.lastInsertRowid, nextRetryAt };
}

/**
 * Get pending retries that are due for processing
 *
 * @param {number} limit - Max number of retries to fetch
 * @returns {Array<{ id, event_type, payload, attempts, last_error, next_retry_at, created_at }>}
 */
function getPendingRetries(limit = 10) {
  const now = new Date().toISOString();

  return db.prepare(`
    SELECT id, event_type, payload, attempts, last_error, next_retry_at, created_at
    FROM webhook_retries
    WHERE status = 'pending' AND next_retry_at <= ?
    ORDER BY next_retry_at ASC
    LIMIT ?
  `).all(now, limit);
}

/**
 * Mark a retry as completed (success)
 *
 * @param {number} retryId
 */
function markCompleted(retryId) {
  db.prepare(`
    UPDATE webhook_retries
    SET status = 'completed', last_error = NULL
    WHERE id = ?
  `).run(retryId);

  log.info({ retryId }, "Webhook retry completed successfully");
}

/**
 * Mark a retry as permanently failed (max attempts exhausted)
 *
 * @param {number} retryId
 * @param {string} errorMessage
 */
function markFailed(retryId, errorMessage) {
  db.prepare(`
    UPDATE webhook_retries
    SET status = 'failed', last_error = ?
    WHERE id = ?
  `).run(errorMessage, retryId);

  log.error({ retryId, error: errorMessage }, "Webhook retry permanently failed");
}

/**
 * Schedule next retry attempt with exponential backoff
 *
 * @param {number} retryId
 * @param {number} currentAttempts - Current attempt count (before increment)
 * @param {string} errorMessage
 * @returns {{ nextRetryAt: string } | null} - null if max attempts reached
 */
function scheduleNextRetry(retryId, currentAttempts, errorMessage) {
  const nextAttempt = currentAttempts + 1;

  if (nextAttempt > MAX_ATTEMPTS) {
    markFailed(retryId, errorMessage);
    return null;
  }

  // Use backoff schedule (0-indexed), cap at last value
  const backoffIndex = Math.min(nextAttempt - 1, BACKOFF_SECONDS.length - 1);
  const delaySeconds = BACKOFF_SECONDS[backoffIndex];
  const nextRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

  db.prepare(`
    UPDATE webhook_retries
    SET attempts = ?, last_error = ?, next_retry_at = ?
    WHERE id = ?
  `).run(nextAttempt, errorMessage, nextRetryAt, retryId);

  log.info(
    { retryId, attempt: nextAttempt, nextRetryAt, delaySeconds },
    "Webhook retry rescheduled"
  );

  return { nextRetryAt };
}

/**
 * Get retry statistics for monitoring
 *
 * @returns {{ pending: number, completed: number, failed: number }}
 */
function getRetryStats() {
  const stats = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM webhook_retries
    GROUP BY status
  `).all();

  const result = { pending: 0, completed: 0, failed: 0 };
  for (const row of stats) {
    result[row.status] = row.count;
  }
  return result;
}

/**
 * Get a specific retry by ID
 *
 * @param {number} retryId
 * @returns {object | undefined}
 */
function getRetryById(retryId) {
  return db.prepare(`
    SELECT id, event_type, payload, attempts, last_error, next_retry_at, status, created_at
    FROM webhook_retries
    WHERE id = ?
  `).get(retryId);
}

/**
 * Clean up old completed/failed retries (older than 30 days)
 *
 * @returns {number} - Number of rows deleted
 */
function cleanupOldRetries() {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const result = db.prepare(`
    DELETE FROM webhook_retries
    WHERE status IN ('completed', 'failed') AND created_at < ?
  `).run(cutoff);

  if (result.changes > 0) {
    log.info({ deleted: result.changes }, "Cleaned up old retry records");
  }

  return result.changes;
}

module.exports = {
  queueForRetry,
  getPendingRetries,
  markCompleted,
  markFailed,
  scheduleNextRetry,
  getRetryStats,
  getRetryById,
  cleanupOldRetries,
  MAX_ATTEMPTS,
  BACKOFF_SECONDS,
};
