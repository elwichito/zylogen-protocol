-- ============================================================
-- nova_memory schema
-- Run once against your Postgres instance:
--   psql $DATABASE_URL -f src/db/schema.sql
-- ============================================================

CREATE SCHEMA IF NOT EXISTS nova_memory;

-- ─── Clients ────────────────────────────────────────────────────────────────
-- One row per unique paying user. The client_id is the Privy userId.

CREATE TABLE IF NOT EXISTS nova_memory.clients (
    id                    SERIAL PRIMARY KEY,
    client_id             TEXT UNIQUE NOT NULL,       -- Privy userId
    email                 TEXT UNIQUE NOT NULL,
    wallet_address        TEXT,                        -- Privy embedded wallet
    tier                  TEXT NOT NULL DEFAULT 'founding_100',
    brand_context         JSONB,                       -- structured brief from Stage 1
    folder_structure      JSONB,                       -- planned content folders
    branding_kit          JSONB,                       -- full kit from Claude
    consulting_summary    TEXT,                        -- human-readable summary
    briefing_completed_at TIMESTAMPTZ,
    kit_generated_at      TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Conversations ──────────────────────────────────────────────────────────
-- Full chat history per client for context window reconstruction.

CREATE TABLE IF NOT EXISTS nova_memory.conversations (
    id         SERIAL PRIMARY KEY,
    client_id  TEXT NOT NULL REFERENCES nova_memory.clients(client_id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content    TEXT NOT NULL,
    model_used TEXT,        -- 'gpt-4o-mini' | 'claude-3-5-sonnet-20241022'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_client_id ON nova_memory.conversations(client_id, created_at);

-- ─── Escrow Records ─────────────────────────────────────────────────────────
-- Links Stripe sessions to on-chain escrow IDs.

CREATE TABLE IF NOT EXISTS nova_memory.escrow_records (
    id                SERIAL PRIMARY KEY,
    stripe_session_id TEXT UNIQUE NOT NULL,
    client_email      TEXT NOT NULL,
    client_wallet     TEXT,
    escrow_id         TEXT,       -- on-chain escrowId (uint256 as text)
    amount_cents      INTEGER NOT NULL,
    tx_hash           TEXT,
    status            TEXT NOT NULL DEFAULT 'pending'  -- pending | locked | released | refunded
                          CHECK (status IN ('pending', 'locked', 'released', 'refunded')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at        TIMESTAMPTZ
);

-- ─── REP Audit Log ──────────────────────────────────────────────────────────
-- Off-chain mirror of on-chain RepGranted events for fast querying.

CREATE TABLE IF NOT EXISTS nova_memory.rep_events (
    id             SERIAL PRIMARY KEY,
    worker_address TEXT NOT NULL,
    earned         NUMERIC NOT NULL,
    new_total      NUMERIC NOT NULL,
    escrow_id      TEXT,
    tx_hash        TEXT,
    block_number   BIGINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_events_worker ON nova_memory.rep_events(worker_address, created_at);

-- ─── Sybil Flags ────────────────────────────────────────────────────────────
-- Written by circularFlowDetector.js every 6 hours.

CREATE TABLE IF NOT EXISTS nova_memory.sybil_flags (
    id           SERIAL PRIMARY KEY,
    wallet_a     TEXT NOT NULL,
    wallet_b     TEXT NOT NULL,
    detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hours_apart  NUMERIC,
    status       TEXT NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('pending_review', 'cleared', 're_flagged', 'confirmed')),
    evidence     JSONB,
    reviewed_by  TEXT,
    reviewed_at  TIMESTAMPTZ,
    UNIQUE (wallet_a, wallet_b)
);

-- rep_frozen column on clients — set by the detective job
ALTER TABLE nova_memory.clients
  ADD COLUMN IF NOT EXISTS rep_frozen BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── updated_at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nova_memory.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_set_updated_at ON nova_memory.clients;
CREATE TRIGGER clients_set_updated_at
    BEFORE UPDATE ON nova_memory.clients
    FOR EACH ROW EXECUTE FUNCTION nova_memory.set_updated_at();
