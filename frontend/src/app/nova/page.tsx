"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseAbi } from "viem";
import ScarcityCounter from "../../components/ScarcityCounter";

type Step = 0 | 1 | 2;
type PayState = "idle" | "loading" | "redirecting" | "cancelled" | "sold_out";
type CryptoState = "idle" | "approving" | "locking" | "confirming" | "done" | "error";
type Tier = "founding" | "regular" | null;

const FOUNDING_PRICE = "$9.99";
const REGULAR_PRICE  = "$29.99";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const REFERRAL_STORAGE_KEY = "zyl_referral_code";

// ─── Contract addresses (from env, with mainnet defaults) ───────────────────
const USDC_BASE     = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
// Treasury wallet receives the monthly USDC payment. Falls back to the legacy
// worker address for local dev where the env var isn't set yet.
const NOVA_TREASURY = (process.env.NEXT_PUBLIC_NOVA_TREASURY_ADDRESS
                    ?? process.env.NEXT_PUBLIC_NOVA_WORKER_ADDRESS
                    ?? "0x9e80b1aa9c7C2a8B875CC569D8E30cEfB364c9aD") as `0x${string}`;
const USDC_MONTHLY  = BigInt(9_990_000); // $9.99 USDC (6 decimals)

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) external returns (bool)",
]);

export default function NovaPage() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [step,         setStep]         = useState<Step>(0);
  const [email,        setEmail]        = useState("");
  const [payState,     setPayState]     = useState<PayState>("idle");
  const [cryptoState,  setCryptoState]  = useState<CryptoState>("idle");
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [payTxHash,    setPayTxHash]    = useState<`0x${string}` | undefined>();
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [tier, setTier]                 = useState<Tier>(null);

  // Probe scarcity once on mount so the price displayed matches the price
  // the backend will charge. ScarcityCounter polls separately for the live
  // counter; this is just for the tier decision.
  useEffect(() => {
    fetch(`${BACKEND}/api/nova/scarcity`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTier(d.remaining > 0 ? "founding" : "regular"))
      .catch(() => setTier("regular")); // fail-safe: assume regular price
  }, []);

  // ─── Auto-advance when wallet connects ──────────────────────────────────
  useEffect(() => {
    if (isConnected && address && step === 0) setStep(1);
  }, [isConnected, address, step]);

  // ─── Restore cancelled state + handle referral param ────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);

    // Handle payment cancelled
    if (p.get("payment") === "cancelled") {
      setPayState("cancelled");
      window.history.replaceState({}, "", "/nova");
    }

    // Handle referral code from URL
    const refCode = p.get("ref");
    if (refCode && refCode.length === 8) {
      localStorage.setItem(REFERRAL_STORAGE_KEY, refCode.toUpperCase());
      setReferralCode(refCode.toUpperCase());
      // Clean URL without losing other params
      window.history.replaceState({}, "", "/nova");
      // Validate the code
      validateReferralCode(refCode.toUpperCase());
    } else {
      // Check localStorage for existing referral
      const storedRef = localStorage.getItem(REFERRAL_STORAGE_KEY);
      if (storedRef) {
        setReferralCode(storedRef);
        validateReferralCode(storedRef);
      }
    }
  }, []);

  // ─── Validate referral code ─────────────────────────────────────────────
  async function validateReferralCode(code: string) {
    try {
      const res = await fetch(`${BACKEND}/api/nova/referral/${code}`);
      const data = await res.json();
      setReferralValid(data.valid === true);
    } catch {
      setReferralValid(false);
    }
  }

  // ─── Contract writes ───────────────────────────────────────────────────
  // Single transfer for the monthly model: USDC.transfer(treasury, amount).
  const { writeContractAsync: transferUsdc } = useWriteContract();

  // Wait for transfer tx confirmation
  const { isSuccess: payConfirmed } = useWaitForTransactionReceipt({ hash: payTxHash });

  // Once the on-chain transfer confirms, ask the backend to verify + credit
  // the subscription, then redirect to the dashboard.
  useEffect(() => {
    if (!payConfirmed || !payTxHash || !address) return;
    setCryptoState("done");

    // Apply referral if present (fire-and-forget — referral data still
    // keyed by email in the legacy table; this whole subsystem migrates
    // in a later PR).
    if (email) {
      const storedRef = localStorage.getItem(REFERRAL_STORAGE_KEY);
      if (storedRef) {
        fetch(`${BACKEND}/api/nova/apply-referral`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, referralCode: storedRef }),
        }).catch(() => {});
        localStorage.removeItem(REFERRAL_STORAGE_KEY);
      }
    }

    fetch(`${BACKEND}/api/nova/crypto-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address, txHash: payTxHash, email: email || undefined }),
    })
      .catch(() => {}) // best-effort — the on-chain tx is the source of truth
      .finally(() => {
        window.location.href = `/nova/dashboard?subscribed=1&tx=${payTxHash}`;
      });
  }, [payConfirmed, payTxHash, email, address]);

  // ─── Step 02 → 03: Validate email ──────────────────────────────────────
  const handleEmailSubmit = useCallback(() => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMsg("Enter a valid email address.");
      return;
    }
    setErrorMsg(null);
    setStep(2);
  }, [email]);

  // ─── Step 03a: Stripe subscription checkout (fiat) ─────────────────────
  const handleStripeCheckout = useCallback(async () => {
    if (!address) return;
    setErrorMsg(null);
    setPayState("loading");
    try {
      const res = await fetch(`${BACKEND}/api/nova/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "sold_out") { setPayState("sold_out"); return; }
        throw new Error(data.error ?? "Subscribe failed.");
      }
      setPayState("redirecting");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setPayState("idle");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }, [address, email]);

  // ─── Step 03b: Native USDC monthly payment (crypto) ────────────────────
  // One tx: USDC.transfer(treasury, $9.99). The backend verifies the
  // Transfer event and credits a month. No escrow, no allowance, no
  // approve dance — the simplest honest path for a monthly model.
  const handleCryptoCheckout = useCallback(async () => {
    if (!address) return;
    setErrorMsg(null);

    // Ensure we're on Base Mainnet
    if (chainId !== base.id) {
      try { switchChain({ chainId: base.id }); } catch { /* user will be prompted */ }
      setErrorMsg("Please switch to Base network in your wallet.");
      return;
    }

    try {
      setCryptoState("locking");                  // re-used label: "Sending USDC…"
      const tx = await transferUsdc({
        address: USDC_BASE,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [NOVA_TREASURY, USDC_MONTHLY],
        chain: base,
        account: address,
      });

      setCryptoState("confirming");
      setPayTxHash(tx);
      // useWaitForTransactionReceipt handles the rest → /crypto-verify in useEffect
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
  }, [address, chainId, switchChain, transferUsdc]);

  // ─── Derived state ────────────────────────────────────────────────────
  const displayPrice = tier === "regular" ? REGULAR_PRICE : FOUNDING_PRICE;

  const stripeDisabled = payState === "loading" || payState === "redirecting" || payState === "sold_out" || cryptoState !== "idle";
  const cryptoDisabled = cryptoState !== "idle" && cryptoState !== "error";

  const stripeLabel =
    payState === "loading"      ? "Preparing checkout…"
    : payState === "redirecting"  ? "Redirecting to Stripe…"
    : payState === "sold_out"     ? "Sold Out"
    : `Subscribe — ${displayPrice}/mo`;

  const cryptoLabel =
    cryptoState === "locking"     ? "Sending USDC…"
    : cryptoState === "confirming"  ? "Confirming on Base…"
    : cryptoState === "done"        ? "✓ Payment confirmed"
    : `Pay with USDC — ${displayPrice}`;

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
        <p style={s.eyebrow}>Nova · 1:1 AI Consultant</p>
        <h1 style={s.headline}>
          Your founder's<br />
          <em style={s.accent}>thinking partner.</em>
        </h1>
        <p style={s.subline}>
          A direct chat with Nova — your AI consultant for naming, copy,
          go-to-market, and the hard product decisions a solo founder makes
          alone. {FOUNDING_PRICE}/month for the first 100 members.
        </p>
        {/* Referral badge */}
        {referralValid && (
          <div style={s.referralBadge}>
            <span style={s.referralDot} />
            Referred by a founding member
          </div>
        )}
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

        {/* Step 03 — Subscribe */}
        <StepRow
          num="03"
          title={tier === "regular" ? `Subscribe — ${REGULAR_PRICE}/mo` : `Founding 100 — ${FOUNDING_PRICE}/mo`}
          isActive={step === 2}
          isComplete={cryptoState === "done"}
          isLocked={step < 2}
        >
          {step === 2 && (
            <>
              <div style={s.priceRow}>
                <span style={s.price}>{displayPrice}</span>
                <span style={s.priceSub}>
                  per month · {tier === "regular" ? "regular rate" : "founding rate"}
                </span>
                <span style={s.priceBadge}>
                  {tier === "regular" ? "STANDARD" : "LOCKED WHILE ACTIVE"}
                </span>
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
                <p style={{ ...s.hint, color: "#f59e0b" }}>Subscription cancelled — your spot is still open.</p>
              )}
              {errorMsg && <p style={s.errNote}>{errorMsg}</p>}
              <p style={s.secNote}>
                Stripe-managed billing · Cancel anytime · Founding rate held while subscription stays active
              </p>
            </>
          )}
          {step < 2 && <p style={s.lockedNote}>Complete steps above to unlock</p>}
        </StepRow>

      </div>

      {/* ── Features ── */}
      <section style={s.features}>
        {[
          ["1:1 chat",          "Direct conversation. No tickets, no queue, no agency middleman."],
          ["Founder context",   "Trained for solo founders on Base — no-budget, no-team realities."],
          ["Strategy on tap",   "Naming, positioning, copy, GTM, hard product calls — ask anything."],
          ["Founding rate",     "First 100 lock $9.99/mo. After that, the rate moves to $29.99/mo."],
          ["Cancel anytime",    "Managed via Stripe. Stop the moment Nova stops being useful."],
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
  referralBadge:{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "20px", padding: "8px 14px", background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.25)", borderRadius: "2px", fontSize: "11px", letterSpacing: "0.1em", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace" },
  referralDot:  { width: "6px", height: "6px", borderRadius: "50%", background: "#00ff88", flexShrink: 0 },
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
