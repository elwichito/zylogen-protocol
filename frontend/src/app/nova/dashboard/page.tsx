"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScarcityData {
  remaining: number;
  claimed: number;
  cap: number;
}

interface ChatMessage {
  role: "user" | "nova";
  text: string;
}

interface StatusData {
  stage?: string;          // legacy field; we no longer drive UI off this
  hasPaid?: boolean;       // optional new field; we infer from stage anyway
  referralCode?: string | null;
  referralCount?: number;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const SCARCITY_POLL_MS = 60_000;
const HISTORY_LIMIT = 20;

// ─── Component ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [scarcity, setScarcity] = useState<ScarcityData | null>(null);
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── URL params ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    setEmail(p.get("email"));
    setTxHash(p.get("tx"));
  }, []);

  // ── Poll /status to confirm escrow is locked, then unlock UI ──────────────
  useEffect(() => {
    if (!email) return;
    let alive = true;

    async function fetchStatus() {
      try {
        const res = await fetch(`${BACKEND}/api/nova/status?email=${encodeURIComponent(email!)}`);
        const data: StatusData = await res.json();
        if (!alive) return;
        setStatus(data);
        // Stage is non-null once the webhook lands the escrow row. We treat
        // ANY value other than "not_started" as "paid" for unlocking the
        // chat. The chat itself is the deliverable.
        if (data.stage && data.stage !== "not_started") setUnlocked(true);
      } catch {/* keep polling */}
    }

    fetchStatus();
    const id = setInterval(fetchStatus, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [email]);

  // ── Scarcity ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchScarcity() {
      try {
        const res = await fetch(`${BACKEND}/api/nova/scarcity`, { cache: "no-store" });
        setScarcity(await res.json());
      } catch {/* ignore */}
    }
    fetchScarcity();
    const id = setInterval(fetchScarcity, SCARCITY_POLL_MS);
    return () => clearInterval(id);
  }, []);

  // ── Welcome message once chat unlocks ─────────────────────────────────────
  useEffect(() => {
    if (!unlocked || chatLog.length > 0) return;
    setChatLog([{
      role: "nova",
      text:
        "Welcome. I'm Nova — your 1:1 consultant for the time you sit down to think about your project.\n\n" +
        "Brand, naming, copy, go-to-market, AI / web3 / Base stack decisions — ask me anything. I keep it short and direct.\n\n" +
        "What are you working on?",
    }]);
  }, [unlocked, chatLog.length]);

  // ── Auto-scroll on new message ────────────────────────────────────────────
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chatLog, sending]);

  // ── Focus input on unlock ────────────────────────────────────────────────
  useEffect(() => {
    if (unlocked && inputRef.current) inputRef.current.focus();
  }, [unlocked]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !email || sending) return;

    setDraft("");
    setError(null);
    setSending(true);
    const userTurn: ChatMessage = { role: "user", text };
    const nextLog = [...chatLog, userTurn];
    setChatLog(nextLog);

    // History payload: oldest→newest, last HISTORY_LIMIT turns BEFORE the
    // current user message (which the backend treats as `message`).
    const history = chatLog.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role === "nova" ? "assistant" : "user",
      content: m.text,
    }));

    try {
      const res = await fetch(`${BACKEND}/api/nova/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "nova_error");
      setChatLog([...nextLog, { role: "nova", text: data.reply ?? "(no reply)" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nova error");
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [draft, email, sending, chatLog]);

  // ── No session ────────────────────────────────────────────────────────────
  if (!email) {
    return (
      <main style={s.page}>
        <FxStyle />
        <header style={s.header}>
          <span style={s.wordmark}>ZYLOGEN · NOVA</span>
        </header>
        <p style={s.dim}>
          No session found.{" "}
          <a href="/nova" style={{ color: "#00e5ff" }}>Return to Nova →</a>
        </p>
      </main>
    );
  }

  return (
    <main style={s.page}>
      <FxStyle />
      <div style={s.scanlines} aria-hidden />

      {/* ── Header ── */}
      <header style={s.header}>
        <span style={s.wordmark}>ZYLOGEN · NOVA</span>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {scarcity && (
            <span style={s.scarcityBadge}>
              Founding 100 · {scarcity.remaining}/{scarcity.cap}
            </span>
          )}
          <a href="/nova" style={s.ghostLink}>← Back</a>
        </div>
      </header>

      {/* ── Payment confirmed banner ── */}
      <div style={s.confirmBanner}>
        <span style={s.confirmDot} />
        <span style={s.confirmText}>Payment confirmed on Base</span>
        {txHash && (
          <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" style={s.txLink}>
            View on Basescan ↗
          </a>
        )}
      </div>

      {/* ── Loading state ── */}
      {!unlocked && (
        <div style={s.loadingBox}>
          <span style={s.loadingPulse} />
          <p style={s.loadingText}>Establishing secure session with Nova…</p>
          <p style={s.dimSmall}>
            This usually takes a few seconds while the on-chain lock confirms.
          </p>
        </div>
      )}

      {/* ── Chat ── */}
      {unlocked && (
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask Nova anything…"
              style={s.input}
              disabled={sending}
              maxLength={1000}
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
      )}

      <footer style={s.footer}>
        <span style={s.dim}>{email}</span>
        {status?.referralCode && (
          <span style={s.dim}>
            ref: <span style={{ color: "#00e5ff" }}>{status.referralCode}</span>
            {(status.referralCount ?? 0) > 0 && ` · ${status.referralCount} referred`}
          </span>
        )}
      </footer>
    </main>
  );
}

// ─── FX styles (CSS keyframes — inline) ─────────────────────────────────────

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

      @keyframes nova-status-pulse {
        0%, 100% { opacity: 0.6; }
        50%      { opacity: 1; }
      }
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
  ghostLink: { fontSize: "11px", color: "#606060", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em", textDecoration: "none" },
  scarcityBadge: { fontSize: "10px", letterSpacing: "0.12em", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", padding: "4px 10px", border: "1px solid #1a2a2a", borderRadius: "2px", background: "#0a1214" },

  confirmBanner: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px", padding: "10px 14px", border: "1px solid #1a2a1a", borderRadius: "2px", background: "#0a140a", position: "relative", zIndex: 2 },
  confirmDot: { width: "6px", height: "6px", borderRadius: "50%", background: "#00ff88", flexShrink: 0, boxShadow: "0 0 6px #00ff88" },
  confirmText: { fontSize: "11px", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em", flex: 1 },
  txLink: { fontSize: "10px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em", flexShrink: 0, textDecoration: "none" },

  loadingBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "48px 24px", border: "1px solid #1a2a2a", borderRadius: "2px", background: "#0d1117", position: "relative", zIndex: 2 },
  loadingPulse: { width: "10px", height: "10px", borderRadius: "50%", background: "#00e5ff", boxShadow: "0 0 16px #00e5ff", animation: "nova-glow-pulse 1.4s ease-in-out infinite" },
  loadingText: { fontSize: "13px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em", margin: 0 },
  dimSmall: { fontSize: "11px", color: "#606060", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.04em", margin: 0 },

  chatPanel: {
    display: "flex", flexDirection: "column", border: "1px solid #1a2a2a",
    borderRadius: "4px", background: "#0d1117", overflow: "hidden",
    position: "relative", zIndex: 2,
    boxShadow: "0 0 24px rgba(0, 229, 255, 0.04), inset 0 0 0 1px rgba(0, 229, 255, 0.04)",
  },
  chatTermBar: {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "10px 16px", background: "#0a1214",
    borderBottom: "1px solid #1a2a2a",
  },
  chatTermDot: { width: "8px", height: "8px", borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 6px #00ff88" },
  chatTermPrompt: { fontSize: "11px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em", flex: 1 },
  chatTermStatus: { fontSize: "10px", color: "#606060", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em" },

  chatLog: {
    minHeight: "320px", maxHeight: "60vh", overflowY: "auto",
    padding: "20px", display: "flex", flexDirection: "column", gap: "12px",
  },
  bubble: {
    maxWidth: "88%", padding: "10px 14px", borderRadius: "4px",
    fontSize: "14px", fontFamily: "'Rajdhani',system-ui,sans-serif",
    lineHeight: 1.55, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const,
  },
  bubbleUser: { alignSelf: "flex-end", background: "#161616", color: "#c0c0c0", border: "1px solid #1f1f1f" },
  bubbleNova: { alignSelf: "flex-start", background: "#0a1a12", color: "#d6ffe9", border: "1px solid rgba(0, 255, 136, 0.25)" },

  inputRow: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "12px 16px", borderTop: "1px solid #1a2a2a", background: "#0a1214",
  },
  inputPrompt: { color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", fontSize: "16px", paddingLeft: "2px" },
  input: {
    flex: 1, padding: "10px 12px", background: "transparent",
    border: "none", outline: "none", color: "#e0e0e0",
    fontSize: "14px", fontFamily: "'Share Tech Mono',monospace",
    letterSpacing: "0.02em",
  },
  sendBtn: {
    padding: "8px 18px", background: "#00e5ff", color: "#0a0a0a",
    border: "none", borderRadius: "2px", fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase" as const,
    cursor: "pointer", fontFamily: "'Share Tech Mono',monospace",
    transition: "all 150ms ease",
  },
  sendBtnDisabled: { background: "#1a2a2a", color: "#506060", cursor: "not-allowed" },

  errNote: { fontSize: "12px", color: "#ef4444", fontFamily: "'Share Tech Mono',monospace", padding: "10px 16px", borderTop: "1px solid #2a1a1a", background: "#140a0a" },

  footer: { marginTop: "auto", paddingTop: "32px", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" as const, position: "relative", zIndex: 2 },
  dim: { fontSize: "10px", color: "#404040", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em" },
};
