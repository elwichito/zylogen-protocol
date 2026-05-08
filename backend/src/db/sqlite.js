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
                              CHECK (status IN ('pending','pending_wallet','pending_retry','locked','released','refunded','relay_failed')),
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS nova_sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    client_email        TEXT    NOT NULL UNIQUE,
    stripe_session_id   TEXT,
    stage               TEXT    NOT NULL DEFAULT 'briefing_q1'
                                 CHECK (stage IN ('briefing','briefing_q1','briefing_q2','briefing_q3','brief_complete','kit_delivered')),
    language            TEXT,
    business_type       TEXT,
    vibe_tags           TEXT,
    brand_description   TEXT,
    brief_submitted_at  DATETIME,
    delivery_status     TEXT    DEFAULT NULL
                                 CHECK (delivery_status IS NULL OR delivery_status IN ('pending','in_progress','delivered')),
    brand_context       TEXT,
    branding_kit        TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- v2 migration: add new columns if missing (safe to run repeatedly)

`);

// Column migrations for existing nova_sessions table
const existingCols = db.prepare(`PRAGMA table_info(nova_sessions)`).all().map((c) => c.name);
const migrations = [
  { col: "language",           sql: `ALTER TABLE nova_sessions ADD COLUMN language TEXT` },
  { col: "business_type",     sql: `ALTER TABLE nova_sessions ADD COLUMN business_type TEXT` },
  { col: "vibe_tags",         sql: `ALTER TABLE nova_sessions ADD COLUMN vibe_tags TEXT` },
  { col: "brand_description", sql: `ALTER TABLE nova_sessions ADD COLUMN brand_description TEXT` },
  { col: "brief_submitted_at",sql: `ALTER TABLE nova_sessions ADD COLUMN brief_submitted_at DATETIME` },
  { col: "delivery_status",   sql: `ALTER TABLE nova_sessions ADD COLUMN delivery_status TEXT DEFAULT NULL` },
];

for (const m of migrations) {
  if (!existingCols.includes(m.col)) {
    db.exec(m.sql);
    console.log(`[db] Migrated: added column nova_sessions.${m.col}`);
  }
}

// Migrate old 'briefing' stage to 'briefing_q1' for existing sessions
db.prepare(`UPDATE nova_sessions SET stage = 'briefing_q1' WHERE stage = 'briefing'`).run();

db.exec(`
  -- Single-row scarcity counter (INSERT OR IGNORE seeds it once)
  CREATE TABLE IF NOT EXISTS scarcity (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    claimed INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO scarcity (id, claimed) VALUES (1, 0);

  -- Webhook retry queue for failed on-chain relays
  CREATE TABLE IF NOT EXISTS webhook_retries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type    TEXT    NOT NULL,
    payload       TEXT    NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    next_retry_at DATETIME NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed', 'failed')),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Index for efficient retry queue processing
  CREATE INDEX IF NOT EXISTS idx_webhook_retries_pending
    ON webhook_retries (status, next_retry_at)
    WHERE status = 'pending';

  -- Referral tracking table
  CREATE TABLE IF NOT EXISTS referrals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_email  TEXT    NOT NULL,
    referee_email   TEXT    NOT NULL UNIQUE,
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'converted', 'expired')),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    converted_at    DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_referrals_referrer
    ON referrals (referrer_email);
`);

// Column migrations for nova_sessions table - add referral columns
// Note: SQLite doesn't support UNIQUE constraint in ALTER TABLE, so we add a unique index separately
const sessionCols = db.prepare(`PRAGMA table_info(nova_sessions)`).all().map((c) => c.name);
const sessionMigrations = [
  { col: "referral_code",  sql: `ALTER TABLE nova_sessions ADD COLUMN referral_code TEXT` },
  { col: "referred_by",    sql: `ALTER TABLE nova_sessions ADD COLUMN referred_by TEXT` },
  { col: "referral_count", sql: `ALTER TABLE nova_sessions ADD COLUMN referral_count INTEGER DEFAULT 0` },
];

for (const m of sessionMigrations) {
  if (!sessionCols.includes(m.col)) {
    db.exec(m.sql);
    console.log(`[db] Migrated: added column nova_sessions.${m.col}`);
  }
}

// Create unique index for referral_code (can't add UNIQUE constraint via ALTER TABLE in SQLite)
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_nova_sessions_referral_code ON nova_sessions(referral_code) WHERE referral_code IS NOT NULL`);

// ─── Performance Indexes ──────────────────────────────────────────────────────
db.exec(`
  -- escrow_records: fast lookup by email and status
  CREATE INDEX IF NOT EXISTS idx_escrow_email ON escrow_records(client_email);
  CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_records(status);
  CREATE INDEX IF NOT EXISTS idx_escrow_email_status ON escrow_records(client_email, status);

  -- nova_sessions: fast lookup by email and stage
  CREATE INDEX IF NOT EXISTS idx_sessions_email ON nova_sessions(client_email);
  CREATE INDEX IF NOT EXISTS idx_sessions_stage ON nova_sessions(stage);
  CREATE INDEX IF NOT EXISTS idx_sessions_delivery ON nova_sessions(delivery_status) WHERE delivery_status IS NOT NULL;

  -- referrals: fast referrer lookup
  CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
`);

console.log(`[db] SQLite ready at ${DB_PATH}`);

module.exports = db;
