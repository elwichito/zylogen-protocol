"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseAbi, encodePacked, keccak256 } from "viem";
import ScarcityCounter from "../../components/ScarcityCounter";

type Step = 0 | 1 | 2;
type PayState = "idle" | "loading" | "redirecting" | "cancelled" | "sold_out";
type CryptoState = "idle" | "approving" | "locking" | "confirming" | "done" | "error";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

// ─── Contract addresses (Base Mainnet) ──────────────────────────────────────
const TASK_ESCROW = "0xBE464859Fb6f09fa93b6212f616F3AD19ebe48B1" as const;
const USDC_BASE   = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const NOVA_WORKER = "0x9e80b1aa9c7C2a8B875CC569D8E30cEfB364c9aD" as const;
const LOCK_AMOUNT = BigInt(9_000_000); // $9.00 USDC (6 decimals)
const DEADLINE_S  = 24 * 3600;

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

const ESCROW_ABI = parseAbi([
  "function lock(bytes32 taskId, address worker, uint256 amount, uint256 deadline) external",
]);

export default function NovaPage() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [step,         setStep]         = useState<Step>(0);
  const [email,        setEmail]        = useState("");
  const [payState,     setPayState]     = useState<PayState>("idle");
  const [cryptoState,  setCryptoState]  = useState<CryptoState>("idle");
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [lockTxHash,   setLockTxHash]   = useState<`0x${string}` | undefined>();

  // ─── Auto-advance when wallet connects ──────────────────────────────────
  useEffect(() => {
    if (isConnected && address && step === 0) setStep(1);
  }, [isConnected, address, step]);

  // ─── Restore cancelled state from Stripe return ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("payment") === "cancelled") {
      setPayState("cancelled");
      window.history.replaceState({}, "", "/nova");
    }
  }, []);

  // ─── Contract writes ───────────────────────────────────────────────────
  const { writeContractAsync: approveUsdc } = useWriteContract();
  const { writeContractAsync: lockEscrow }  = useWriteContract();

  // Wait for lock tx confirmation
  const { isSuccess: lockConfirmed } = useWaitForTransactionReceipt({ hash: lockTxHash });

  // Redirect to dashboard after lock confirms
  useEffect(() => {
    if (lockConfirmed && lockTxHash && email) {
      setCryptoState("done");
      // Notify backend, then redirect
      fetch(`${BACKEND}/api/nova/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, email, txHash: lockTxHash }),
      })
        .catch(() => {}) // best-effort — the on-chain tx is the source of truth
        .finally(() => {
          window.location.href = `/nova/dashboard?email=${encodeURIComponent(email)}&tx=${lockTxHash}`;
        });
    }
  }, [lockConfirmed, lockTxHash, email, address]);

  // ─── Step 02 → 03: Validate email ──────────────────────────────────────
  const handleEmailSubmit = useCallback(() => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMsg("Enter a valid email address.");
      return;
    }
    setErrorMsg(null);
    setStep(2);
  }, [email]);

  // ─── Step 03a: Stripe checkout (fiat) ──────────────────────────────────
  const handleStripeCheckout = useCallback(async () => {
    if (!address) return;
    setErrorMsg(null);
    setPayState("loading");
    try {
      const res = await fetch(`${BACKEND}/api/nova/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "sold_out") { setPayState("sold_out"); return; }
        throw new Error(data.error ?? "Checkout failed.");
      }
      setPayState("redirecting");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setPayState("idle");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }, [address, email]);

  // ─── Step 03b: Native USDC checkout (crypto) ──────────────────────────
  const handleCryptoCheckout = useCallback(async () => {
    if (!address) return;
    setErrorMsg(null);
    setCryptoState("idle");

    // Ensure we're on Base Mainnet
    if (chainId !== base.id) {
      try { switchChain({ chainId: base.id }); } catch { /* user will be prompted */ }
      setErrorMsg("Please switch to Base network in your wallet.");
      return;
    }

    try {
      // Step A: Approve USDC
      setCryptoState("approving");
      const approveTx = await approveUsdc({
        address: USDC_BASE,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [TASK_ESCROW, LOCK_AMOUNT],
        chain: base,
        account: address,
      });
      // We don't strictly need to wait for approval receipt — lock will revert if not approved.
      // But for UX clarity we do a brief pause:
      await new Promise((r) => setTimeout(r, 2000));

      // Step B: Generate taskId and call lock()
      setCryptoState("locking");
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const taskId = keccak256(
        encodePacked(["address", "address", "uint256"], [address, NOVA_WORKER, timestamp])
      );
      const deadline = timestamp + BigInt(DEADLINE_S);

      const lockTx = await lockEscrow({
        address: TASK_ESCROW,
        abi: ESCROW_ABI,
        functionName: "lock",
        args: [taskId, NOVA_WORKER, LOCK_AMOUNT, deadline],
        chain: base,
        account: address,
      });

      // Step C: Wait for confirmation
      setCryptoState("confirming");
      setLockTxHash(lockTx);
      // useWaitForTransactionReceipt handles the rest → redirect in useEffect
    } catch (err: unknown) {
      setCryptoState("error");
      const msg = (err as { shortMessage?: string })?.shortMessage
        ?? (err instanceof Error ? err.message : "Transaction failed.");
      if (msg.includes("User rejected") || msg.includes("user rejected")) {
        setErrorMsg("Transaction rejected.");
      } else {
        setErrorMsg(msg);
      }
    }
  }, [address, chainId, switchChain, approveUsdc, lockEscrow]);

  // ─── Derived state ────────────────────────────────────────────────────
  const stripeDisabled = payState === "loading" || payState === "redirecting" || payState === "sold_out" || cryptoState !== "idle";
  const cryptoDisabled = cryptoState !== "idle" && cryptoState !== "error";
  const anyPayBusy = stripeDisabled || cryptoDisabled;

  const stripeLabel =
    payState === "loading"      ? "Preparing checkout…"
    : payState === "redirecting"  ? "Redirecting to Stripe…"
    : payState === "sold_out"     ? "Sold Out"
    : "Pay with Card — $9.99";

  const cryptoLabel =
    cryptoState === "approving"   ? "Approving USDC…"
    : cryptoState === "locking"     ? "Locking funds…"
    : cryptoState === "confirming"  ? "Confirming on Base…"
    : cryptoState === "done"        ? "✓ Payment confirmed"
    : "Pay with USDC — $9.99";

  return (
    <main style={s.page}>
      {/* ── Header ── */}
      <header style={s.header}>
        <span style={s.wordmark}>ZYLOGEN</span>
        {isConnected && address ? (
          <span style={s.walletPill}>
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        ) : null}
      </header>

      {/* ── Hero ── */}
      <section style={s.hero}>
        <p style={s.eyebrow}>Nova · AI Branding Consultant</p>
        <h1 style={s.headline}>
          Your brand,<br />
          <em style={s.accent}>architected.</em>
        </h1>
        <p style={s.subline}>
          A complete Instagram identity system — brand voice, visual language,
          30-day content strategy — delivered by an AI consultant trained on
          what actually converts.
        </p>
      </section>

      {/* ── Scarcity ── */}
      <div style={s.scarcityWrap}>
        <ScarcityCounter />
      </div>

      {/* ── 3-step card ── */}
      <div style={s.card}>

        {/* Step 01 — Connect wallet */}
        <StepRow num="01" title="Connect your wallet" isActive={step === 0} isComplete={step > 0} isLocked={false}>
          {step === 0 && (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ConnectButton label="CONNECT WALLET" />
            </div>
          )}
          {step > 0 && address && (
            <p style={s.completedNote}>✓ {address.slice(0, 6)}…{address.slice(-4)}</p>
          )}
        </StepRow>

        <div style={s.divider} />

        {/* Step 02 — Enter email */}
        <StepRow num="02" title="Your email" isActive={step === 1} isComplete={step > 1} isLocked={step < 1}>
          {step === 1 && (
            <>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrorMsg(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleEmailSubmit()}
                style={s.input}
                autoFocus
              />
              <button onClick={handleEmailSubmit} style={s.primaryBtn}>
                Continue
              </button>
              {errorMsg && <p style={s.errNote}>{errorMsg}</p>}
            </>
          )}
          {step > 1 && <p style={s.completedNote}>✓ {email}</p>}
        </StepRow>

        <div style={s.divider} />

        {/* Step 03 — Pay */}
        <StepRow num="03" title="Founding 100 — $9.99" isActive={step === 2} isComplete={cryptoState === "done"} isLocked={step < 2}>
          {step === 2 && (
            <>
              <div style={s.priceRow}>
                <span style={s.price}>$9.99</span>
                <span style={s.priceSub}>one-time · Founding 100 rate</span>
                <span style={s.priceBadge}>LOCKED IN FOREVER</span>
              </div>

              {/* Native USDC button (primary) */}
              <button
                onClick={handleCryptoCheckout}
                disabled={cryptoDisabled}
                style={{
                  ...s.primaryBtn,
                  opacity: cryptoDisabled ? 0.6 : 1,
                  cursor: cryptoDisabled ? "wait" : "pointer",
                  position: "relative",
                }}
              >
                {cryptoState !== "idle" && cryptoState !== "error" && cryptoState !== "done" && (
                  <span style={s.spinner} />
                )}
                {cryptoLabel}
              </button>
              <p style={s.cryptoNote}>Direct on-chain · Base Mainnet · USDC</p>

              {/* Divider between payment methods */}
              <div style={s.orRow}>
                <div style={s.orLine} />
                <span style={s.orText}>OR</span>
                <div style={s.orLine} />
              </div>

              {/* Stripe button (secondary) */}
              <button
                onClick={handleStripeCheckout}
                disabled={stripeDisabled}
                style={{
                  ...s.secondaryBtn,
                  opacity: stripeDisabled ? 0.4 : 1,
                  cursor: stripeDisabled ? "wait" : "pointer",
                }}
              >
                {stripeLabel}
              </button>

              {payState === "cancelled" && (
                <p style={{ ...s.hint, color: "#f59e0b" }}>Payment cancelled — your spot is still open.</p>
              )}
              {errorMsg && <p style={s.errNote}>{errorMsg}</p>}
              <p style={s.secNote}>Escrow-protected · Funds release only on delivery</p>
            </>
          )}
          {step < 2 && <p style={s.lockedNote}>Complete steps above to unlock</p>}
        </StepRow>

      </div>

      {/* ── Features ── */}
      <section style={s.features}>
        {[
          ["Brand Identity",   "Tagline, bio, brand promise, and CTA — ready to copy-paste."],
          ["Visual System",    "Color palette, font pairing, and mood board in your voice."],
          ["Content Strategy", "30-day launch plan, 10 hashtag sets, and 5 viral hooks."],
          ["Voice Guide",      "Dos, don'ts, and 3 example captions in your exact tone."],
        ].map(([t, d]) => (
          <div key={t} style={s.featureItem}>
            <span style={s.featureTitle}>{t}</span>
            <span style={s.featureDesc}>{d}</span>
          </div>
        ))}
      </section>

      <footer style={s.footer}>
        <span>© {new Date().getFullYear()} Zylogen Protocol</span>
        <span style={{ color: "#2a2a2a" }}>·</span>
        <span>Built on-chain. Settled invisibly.</span>
      </footer>
    </main>
  );
}

// ─── StepRow ─────────────────────────────────────────────────────────────────

function StepRow({ num, title, isActive, isComplete, isLocked, children }: {
  num: string; title: string;
  isActive: boolean; isComplete: boolean; isLocked: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", opacity: isLocked ? 0.35 : 1, transition: "opacity 0.3s ease" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
        <span style={{ fontSize: "11px", letterSpacing: "0.12em", fontFamily: "'Share Tech Mono',monospace", fontWeight: 600, minWidth: "20px",
          color: isComplete ? "#00ff88" : isActive ? "#00e5ff" : "#2a2a2a" }}>
          {num}
        </span>
        <h2 style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "0.05em",
          color: isLocked ? "#2a2a2a" : isComplete ? "#606060" : "#ffffff", fontFamily: "'Rajdhani',system-ui,sans-serif" }}>
          {title}
        </h2>
      </div>
      {children && <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{children}</div>}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:         { minHeight: "100vh", maxWidth: "560px", margin: "0 auto", padding: "0 24px 80px", display: "flex", flexDirection: "column", background: "#0a0a0a" },
  header:       { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "32px", paddingBottom: "64px" },
  wordmark:     { fontSize: "11px", letterSpacing: "0.22em", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", fontWeight: 600 },
  walletPill:   { fontSize: "11px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em", border: "1px solid rgba(0,229,255,0.3)", padding: "4px 10px", borderRadius: "999px" },
  hero:         { marginBottom: "48px" },
  eyebrow:      { fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase" as const, color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", marginBottom: "20px" },
  headline:     { fontSize: "clamp(36px,8vw,52px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#ffffff", marginBottom: "20px", fontFamily: "'Rajdhani',system-ui,sans-serif" },
  accent:       { fontStyle: "italic", color: "#00e5ff" },
  subline:      { fontSize: "15px", lineHeight: 1.7, color: "#808080", fontFamily: "'Rajdhani',system-ui,sans-serif", maxWidth: "420px" },
  scarcityWrap: { marginBottom: "40px" },
  card:         { border: "1px solid #1a2a1a", borderRadius: "2px", padding: "36px", marginBottom: "64px", background: "#0d1a12", display: "flex", flexDirection: "column", gap: "0" },
  divider:      { height: "1px", background: "#1a2a1a", margin: "24px 0" },
  primaryBtn:   { display: "block", width: "100%", padding: "14px 24px", background: "#00e5ff", color: "#0a0a0a", border: "none", borderRadius: "2px", fontSize: "13px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: "'Share Tech Mono',monospace", textAlign: "center" as const, transition: "opacity 0.2s ease" },
  secondaryBtn: { display: "block", width: "100%", padding: "14px 24px", background: "transparent", color: "#808080", border: "1px solid #1a2a1a", borderRadius: "2px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: "'Share Tech Mono',monospace", textAlign: "center" as const, transition: "all 0.2s ease" },
  input:        { width: "100%", padding: "12px 14px", background: "#0d1117", border: "1px solid #1a2a1a", borderRadius: "2px", color: "#c0c0c0", fontSize: "14px", fontFamily: "'Share Tech Mono',monospace", outline: "none" },
  priceRow:     { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" as const },
  price:        { fontSize: "28px", fontWeight: 700, color: "#00e5ff", letterSpacing: "-0.02em", fontFamily: "'Rajdhani',system-ui,sans-serif" },
  priceSub:     { fontSize: "12px", color: "#606060", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em" },
  priceBadge:   { fontSize: "9px", letterSpacing: "0.16em", background: "rgba(0,229,255,0.05)", color: "#00e5ff", padding: "3px 7px", borderRadius: "2px", fontFamily: "'Share Tech Mono',monospace", fontWeight: 600, border: "1px solid rgba(0,229,255,0.2)" },
  completedNote:{ fontSize: "13px", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace" },
  lockedNote:   { fontSize: "12px", color: "#2a2a2a", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em" },
  hint:         { fontSize: "12px", fontFamily: "'Share Tech Mono',monospace", textAlign: "center" as const },
  errNote:      { fontSize: "12px", color: "#ef4444", fontFamily: "'Share Tech Mono',monospace" },
  secNote:      { fontSize: "11px", color: "#3a3a3a", fontFamily: "'Share Tech Mono',monospace", textAlign: "center" as const },
  cryptoNote:   { fontSize: "10px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", textAlign: "center" as const, letterSpacing: "0.1em", opacity: 0.6 },
  orRow:        { display: "flex", alignItems: "center", gap: "12px", margin: "4px 0" },
  orLine:       { flex: 1, height: "1px", background: "#1a2a1a" },
  orText:       { fontSize: "10px", color: "#3a3a3a", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.2em" },
  spinner:      { display: "inline-block", width: "12px", height: "12px", border: "2px solid rgba(10,10,10,0.3)", borderTopColor: "#0a0a0a", borderRadius: "50%", marginRight: "8px", verticalAlign: "middle", animation: "spin 0.8s linear infinite" },
  features:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px 24px", marginBottom: "64px" },
  featureItem:  { display: "flex", flexDirection: "column", gap: "6px" },
  featureTitle: { fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace" },
  featureDesc:  { fontSize: "13px", lineHeight: 1.6, color: "#606060", fontFamily: "'Rajdhani',system-ui,sans-serif" },
  footer:       { display: "flex", gap: "16px", fontSize: "11px", color: "#2a2a2a", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em", marginTop: "auto" },
};
