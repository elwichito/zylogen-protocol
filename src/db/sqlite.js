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
`);

console.log(`[db] SQLite ready at ${DB_PATH}`);

module.exports = db;
