"use strict";

/**
 * sqlite.js
 *
 * Drop-in replacement for the Postgres client.
 * Uses better-sqlite3 (synchronous API — no connection pool needed).
 *
 * Database file: nova.db (local dev) or /data/nova.db (Railway volume mount).
 * Set DB_PATH in .env to override.
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../nova.db");

const db = new Database(DB_PATH);

// WAL mode: better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS escrow_records (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_session_id TEXT    UNIQUE NOT NULL,
    client_email      TEXT    NOT NULL,
    client_wallet     TEXT,
    escrow_id         TEXT,
    amount_cents      INTEGER NOT NULL,
    tx_hash           TEXT,
    status            TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','pending_wallet','locked','released','refunded','relay_failed')),
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS nova_sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_email      TEXT    NOT NULL UNIQUE,
    stripe_session_id TEXT,
    stage             TEXT    NOT NULL DEFAULT 'briefing'
                               CHECK (stage IN ('briefing','kit_delivered')),
    brand_context     TEXT,
    branding_kit      TEXT,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Single-row scarcity counter (INSERT OR IGNORE seeds it once)
  CREATE TABLE IF NOT EXISTS scarcity (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    claimed INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO scarcity (id, claimed) VALUES (1, 0);
`);

console.log(`[db] SQLite ready at ${DB_PATH}`);

module.exports = db;
