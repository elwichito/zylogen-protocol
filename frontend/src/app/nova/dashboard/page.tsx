"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "nova";
  text: string;
  createdAt?: string;
}

interface SubscriptionStatus {
  active: boolean;
  status?: string;
  foundingMember?: boolean;
  source?: string;
  currentPeriodEnd?: string | null;
  canceledAt?: string | null;
}

type AuthPhase = "checking" | "guest" | "signing" | "authed";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

const fetchJson = (path: string, init?: RequestInit) =>
  fetch(`${BACKEND}${path}`, { credentials: "include", ...init }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error ?? `http_${r.status}`), { status: r.status, data });
    return data;
  });

// ─── Component ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [authPhase, setAuthPhase]     = useState<AuthPhase>("checking");
  const [authedWallet, setAuthedWallet] = useState<string | null>(null);
  const [sub, setSub]                 = useState<SubscriptionStatus | null>(null);
  const [chatLog, setChatLog]         = useState<ChatMessage[]>([]);
  const [draft, setDraft]             = useState("");
  const [sending, setSending]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── 1. Cookie probe on mount ─────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    fetchJson("/api/auth/me")
      .then((d) => {
        if (!alive) return;
        setAuthedWallet(d.wallet);
        setAuthPhase("authed");
      })
      .catch(() => alive && setAuthPhase("guest"));
    return () => { alive = false; };
  }, []);

  // ── 2. Once authed: load subscription + chat history in parallel ─────────
  useEffect(() => {
    if (authPhase !== "authed") return;
    let alive = true;

    Promise.all([
      fetchJson("/api/nova/subscription/status"),
      fetchJson("/api/nova/history"),
    ])
      .then(([s, h]) => {
        if (!alive) return;
        setSub(s);
        const msgs: ChatMessage[] = (h.messages ?? []).map((m: { role: "user"|"nova"; text: string; created_at: string }) => ({
          role: m.role, text: m.text, createdAt: m.created_at,
        }));
        // If no history yet but subscription active, show a welcome.
        if (msgs.length === 0 && s.active) {
          msgs.push({
            role: "nova",
            text:
              "Welcome. I'm Nova — your 1:1 consultant for the time you sit down to think about your project.\n\n" +
              "Brand, naming, copy, go-to-market, AI / web3 / Base stack decisions — ask me anything. I keep it short and direct.\n\n" +
              "What are you working on?",
          });
        }
        setChatLog(msgs);
      })
      .catch((err) => { if (alive) setError(err.message); });

    return () => { alive = false; };
  }, [authPhase]);

  // ── 3. Auto-scroll on new message ────────────────────────────────────────
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chatLog, sending]);

  // ── 4. Focus input once chat is interactive ──────────────────────────────
  useEffect(() => {
    if (authPhase === "authed" && sub?.active) inputRef.current?.focus();
  }, [authPhase, sub?.active]);

  // ── Sign-in flow: nonce → sign → verify → cookie set ─────────────────────
  const signIn = useCallback(async () => {
    if (!address) return;
    setError(null);
    setAuthPhase("signing");
    try {
      const { nonce, message, issuedAt } = await fetchJson("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });
      const signature = await signMessageAsync({ account: address, message });
      await fetchJson("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, nonce, signature, issuedAt }),
      });
      setAuthedWallet(address);
      setAuthPhase("authed");
    } catch (err) {
      // user rejected, signature mismatch, network — surface a short message
      const msg = err instanceof Error ? err.message : "sign_in_failed";
      setError(msg === "user rejected the request" ? "Signature cancelled" : msg);
      setAuthPhase("guest");
    }
  }, [address, signMessageAsync]);

  const logOut = useCallback(async () => {
    try { await fetchJson("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setAuthedWallet(null);
    setSub(null);
    setChatLog([]);
    setAuthPhase("guest");
  }, []);

  const openBillingPortal = useCallback(async () => {
    try {
      const { url } = await fetchJson("/api/nova/billing-portal", { method: "POST" });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
    }
  }, []);

  // ── Send a chat message ──────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !sub?.active) return;

    setDraft("");
    setError(null);
    setSending(true);
    const next = [...chatLog, { role: "user" as const, text }];
    setChatLog(next);

    try {
      const { reply } = await fetchJson("/api/nova/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      setChatLog([...next, { role: "nova", text: reply ?? "(no reply)" }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Nova error";
      setError(msg);
      // Roll back the optimistic user turn so they can retry
      setChatLog(chatLog);
      setDraft(text);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [draft, chatLog, sending, sub?.active]);

  // ── Render branches ──────────────────────────────────────────────────────

  // While probing the cookie
  if (authPhase === "checking") {
    return <ShellLoading label="Loading session…" />;
  }

  // Not signed in: login card
  if (authPhase !== "authed") {
    return <LoginCard
      address={address}
      isConnected={isConnected}
      signIn={signIn}
      signing={authPhase === "signing"}
      error={error}
    />;
  }

  // Signed in but no active subscription
  if (sub && !sub.active) {
    return <NoSubCard
      wallet={authedWallet}
      sub={sub}
      logOut={logOut}
    />;
  }

  // Signed in + active subscription → chat
  return (
    <main style={s.page}>
      <FxStyle />
      <div style={s.scanlines} aria-hidden />

      <header style={s.header}>
        <span style={s.wordmark}>ZYLOGEN · NOVA</span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {sub?.foundingMember && <span style={s.foundingBadge}>FOUNDING</span>}
          <button onClick={openBillingPortal} style={s.ghostBtn}>Manage</button>
          <button onClick={logOut} style={s.ghostBtn}>Sign out</button>
        </div>
      </header>

      {/* Active-subscription banner with next-renew date */}
      <div style={s.confirmBanner}>
        <span style={s.confirmDot} />
        <span style={s.confirmText}>
          {sub?.source === "stripe" ? "Subscription active" : "Access active"}
          {sub?.currentPeriodEnd && ` · renews ${fmtDate(sub.currentPeriodEnd)}`}
        </span>
      </div>

      <section style={s.chatPanel}>
        <div style={s.chatTermBar}>
          <span style={s.chatTermDot} />
          <span style={s.chatTermPrompt}>nova@zylogen:~</span>
          <span style={s.chatTermStatus}>{sending ? "● thinking" : "● ready"}</span>
        </div>

        <div ref={logRef} style={s.chatLog}>
          {chatLog.map((m, i) => (
            <div
              key={i}
              style={{ ...s.bubble, ...(m.role === "user" ? s.bubbleUser : s.bubbleNova) }}
              className={m.role === "nova" ? "nova-bubble-glow nova-fade-in" : "nova-fade-in"}
            >
              {m.text}
            </div>
          ))}
          {sending && (
            <div style={{ ...s.bubble, ...s.bubbleNova }} className="nova-bubble-glow">
              <span className="nova-dots"><i /><i /><i /></span>
            </div>
          )}
        </div>

        <div style={s.inputRow}>
          <span style={s.inputPrompt}>›</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask Nova anything…"
            style={s.input}
            disabled={sending}
            maxLength={4000}
          />
          <button
            onClick={send}
            disabled={!draft.trim() || sending}
            style={{ ...s.sendBtn, ...((!draft.trim() || sending) ? s.sendBtnDisabled : {}) }}
          >
            {sending ? "…" : "SEND"}
          </button>
        </div>

        {error && <p style={s.errNote}>⚠ {error}</p>}
      </section>

      <footer style={s.footer}>
        <span style={s.dim}>{shortWallet(authedWallet)}</span>
        {isConnected && address && authedWallet && address.toLowerCase() !== authedWallet.toLowerCase() && (
          <span style={{ ...s.dim, color: "#f59e0b" }}>
            ⚠ connected wallet doesn't match signed-in wallet
          </span>
        )}
      </footer>
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ShellLoading({ label }: { label: string }) {
  return (
    <main style={s.page}>
      <FxStyle />
      <header style={s.header}><span style={s.wordmark}>ZYLOGEN · NOVA</span></header>
      <div style={s.loadingBox}>
        <span style={s.loadingPulse} />
        <p style={s.loadingText}>{label}</p>
      </div>
    </main>
  );
}

function LoginCard({
  address, isConnected, signIn, signing, error,
}: {
  address?: `0x${string}`;
  isConnected: boolean;
  signIn: () => void;
  signing: boolean;
  error: string | null;
}) {
  return (
    <main style={s.page}>
      <FxStyle />
      <header style={s.header}><span style={s.wordmark}>ZYLOGEN · NOVA</span></header>

      <section style={s.loginCard}>
        <p style={s.eyebrow}>Sign in</p>
        <h1 style={s.loginHead}>Enter Nova</h1>
        <p style={s.loginSub}>
          Connect the wallet you used to subscribe, then sign a one-time
          message. We don't ask for any transaction — just proof that you
          hold the wallet.
        </p>

        <div style={s.loginSteps}>
          <div style={s.loginStep}>
            <span style={s.loginStepNum}>1</span>
            <span style={s.loginStepLabel}>Connect wallet</span>
            <div style={{ marginTop: 8 }}>
              <ConnectButton label="CONNECT" chainStatus="none" accountStatus="address" />
            </div>
          </div>

          <div style={{ ...s.loginStep, opacity: isConnected ? 1 : 0.4 }}>
            <span style={s.loginStepNum}>2</span>
            <span style={s.loginStepLabel}>Sign to enter</span>
            <button
              onClick={signIn}
              disabled={!isConnected || signing}
              style={{
                ...s.primaryBtn,
                marginTop: 8,
                opacity: !isConnected || signing ? 0.5 : 1,
                cursor: !isConnected || signing ? "not-allowed" : "pointer",
              }}
            >
              {signing ? "Signing…" : "Sign message"}
            </button>
          </div>
        </div>

        {error && <p style={s.errNote}>⚠ {error}</p>}

        <p style={s.loginFootnote}>
          New here? <a href="/nova" style={{ color: "#00e5ff" }}>Subscribe to Nova →</a>
        </p>

        {address && (
          <p style={s.dim}>connected: {shortWallet(address)}</p>
        )}
      </section>
    </main>
  );
}

function NoSubCard({
  wallet, sub, logOut,
}: {
  wallet: string | null;
  sub: SubscriptionStatus;
  logOut: () => void;
}) {
  const isCanceled = sub.status === "canceled" || !!sub.canceledAt;
  const isPastDue  = sub.status === "past_due";

  return (
    <main style={s.page}>
      <FxStyle />
      <header style={s.header}>
        <span style={s.wordmark}>ZYLOGEN · NOVA</span>
        <button onClick={logOut} style={s.ghostBtn}>Sign out</button>
      </header>

      <section style={s.loginCard}>
        <p style={s.eyebrow}>No active subscription</p>
        <h1 style={s.loginHead}>
          {isPastDue ? "Payment failed" : isCanceled ? "Subscription ended" : "Subscribe to chat"}
        </h1>
        <p style={s.loginSub}>
          {isPastDue
            ? "Your last payment didn't go through and access is paused. Re-subscribe to resume."
            : isCanceled
            ? "Your subscription was canceled. Re-subscribe to come back — note the founding rate is no longer locked."
            : "Subscribe to start a 1:1 chat with Nova. $9.99/month if founding slots remain, $29.99/month after."}
        </p>

        <a href="/nova" style={{ ...s.primaryBtn, textDecoration: "none", display: "inline-block", marginTop: 16 }}>
          GO TO PRICING
        </a>

        <p style={{ ...s.dim, marginTop: 20 }}>{shortWallet(wallet)}</p>
      </section>
    </main>
  );
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function shortWallet(w?: string | null): string {
  if (!w) return "—";
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return iso; }
}

// ─── FX styles ──────────────────────────────────────────────────────────────

function FxStyle() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      @keyframes nova-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .nova-fade-in { animation: nova-fade-in 200ms ease-out both; }

      @keyframes nova-glow-pulse {
        0%, 100% { box-shadow: 0 0 0 1px rgba(0, 255, 136, 0.30), 0 0 12px rgba(0, 255, 136, 0.15); }
        50%      { box-shadow: 0 0 0 1px rgba(0, 255, 136, 0.45), 0 0 22px rgba(0, 255, 136, 0.28); }
      }
      .nova-bubble-glow { animation: nova-glow-pulse 4s ease-in-out infinite; }

      @keyframes nova-dot-bounce {
        0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
        40%           { opacity: 1;   transform: translateY(-3px); }
      }
      .nova-dots { display: inline-flex; gap: 4px; padding: 4px 2px; }
      .nova-dots i {
        width: 6px; height: 6px; border-radius: 50%;
        background: #00ff88;
        animation: nova-dot-bounce 1.2s infinite ease-in-out;
      }
      .nova-dots i:nth-child(2) { animation-delay: 0.18s; }
      .nova-dots i:nth-child(3) { animation-delay: 0.36s; }
    ` }} />
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", maxWidth: "720px", margin: "0 auto",
    padding: "0 24px 80px", display: "flex", flexDirection: "column",
    background: "#0a0a0a", position: "relative", overflow: "hidden",
  },
  scanlines: {
    position: "fixed", inset: 0, pointerEvents: "none",
    background: "repeating-linear-gradient(to bottom, transparent 0, transparent 3px, rgba(255,255,255,0.012) 3px, rgba(255,255,255,0.012) 4px)",
    zIndex: 1,
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    paddingTop: "32px", paddingBottom: "24px", position: "relative", zIndex: 2,
  },
  wordmark: { fontSize: "11px", letterSpacing: "0.22em", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", fontWeight: 600 },
  foundingBadge: { fontSize: "9px", letterSpacing: "0.16em", color: "#0a0a0a", background: "#00ff88", padding: "3px 8px", borderRadius: "2px", fontFamily: "'Share Tech Mono',monospace", fontWeight: 700 },
  ghostBtn: { background: "transparent", border: "1px solid #1a2a2a", color: "#808080", fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase" as const, padding: "6px 12px", borderRadius: "2px", cursor: "pointer", fontFamily: "'Share Tech Mono',monospace" },

  // Login / no-sub cards (reuse same chrome)
  loginCard: {
    border: "1px solid #1a2a2a", borderRadius: "4px", background: "#0d1117",
    padding: "32px", position: "relative", zIndex: 2,
    boxShadow: "0 0 24px rgba(0, 229, 255, 0.04)",
  },
  eyebrow: { fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase" as const, color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", marginBottom: "10px" },
  loginHead: { fontSize: "28px", fontWeight: 700, color: "#ffffff", marginBottom: "12px", fontFamily: "'Rajdhani',system-ui,sans-serif", letterSpacing: "-0.01em" },
  loginSub: { fontSize: "14px", lineHeight: 1.6, color: "#808080", marginBottom: "28px", fontFamily: "'Rajdhani',system-ui,sans-serif" },
  loginSteps: { display: "flex", flexDirection: "column", gap: "20px" },
  loginStep: { display: "flex", flexDirection: "column", gap: "4px", transition: "opacity 200ms ease" },
  loginStepNum: { display: "inline-block", width: "22px", height: "22px", lineHeight: "22px", textAlign: "center" as const, fontSize: "11px", color: "#00e5ff", border: "1px solid rgba(0,229,255,0.4)", borderRadius: "50%", fontFamily: "'Share Tech Mono',monospace" },
  loginStepLabel: { fontSize: "13px", color: "#c0c0c0", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.05em" },
  loginFootnote: { marginTop: "24px", fontSize: "12px", color: "#606060", fontFamily: "'Share Tech Mono',monospace" },

  primaryBtn: { padding: "12px 24px", background: "#00e5ff", color: "#0a0a0a", border: "none", borderRadius: "2px", fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: "'Share Tech Mono',monospace", textAlign: "center" as const },

  confirmBanner: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px", padding: "10px 14px", border: "1px solid #1a2a1a", borderRadius: "2px", background: "#0a140a", position: "relative", zIndex: 2 },
  confirmDot: { width: "6px", height: "6px", borderRadius: "50%", background: "#00ff88", flexShrink: 0, boxShadow: "0 0 6px #00ff88" },
  confirmText: { fontSize: "11px", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em", flex: 1 },

  loadingBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "48px 24px", border: "1px solid #1a2a2a", borderRadius: "2px", background: "#0d1117", position: "relative", zIndex: 2 },
  loadingPulse: { width: "10px", height: "10px", borderRadius: "50%", background: "#00e5ff", boxShadow: "0 0 16px #00e5ff", animation: "nova-glow-pulse 1.4s ease-in-out infinite" },
  loadingText: { fontSize: "13px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em", margin: 0 },

  chatPanel: {
    display: "flex", flexDirection: "column", border: "1px solid #1a2a2a",
    borderRadius: "4px", background: "#0d1117", overflow: "hidden",
    position: "relative", zIndex: 2,
    boxShadow: "0 0 24px rgba(0, 229, 255, 0.04), inset 0 0 0 1px rgba(0, 229, 255, 0.04)",
  },
  chatTermBar: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", background: "#0a1214", borderBottom: "1px solid #1a2a2a" },
  chatTermDot: { width: "8px", height: "8px", borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 6px #00ff88" },
  chatTermPrompt: { fontSize: "11px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em", flex: 1 },
  chatTermStatus: { fontSize: "10px", color: "#606060", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em" },

  chatLog: { minHeight: "320px", maxHeight: "60vh", overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" },
  bubble: { maxWidth: "88%", padding: "10px 14px", borderRadius: "4px", fontSize: "14px", fontFamily: "'Rajdhani',system-ui,sans-serif", lineHeight: 1.55, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const },
  bubbleUser: { alignSelf: "flex-end", background: "#161616", color: "#c0c0c0", border: "1px solid #1f1f1f" },
  bubbleNova: { alignSelf: "flex-start", background: "#0a1a12", color: "#d6ffe9", border: "1px solid rgba(0, 255, 136, 0.25)" },

  inputRow: { display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px", borderTop: "1px solid #1a2a2a", background: "#0a1214" },
  inputPrompt: { color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", fontSize: "16px", paddingLeft: "2px" },
  input: { flex: 1, padding: "10px 12px", background: "transparent", border: "none", outline: "none", color: "#e0e0e0", fontSize: "14px", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.02em" },
  sendBtn: { padding: "8px 18px", background: "#00e5ff", color: "#0a0a0a", border: "none", borderRadius: "2px", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: "'Share Tech Mono',monospace", transition: "all 150ms ease" },
  sendBtnDisabled: { background: "#1a2a2a", color: "#506060", cursor: "not-allowed" },

  errNote: { fontSize: "12px", color: "#ef4444", fontFamily: "'Share Tech Mono',monospace", padding: "10px 16px", borderTop: "1px solid #2a1a1a", background: "#140a0a" },

  footer: { marginTop: "auto", paddingTop: "32px", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" as const, position: "relative", zIndex: 2 },
  dim: { fontSize: "10px", color: "#404040", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em" },
};
