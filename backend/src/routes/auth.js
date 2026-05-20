"use strict";

/**
 * /api/auth/* — wallet-signature auth endpoints.
 *
 *   POST /nonce   { wallet }                            → { nonce, message, issuedAt }
 *   POST /verify  { wallet, nonce, signature, issuedAt } → sets cookie, { ok, wallet }
 *   POST /logout                                          → clears cookie, { ok }
 *   GET  /me                                              → { wallet } or 401
 */

const express = require("express");
const {
  COOKIE_NAME,
  SESSION_TTL_MS,
  createNonce,
  verifyAndConsume,
  createSession,
  getSessionWallet,
  revokeSession,
} = require("../services/auth");
const { nova: log } = require("../lib/logger");

const router = express.Router();

const isProd = process.env.NODE_ENV === "production";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

// ─── POST /nonce ────────────────────────────────────────────────────────────

router.post("/nonce", (req, res) => {
  const { wallet } = req.body ?? {};
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "wallet required" });
  }

  try {
    const { nonce, message, issuedAt } = createNonce(wallet);
    res.json({ nonce, message, issuedAt });
  } catch (err) {
    log.warn({ err, wallet }, "Nonce creation failed (likely bad address)");
    res.status(400).json({ error: "invalid wallet" });
  }
});

// ─── POST /verify ───────────────────────────────────────────────────────────

router.post("/verify", (req, res) => {
  const { wallet, nonce, signature, issuedAt } = req.body ?? {};

  if (!wallet || !nonce || !signature || !issuedAt) {
    return res.status(400).json({ error: "wallet, nonce, signature, issuedAt required" });
  }

  let result;
  try {
    result = verifyAndConsume({ walletInput: wallet, nonce, signature, issuedAt });
  } catch (err) {
    log.warn({ err, wallet }, "verifyAndConsume threw");
    return res.status(400).json({ error: "invalid input" });
  }

  if (!result.ok) {
    log.info({ wallet, reason: result.reason }, "Auth verify rejected");
    return res.status(401).json({ error: result.reason });
  }

  const { token } = createSession(result.wallet);
  res.cookie(COOKIE_NAME, token, cookieOptions());

  log.info({ wallet: result.wallet }, "Auth session created");
  res.json({ ok: true, wallet: result.wallet });
});

// ─── POST /logout ───────────────────────────────────────────────────────────

router.post("/logout", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) revokeSession(token);
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

// ─── GET /me ────────────────────────────────────────────────────────────────

router.get("/me", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  const wallet = token ? getSessionWallet(token) : null;
  if (!wallet) return res.status(401).json({ error: "auth_required" });
  res.json({ wallet });
});

module.exports = router;
