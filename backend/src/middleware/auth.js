"use strict";

/**
 * auth.js middleware — extracts wallet from the session cookie and attaches
 * it to req.wallet. Two flavors:
 *
 *   requireWallet  → 401 if no valid session
 *   optionalWallet → never errors; req.wallet is null when absent
 */

const { COOKIE_NAME, getSessionWallet } = require("../services/auth");
const { nova: log } = require("../lib/logger");

function readWallet(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  return getSessionWallet(token);
}

function requireWallet(req, res, next) {
  const wallet = readWallet(req);
  if (!wallet) {
    return res.status(401).json({ error: "auth_required" });
  }
  req.wallet = wallet;
  next();
}

function optionalWallet(req, _res, next) {
  try {
    req.wallet = readWallet(req);
  } catch (err) {
    log.warn({ err }, "optionalWallet middleware threw");
    req.wallet = null;
  }
  next();
}

module.exports = { requireWallet, optionalWallet };
