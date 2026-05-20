"use strict";

/**
 * auth.js — wallet-signature auth (SIWE-lite) for Nova.
 *
 * Flow:
 *   1. Client calls POST /api/auth/nonce { wallet } → { nonce, message }
 *   2. Client asks the wallet to sign `message` (human-readable, includes nonce)
 *   3. Client calls POST /api/auth/verify { wallet, nonce, signature }
 *      → server verifies signature, creates session, sets HttpOnly cookie
 *
 * Sessions are 30 days, fixed TTL (no sliding renewal). We store SHA-256 of
 * the cookie token, never the raw value — a DB leak doesn't compromise
 * active sessions.
 */

const crypto  = require("crypto");
const { verifyMessage, getAddress } = require("ethers");
const db      = require("../db/sqlite");

const NONCE_TTL_MS   = 5  * 60 * 1000;          // 5 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME    = "nova_session";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeWallet(addr) {
  // Throws if invalid; returns checksummed address
  return getAddress(addr);
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function buildSignMessage(wallet, nonce, issuedAt) {
  return [
    "Sign in to Nova @ Zylogen Protocol",
    "",
    `Wallet: ${wallet}`,
    `Nonce:  ${nonce}`,
    `Issued: ${issuedAt}`,
    "",
    "This signature does not authorize any transaction or transfer.",
  ].join("\n");
}

// ─── Nonces ──────────────────────────────────────────────────────────────────

/**
 * Issues a fresh nonce bound to a wallet. Returns { nonce, message, issuedAt }.
 * The client must sign `message` exactly as returned.
 */
function createNonce(walletInput) {
  const wallet   = normalizeWallet(walletInput);
  const nonce    = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const expires  = new Date(Date.now() + NONCE_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO auth_nonces (nonce, wallet, expires_at)
    VALUES (?, ?, ?)
  `).run(nonce, wallet, expires);

  return { nonce, message: buildSignMessage(wallet, nonce, issuedAt), issuedAt };
}

/**
 * Consumes a nonce. Returns the stored wallet if valid+unused+unexpired,
 * else null. Marks the nonce used atomically.
 */
function consumeNonce(nonce) {
  const row = db.prepare(
    `SELECT wallet, expires_at, used FROM auth_nonces WHERE nonce = ?`
  ).get(nonce);

  if (!row) return null;
  if (row.used) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  db.prepare(`UPDATE auth_nonces SET used = 1 WHERE nonce = ?`).run(nonce);
  return row.wallet;
}

// ─── Signatures ──────────────────────────────────────────────────────────────

/**
 * Verifies a signature against the canonical sign-in message. Returns true
 * only if (a) the nonce belongs to `wallet`, (b) the signature recovers to
 * `wallet`, and (c) the nonce hasn't been used. Marks nonce used on success.
 *
 * `issuedAt` must be the same ISO timestamp the client received from /nonce —
 * the client should pass it back so we reconstruct the exact message.
 */
function verifyAndConsume({ walletInput, nonce, signature, issuedAt }) {
  const wallet      = normalizeWallet(walletInput);
  const nonceWallet = consumeNonce(nonce);
  if (!nonceWallet) return { ok: false, reason: "invalid_or_expired_nonce" };
  if (nonceWallet !== wallet) return { ok: false, reason: "wallet_mismatch" };

  const message = buildSignMessage(wallet, nonce, issuedAt);
  let recovered;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (normalizeWallet(recovered) !== wallet) {
    return { ok: false, reason: "signature_wallet_mismatch" };
  }

  return { ok: true, wallet };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/**
 * Mints a session for `wallet`. Returns the raw token to set in a cookie.
 * The DB only stores SHA-256(token).
 */
function createSession(walletInput) {
  const wallet     = normalizeWallet(walletInput);
  const token      = crypto.randomBytes(32).toString("hex");
  const tokenHash  = sha256(token);
  const expiresAt  = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO auth_sessions (token_hash, wallet, expires_at)
    VALUES (?, ?, ?)
  `).run(tokenHash, wallet, expiresAt);

  return { token, expiresAt };
}

/**
 * Looks up a session by raw token. Returns the wallet or null.
 * Silently ignores expired sessions (does not delete — a sweeper job can).
 */
function getSessionWallet(token) {
  if (!token || typeof token !== "string") return null;
  const row = db.prepare(
    `SELECT wallet, expires_at FROM auth_sessions WHERE token_hash = ?`
  ).get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.wallet;
}

function revokeSession(token) {
  if (!token) return;
  db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(sha256(token));
}

// ─── Sweepers (optional — call from a cron) ──────────────────────────────────

function sweepExpired() {
  const now = new Date().toISOString();
  const n1 = db.prepare(`DELETE FROM auth_nonces   WHERE expires_at < ?`).run(now).changes;
  const n2 = db.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`).run(now).changes;
  return { nonces: n1, sessions: n2 };
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  createNonce,
  verifyAndConsume,
  createSession,
  getSessionWallet,
  revokeSession,
  sweepExpired,
  normalizeWallet,
};
