"use client";

import { useState, useCallback, useEffect } from "react";
import ScarcityCounter from "../../components/ScarcityCounter";

type Step = 0 | 1 | 2;   // 0=connect wallet  1=enter email  2=pay
type PayState = "idle" | "loading" | "redirecting" | "cancelled" | "sold_out";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export default function NovaPage() {
  const [step,         setStep]         = useState<Step>(0);
  const [wallet,       setWallet]       = useState<string | null>(null);
  const [email,        setEmail]        = useState("");
  const [payState,     setPayState]     = useState<PayState>("idle");
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [noMetaMask,   setNoMetaMask]   = useState(false);

  // ─── Restore cancelled state from Stripe return ───────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("payment") === "cancelled") {
      setPayState("cancelled");
      window.history.replaceState({}, "", "/nova");
    }
  }, []);

  // ─── Step 01: Connect MetaMask ────────────────────────────────────────────

  const connectWallet = useCallback(async () => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<string[]> } }).ethereum;
    if (!eth) { setNoMetaMask(true); return; }
    setErrorMsg(null);
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (accounts[0]) {
        setWallet(accounts[0]);
        setStep(1);
      }
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 4001) {
        setErrorMsg("Wallet connection rejected.");
      } else {
        setErrorMsg("Could not connect wallet. Try again.");
      }
    }
  }, []);

  // ─── Step 02 → 03: Validate email ────────────────────────────────────────

  const handleEmailSubmit = useCallback(() => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMsg("Enter a valid email address.");
      return;
    }
    setErrorMsg(null);
    setStep(2);
  }, [email]);

  // ─── Step 03: Stripe checkout ─────────────────────────────────────────────

  const handleCheckout = useCallback(async () => {
    if (!wallet) return;
    setErrorMsg(null);
    setPayState("loading");
    try {
      const res = await fetch(`${BACKEND}/api/nova/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, email }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "sold_out") { setPayState("sold_out"); return; }
        throw new Error(data.message ?? "Checkout failed.");
      }

      setPayState("redirecting");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setPayState("idle");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }, [wallet, email]);

  // ─── Pay button state ─────────────────────────────────────────────────────

  const payDisabled = payState === "loading" || payState === "redirecting" || payState === "sold_out";
  const payLabel =
    payState === "loading"     ? "Preparing checkout…"
    : payState === "redirecting" ? "Redirecting to Stripe…"
    : payState === "sold_out"    ? "Sold Out"
    : "Hire Nova — $9.99";

  return (
    <main style={s.page}>
      {/* ── Header ── */}
      <header style={s.header}>
        <span style={s.wordmark}>ZYLOGEN</span>
        {wallet && (
          <span style={s.walletPill}>
            {wallet.slice(0, 6)}…{wallet.slice(-4)}
          </span>
        )}
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
          {step === 0 && !noMetaMask && (
            <>
              <button onClick={connectWallet} style={s.primaryBtn}>
                Connect MetaMask
              </button>
              {errorMsg && <p style={s.errNote}>{errorMsg}</p>}
            </>
          )}
          {step === 0 && noMetaMask && (
            <p style={s.errNote}>
              MetaMask not detected.{" "}
              <a href="https://metamask.io" target="_blank" rel="noreferrer" style={{ color: "#c9a96e" }}>
                Install it here →
              </a>
            </p>
          )}
          {step > 0 && (
            <p style={s.completedNote}>✓ {wallet?.slice(0, 6)}…{wallet?.slice(-4)}</p>
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
        <StepRow num="03" title="Founding 100 — $9.99" isActive={step === 2} isComplete={false} isLocked={step < 2}>
          {step === 2 && (
            <>
              <div style={s.priceRow}>
                <span style={s.price}>$9.99</span>
                <span style={s.priceSub}>one-time · Founding 100 rate</span>
                <span style={s.priceBadge}>LOCKED IN FOREVER</span>
              </div>
              <button
                onClick={handleCheckout}
                disabled={payDisabled}
                style={{ ...s.primaryBtn, opacity: payDisabled ? 0.45 : 1, cursor: payDisabled ? "wait" : "pointer" }}
              >
                {payLabel}
              </button>
              {payState === "cancelled" && (
                <p style={{ ...s.hint, color: "#f59e0b" }}>Payment cancelled — your spot is still open.</p>
              )}
              {errorMsg && <p style={s.errNote}>{errorMsg}</p>}
              <p style={s.secNote}>🔒 Processed by Stripe. We never touch your card details.</p>
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
        <span style={{ fontSize: "11px", letterSpacing: "0.12em", fontFamily: "system-ui,sans-serif", fontWeight: 600, minWidth: "20px",
          color: isComplete ? "#4a7c59" : isActive ? "#c9a96e" : "#2a2a2a" }}>
          {num}
        </span>
        <h2 style={{ fontSize: "18px", fontWeight: 400, letterSpacing: "-0.01em",
          color: isLocked ? "#2a2a2a" : isComplete ? "#4a4a4a" : "#e8e3dc" }}>
          {title}
        </h2>
      </div>
      {children && <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{children}</div>}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:         { minHeight: "100vh", maxWidth: "560px", margin: "0 auto", padding: "0 24px 80px", display: "flex", flexDirection: "column" },
  header:       { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "32px", paddingBottom: "64px" },
  wordmark:     { fontSize: "11px", letterSpacing: "0.22em", color: "#3a3a3a", fontFamily: "system-ui,sans-serif", fontWeight: 600 },
  walletPill:   { fontSize: "11px", color: "#4a4a4a", fontFamily: "system-ui,sans-serif", letterSpacing: "0.08em", border: "1px solid #1e1e1e", padding: "4px 10px", borderRadius: "999px" },
  hero:         { marginBottom: "48px" },
  eyebrow:      { fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#c9a96e", fontFamily: "system-ui,sans-serif", marginBottom: "20px" },
  headline:     { fontSize: "clamp(36px,8vw,52px)", fontWeight: 400, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#e8e3dc", marginBottom: "20px" },
  accent:       { fontStyle: "italic", color: "#c9a96e" },
  subline:      { fontSize: "15px", lineHeight: 1.7, color: "#6b6b6b", fontFamily: "system-ui,sans-serif", maxWidth: "420px" },
  scarcityWrap: { marginBottom: "40px" },
  card:         { border: "1px solid #1a1a1a", borderRadius: "2px", padding: "36px", marginBottom: "64px", background: "#0d0d0d", display: "flex", flexDirection: "column", gap: "0" },
  divider:      { height: "1px", background: "#141414", margin: "24px 0" },
  primaryBtn:   { display: "block", width: "100%", padding: "14px 24px", background: "#c9a96e", color: "#080808", border: "none", borderRadius: "2px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: "system-ui,sans-serif", textAlign: "center", transition: "opacity 0.2s ease" },
  input:        { width: "100%", padding: "12px 14px", background: "#111", border: "1px solid #222", borderRadius: "2px", color: "#e8e3dc", fontSize: "14px", fontFamily: "system-ui,sans-serif", outline: "none" },
  priceRow:     { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" },
  price:        { fontSize: "28px", fontWeight: 400, color: "#e8e3dc", letterSpacing: "-0.02em" },
  priceSub:     { fontSize: "12px", color: "#4a4a4a", fontFamily: "system-ui,sans-serif", letterSpacing: "0.06em" },
  priceBadge:   { fontSize: "9px", letterSpacing: "0.16em", background: "#1a1a0a", color: "#c9a96e", padding: "3px 7px", borderRadius: "2px", fontFamily: "system-ui,sans-serif", fontWeight: 600, border: "1px solid #2a2a10" },
  completedNote:{ fontSize: "13px", color: "#4a7c59", fontFamily: "system-ui,sans-serif" },
  lockedNote:   { fontSize: "12px", color: "#2a2a2a", fontFamily: "system-ui,sans-serif", letterSpacing: "0.06em" },
  hint:         { fontSize: "12px", fontFamily: "system-ui,sans-serif", textAlign: "center" },
  errNote:      { fontSize: "12px", color: "#ef4444", fontFamily: "system-ui,sans-serif" },
  secNote:      { fontSize: "11px", color: "#2e2e2e", fontFamily: "system-ui,sans-serif", textAlign: "center" },
  features:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px 24px", marginBottom: "64px" },
  featureItem:  { display: "flex", flexDirection: "column", gap: "6px" },
  featureTitle: { fontSize: "12px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#3a3a3a", fontFamily: "system-ui,sans-serif" },
  featureDesc:  { fontSize: "13px", lineHeight: 1.6, color: "#4a4a4a", fontFamily: "system-ui,sans-serif" },
  footer:       { display: "flex", gap: "16px", fontSize: "11px", color: "#2a2a2a", fontFamily: "system-ui,sans-serif", letterSpacing: "0.08em", marginTop: "auto" },
};
