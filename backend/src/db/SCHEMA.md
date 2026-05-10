# SQLite schema reference

The schema is created and migrated automatically by `sqlite.js` on backend
boot. There is no separate migration tool — every table, column, and index
below is `CREATE … IF NOT EXISTS` or guarded by a `PRAGMA table_info` check,
so it is safe to re-run on every container start.

DB file: `nova.db` locally, `/data/nova.db` on Railway (volume mount).
`PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` are enabled.

## Tables

### `escrow_records`
One row per Stripe checkout session. Status transitions on webhook delivery
and on-chain confirmations.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `stripe_session_id` | TEXT UNIQUE | Stripe `cs_…` |
| `client_email` | TEXT | |
| `client_wallet` | TEXT | MetaMask address from `client_reference_id` |
| `escrow_id` | TEXT | `taskId` returned by `TaskEscrowV2.lock()` |
| `amount_cents` | INTEGER | Stripe `amount_total` |
| `tx_hash` | TEXT | Lock transaction hash |
| `status` | TEXT | one of `pending`, `pending_wallet`, `pending_retry`, `locked`, `released`, `refunded`, `relay_failed` |
| `created_at` | DATETIME | |

Indexes: `idx_escrow_email`, `idx_escrow_status`, `idx_escrow_email_status`.

### `nova_sessions`
One row per paying customer — drives the briefing → kit-delivered flow.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `client_email` | TEXT UNIQUE | |
| `stripe_session_id` | TEXT | |
| `stage` | TEXT | `briefing_q1` \| `briefing_q2` \| `briefing_q3` \| `brief_complete` \| `kit_delivered` (legacy `briefing` is auto-migrated to `briefing_q1`) |
| `language` | TEXT | |
| `business_type` | TEXT | |
| `vibe_tags` | TEXT | |
| `brand_description` | TEXT | |
| `brief_submitted_at` | DATETIME | |
| `delivery_status` | TEXT | NULL \| `pending` \| `in_progress` \| `delivered` |
| `brand_context` | TEXT | JSON-encoded |
| `branding_kit` | TEXT | JSON-encoded |
| `referral_code` | TEXT | unique partial index |
| `referred_by` | TEXT | |
| `referral_count` | INTEGER | default 0 |
| `created_at`, `updated_at` | DATETIME | |

Indexes: `idx_sessions_email`, `idx_sessions_stage`, `idx_sessions_delivery`,
`idx_nova_sessions_referral_code` (unique, partial: `WHERE referral_code IS NOT NULL`).

### `scarcity`
Single-row counter for "Founding 100" cap.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | constrained to `1` |
| `claimed` | INTEGER | default 0 |

### `webhook_retries`
Backoff-driven retry queue for failed on-chain relays.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `event_type` | TEXT | e.g. `checkout.session.completed` |
| `payload` | TEXT | JSON-encoded raw event |
| `attempts` | INTEGER | default 0 |
| `last_error` | TEXT | |
| `next_retry_at` | DATETIME | |
| `status` | TEXT | `pending` \| `completed` \| `failed` |
| `created_at` | DATETIME | |

Indexes: `idx_webhook_retries_pending` (partial: `WHERE status = 'pending'`).

### `referrals`
Referral relationships. One referee per row.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `referrer_email` | TEXT | |
| `referee_email` | TEXT UNIQUE | |
| `status` | TEXT | `pending` \| `converted` \| `expired` |
| `created_at`, `converted_at` | DATETIME | |

Indexes: `idx_referrals_referrer`, `idx_referrals_status`.

## Migration policy

`sqlite.js` adds new columns via `ALTER TABLE … ADD COLUMN` only when
`PRAGMA table_info` confirms they are missing. Never destructive — never
drops or renames columns. To rename or drop, write a one-shot script and
run it manually against the Railway volume.
