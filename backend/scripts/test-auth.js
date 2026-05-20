"use strict";

/**
 * test-auth.js — end-to-end isolation test for the wallet-signature auth.
 *
 * Runs the service-level functions directly (no HTTP server). Generates two
 * throwaway wallets and exercises:
 *
 *   1. Happy path: nonce → sign → verify → session → lookup
 *   2. Wallet A cannot create a session by signing wallet B's nonce
 *   3. Nonce cannot be replayed
 *   4. Tampered signature is rejected
 *   5. Session token for wallet A returns wallet A, never wallet B
 *
 * Run: `node scripts/test-auth.js`. Exits non-zero on any failure.
 */

require("dotenv").config();
const { Wallet } = require("ethers");
const {
  createNonce,
  verifyAndConsume,
  createSession,
  getSessionWallet,
  revokeSession,
} = require("../src/services/auth");

let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
}
function bad(label, extra) {
  failed++;
  console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
}
function assert(cond, label, extra) {
  cond ? ok(label) : bad(label, extra);
}

async function signMessage(wallet, message) {
  return wallet.signMessage(message);
}

async function main() {
  const alice = Wallet.createRandom();
  const bob   = Wallet.createRandom();

  console.log(`\nalice: ${alice.address}`);
  console.log(`bob:   ${bob.address}\n`);

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  console.log("1. Happy path");
  {
    const { nonce, message, issuedAt } = createNonce(alice.address);
    const signature = await signMessage(alice, message);
    const result    = verifyAndConsume({ walletInput: alice.address, nonce, signature, issuedAt });
    assert(result.ok && result.wallet === alice.address, "verify accepts valid signature");

    const { token } = createSession(alice.address);
    assert(getSessionWallet(token) === alice.address, "session resolves to alice");

    revokeSession(token);
    assert(getSessionWallet(token) === null, "revoked session returns null");
  }

  // ── 2. Bob signs Alice's nonce ────────────────────────────────────────────
  console.log("\n2. Bob signs Alice's nonce");
  {
    const { nonce, message, issuedAt } = createNonce(alice.address);
    const signature = await signMessage(bob, message);
    const result    = verifyAndConsume({ walletInput: alice.address, nonce, signature, issuedAt });
    assert(!result.ok, "verify rejects bob's signature on alice's nonce", `got: ${JSON.stringify(result)}`);
  }

  // ── 3. Replay ─────────────────────────────────────────────────────────────
  console.log("\n3. Nonce replay");
  {
    const { nonce, message, issuedAt } = createNonce(alice.address);
    const signature = await signMessage(alice, message);
    const first  = verifyAndConsume({ walletInput: alice.address, nonce, signature, issuedAt });
    const second = verifyAndConsume({ walletInput: alice.address, nonce, signature, issuedAt });
    assert(first.ok && !second.ok, "second use of same nonce is rejected", `first=${first.ok} second=${second.ok}`);
  }

  // ── 4. Tampered signature ─────────────────────────────────────────────────
  console.log("\n4. Tampered signature");
  {
    const { nonce, message, issuedAt } = createNonce(alice.address);
    const signature = await signMessage(alice, message);
    // Flip a hex char in the middle of the signature
    const tampered = signature.slice(0, 20) + (signature[20] === "0" ? "1" : "0") + signature.slice(21);
    const result   = verifyAndConsume({ walletInput: alice.address, nonce, signature: tampered, issuedAt });
    assert(!result.ok, "tampered signature is rejected", `got: ${JSON.stringify(result)}`);
  }

  // ── 5. Session isolation ──────────────────────────────────────────────────
  console.log("\n5. Session isolation");
  {
    const { token: aliceToken } = createSession(alice.address);
    const { token: bobToken   } = createSession(bob.address);
    assert(getSessionWallet(aliceToken) === alice.address, "alice's token resolves to alice");
    assert(getSessionWallet(bobToken)   === bob.address,   "bob's token resolves to bob");
    assert(getSessionWallet(aliceToken) !== bob.address,   "alice's token never resolves to bob");
    assert(getSessionWallet("deadbeef" .repeat(8)) === null, "random token resolves to nobody");
    revokeSession(aliceToken);
    revokeSession(bobToken);
  }

  // ── 6. Bad input doesn't crash ────────────────────────────────────────────
  console.log("\n6. Bad input");
  {
    let threw = false;
    try { createNonce("not-an-address"); } catch { threw = true; }
    assert(threw, "createNonce throws on invalid address");

    assert(getSessionWallet(null) === null, "null token → null");
    assert(getSessionWallet("")   === null, "empty token → null");
    assert(getSessionWallet(123)  === null, "non-string token → null");
  }

  console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(2);
});
