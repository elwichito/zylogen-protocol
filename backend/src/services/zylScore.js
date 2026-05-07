"use strict";

/**
 * zylScore.js
 *
 * Dynamic ZYL Score system that changes daily based on multiple factors.
 * Creates urgency and engagement through organic-feeling score fluctuations.
 *
 * Base Score: 1000
 *
 * Decreasing factors:
 * - Time decay: -5 points per day since launch
 * - Inactivity: -10 points if no new orders in 24h
 * - Market sentiment: Random -1 to -15 based on "market conditions"
 *
 * Increasing factors:
 * - New orders: +25 per order
 * - Referrals: +50 per referral (future)
 * - Community milestones: +100 at 25, 50, 75, 100 orders
 */

const db = require("../db/sqlite");
const { logger } = require("../lib/logger");

const log = logger.child({ module: "zylScore" });

// Configuration
const BASE_SCORE = 1000;
const LAUNCH_DATE = new Date("2026-05-01"); // Project launch date
const MILESTONES = [25, 50, 75, 100];
const MILESTONE_BONUS = 100;

// Point values
const POINTS_PER_DAY_DECAY = -5;
const POINTS_INACTIVITY = -10;
const POINTS_PER_ORDER = 25;
const POINTS_PER_REFERRAL = 50;
const MARKET_SENTIMENT_MIN = -15;
const MARKET_SENTIMENT_MAX = -1;

// Initialize zyl_score table
db.exec(`
  CREATE TABLE IF NOT EXISTS zyl_score (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    UNIQUE NOT NULL,
    score       INTEGER NOT NULL,
    factors     TEXT    NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

log.info("ZYL Score table initialized");

/**
 * Get a deterministic but organic-feeling random value for a given date and seed.
 * Uses a simple hash to ensure same inputs produce same outputs (daily consistency).
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {string} seed - Additional seed for variation
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Pseudo-random integer in range [min, max]
 */
function getDailyRandom(dateStr, seed, min, max) {
  // Simple hash function for deterministic randomness
  const str = `${dateStr}-${seed}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Normalize to [0, 1] range
  const normalized = Math.abs(hash) / 2147483647;
  // Scale to [min, max] range
  return Math.floor(normalized * (max - min + 1)) + min;
}

/**
 * Get the number of days since launch.
 * @param {Date} [asOf] - Calculate as of this date (defaults to now)
 * @returns {number} Days since launch
 */
function getDaysSinceLaunch(asOf = new Date()) {
  const diffMs = asOf - LAUNCH_DATE;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Get today's date string in YYYY-MM-DD format.
 * @param {Date} [date] - Date to format (defaults to now)
 * @returns {string} Date string
 */
function getDateString(date = new Date()) {
  return date.toISOString().split("T")[0];
}

/**
 * Get order statistics from the database.
 * @returns {{ total: number, today: number, lastOrderAt: Date|null }}
 */
function getOrderStats() {
  try {
    const total = db.prepare(
      `SELECT COUNT(*) AS count FROM nova_sessions`
    ).get()?.count ?? 0;

    const today = getDateString();
    const todayOrders = db.prepare(
      `SELECT COUNT(*) AS count FROM nova_sessions WHERE date(created_at) = ?`
    ).get(today)?.count ?? 0;

    const lastOrder = db.prepare(
      `SELECT created_at FROM nova_sessions ORDER BY created_at DESC LIMIT 1`
    ).get();

    return {
      total,
      today: todayOrders,
      lastOrderAt: lastOrder ? new Date(lastOrder.created_at) : null,
    };
  } catch (err) {
    log.error({ err }, "Failed to get order stats");
    return { total: 0, today: 0, lastOrderAt: null };
  }
}

/**
 * Check if there's been any order activity in the last 24 hours.
 * @returns {boolean}
 */
function hasRecentActivity() {
  const stats = getOrderStats();
  if (!stats.lastOrderAt) return false;

  const now = new Date();
  const hoursSinceLastOrder = (now - stats.lastOrderAt) / (1000 * 60 * 60);
  return hoursSinceLastOrder < 24;
}

/**
 * Get milestone bonuses achieved based on total orders.
 * @param {number} totalOrders - Total number of orders
 * @returns {{ achieved: number[], bonus: number }}
 */
function getMilestoneBonus(totalOrders) {
  const achieved = MILESTONES.filter((m) => totalOrders >= m);
  return {
    achieved,
    bonus: achieved.length * MILESTONE_BONUS,
  };
}

/**
 * Get the next milestone to achieve.
 * @param {number} totalOrders - Total number of orders
 * @returns {{ orders: number, bonus: number }|null}
 */
function getNextMilestone(totalOrders) {
  const next = MILESTONES.find((m) => totalOrders < m);
  return next ? { orders: next, bonus: MILESTONE_BONUS } : null;
}

/**
 * Calculate the ZYL Score for a given date.
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {{ score: number, factors: Object }}
 */
function calculateScoreForDate(dateStr) {
  const date = new Date(dateStr + "T12:00:00Z");
  const daysSinceLaunch = getDaysSinceLaunch(date);
  const orderStats = getOrderStats();

  // Calculate individual factors
  const timeDecay = daysSinceLaunch * POINTS_PER_DAY_DECAY;
  const inactivity = hasRecentActivity() ? 0 : POINTS_INACTIVITY;
  const marketSentiment = getDailyRandom(dateStr, "market", MARKET_SENTIMENT_MIN, MARKET_SENTIMENT_MAX);
  const orderBonus = orderStats.total * POINTS_PER_ORDER;
  const milestoneData = getMilestoneBonus(orderStats.total);

  // Add small daily variation for organic feel (-3 to +3)
  const dailyVariation = getDailyRandom(dateStr, "variation", -3, 3);

  const factors = {
    time_decay: timeDecay,
    inactivity,
    market: marketSentiment,
    orders: orderBonus,
    milestones: milestoneData.bonus,
    variation: dailyVariation,
  };

  // Calculate total score (minimum 100 to avoid negative scores)
  const rawScore = BASE_SCORE + timeDecay + inactivity + marketSentiment + orderBonus + milestoneData.bonus + dailyVariation;
  const score = Math.max(100, rawScore);

  return { score, factors };
}

/**
 * Get the cached score for today, or calculate fresh if needed.
 * @returns {{ score: number, factors: Object }}
 */
function getTodayScore() {
  const today = getDateString();

  // Check cache
  const cached = db.prepare(
    `SELECT score, factors FROM zyl_score WHERE date = ?`
  ).get(today);

  if (cached) {
    return {
      score: cached.score,
      factors: JSON.parse(cached.factors),
    };
  }

  // Calculate fresh
  const { score, factors } = calculateScoreForDate(today);

  // Save to cache
  try {
    db.prepare(`
      INSERT INTO zyl_score (date, score, factors)
      VALUES (?, ?, ?)
    `).run(today, score, JSON.stringify(factors));
    log.info({ date: today, score }, "ZYL Score calculated and cached");
  } catch (err) {
    // Might race with another request - that's fine
    log.debug({ err, date: today }, "Score cache insert failed (likely race)");
  }

  return { score, factors };
}

/**
 * Get scores for the last N days (for sparkline chart).
 * Backfills missing days if needed.
 * @param {number} [days=7] - Number of days to retrieve
 * @returns {Array<{ date: string, score: number }>}
 */
function getHistoricalScores(days = 7) {
  const scores = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = getDateString(date);

    // Check cache first
    let cached = db.prepare(
      `SELECT score FROM zyl_score WHERE date = ?`
    ).get(dateStr);

    if (!cached) {
      // Calculate and cache
      const { score, factors } = calculateScoreForDate(dateStr);
      try {
        db.prepare(`
          INSERT INTO zyl_score (date, score, factors)
          VALUES (?, ?, ?)
        `).run(dateStr, score, JSON.stringify(factors));
        cached = { score };
      } catch (err) {
        // Race condition - try to read again
        cached = db.prepare(
          `SELECT score FROM zyl_score WHERE date = ?`
        ).get(dateStr);
        if (!cached) cached = { score };
      }
    }

    scores.push({ date: dateStr, score: cached.score });
  }

  return scores;
}

/**
 * Get the 24h change by comparing today's score to yesterday's.
 * @returns {number} Point change (negative if score decreased)
 */
function get24hChange() {
  const today = getTodayScore().score;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getDateString(yesterday);

  // Get or calculate yesterday's score
  let cached = db.prepare(
    `SELECT score FROM zyl_score WHERE date = ?`
  ).get(yesterdayStr);

  if (!cached) {
    const { score, factors } = calculateScoreForDate(yesterdayStr);
    try {
      db.prepare(`
        INSERT INTO zyl_score (date, score, factors)
        VALUES (?, ?, ?)
      `).run(yesterdayStr, score, JSON.stringify(factors));
    } catch (err) {
      // Ignore race conditions
    }
    cached = { score };
  }

  return today - cached.score;
}

/**
 * Get the full ZYL Score response for the API.
 * @returns {Object} Complete score data
 */
function getZylScoreResponse() {
  const { score, factors } = getTodayScore();
  const change24h = get24hChange();
  const orderStats = getOrderStats();
  const nextMilestone = getNextMilestone(orderStats.total);
  const history = getHistoricalScores(7);

  // Determine trend
  let trend = "stable";
  if (change24h > 5) trend = "up";
  else if (change24h < -5) trend = "down";

  return {
    score,
    change_24h: change24h,
    trend,
    factors: {
      time_decay: factors.time_decay,
      orders_today: orderStats.today * POINTS_PER_ORDER,
      market: factors.market,
      milestones: factors.milestones,
      inactivity: factors.inactivity,
    },
    next_milestone: nextMilestone,
    history,
    _meta: {
      calculated_at: new Date().toISOString(),
      total_orders: orderStats.total,
    },
  };
}

/**
 * Force recalculate today's score (useful after new orders).
 * Deletes cached value and recalculates.
 */
function invalidateTodayCache() {
  const today = getDateString();
  db.prepare(`DELETE FROM zyl_score WHERE date = ?`).run(today);
  log.info({ date: today }, "ZYL Score cache invalidated");
}

module.exports = {
  getZylScoreResponse,
  getTodayScore,
  getHistoricalScores,
  get24hChange,
  invalidateTodayCache,
  // Exported for testing
  _internal: {
    calculateScoreForDate,
    getDailyRandom,
    getDateString,
    getDaysSinceLaunch,
    BASE_SCORE,
    MILESTONES,
  },
};
