"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Stage = "not_started" | "briefing_q1" | "briefing_q2" | "briefing_q3" | "brief_complete" | "kit_delivered";
type Lang = "en" | "es";

interface StatusData {
  stage: Stage;
  language?: Lang;
  deliveryStatus?: string | null;
  kit?: object | null;
}

interface ScarcityData {
  remaining: number;
  claimed: number;
  cap: number;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const POLL_MS = 6000;
const SCARCITY_POLL_MS = 30_000;

// ─── Chip definitions ───────────────────────────────────────────────────────

const BUSINESS_CHIPS: Record<Lang, string[]> = {
  en: ["Pet brand", "Fashion", "Food & Drink", "Tech / SaaS", "Beauty", "Services"],
  es: ["Mascotas", "Moda", "Comida y Bebida", "Tech / Software", "Belleza", "Servicios"],
};

const VIBE_CHIPS: Record<Lang, { label: string; emoji: string }[]> = {
  en: [
    { emoji: "🤍", label: "Minimal" },
    { emoji: "🌈", label: "Vibrant" },
    { emoji: "📜", label: "Vintage" },
    { emoji: "⚡", label: "Tech / Cyber" },
    { emoji: "🌿", label: "Organic" },
    { emoji: "💎", label: "Luxury" },
  ],
  es: [
    { emoji: "🤍", label: "Minimalista" },
    { emoji: "🌈", label: "Vibrante" },
    { emoji: "📜", label: "Vintage" },
    { emoji: "⚡", label: "Tech / Ciberpunk" },
    { emoji: "🌿", label: "Orgánico" },
    { emoji: "💎", label: "Lujo" },
  ],
};

const OTHER_LABEL: Record<Lang, string> = { en: "Other", es: "Otro" };

// ─── Main component ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [scarcity, setScarcity] = useState<ScarcityData | null>(null);
  const [message, setMessage] = useState("");
  const [chatLog, setChatLog] = useState<{ role: "user" | "nova"; text: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [showOtherInput, setShowOtherInput] = useState(false);

  const lang: Lang = status?.language === "es" ? "es" : "en";

  // ─── Read params from URL ───────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    setEmail(p.get("email"));
    setTxHash(p.get("tx"));
  }, []);

  // ─── Poll status ────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    if (!email) return;
    try {
      const res = await fetch(`${BACKEND}/api/nova/status?email=${encodeURIComponent(email)}`);
      const data: StatusData = await res.json();
      setStatus(data);
    } catch { /* keep polling */ }
  }, [email]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // ─── Poll scarcity ──────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchScarcity() {
      try {
        const res = await fetch(`${BACKEND}/api/nova/scarcity`, { cache: "no-store" });
        const data: ScarcityData = await res.json();
        setScarcity(data);
      } catch { /* ignore */ }
    }
    fetchScarcity();
    const id = setInterval(fetchScarcity, SCARCITY_POLL_MS);
    return () => clearInterval(id);
  }, []);

  // ─── Send message ───────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? message).trim();
    if (!msg || !email) return;
    setMessage("");
    setSending(true);
    setShowOtherInput(false);
    setChatLog((prev) => [...prev, { role: "user", text: msg }]);

    try {
      const res = await fetch(`${BACKEND}/api/nova/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Nova error");

      if (data.reply) setChatLog((prev) => [...prev, { role: "nova", text: data.reply }]);
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nova error");
    } finally {
      setSending(false);
      setSelectedVibes([]);
    }
  }, [message, email, fetchStatus]);

  // ─── Chip handlers ──────────────────────────────────────────────────────

  const handleBusinessChip = (label: string) => {
    if (label === OTHER_LABEL[lang]) {
      setShowOtherInput(true);
      return;
    }
    sendMessage(label);
  };

  const handleVibeToggle = (label: string) => {
    setSelectedVibes((prev) => {
      if (prev.includes(label)) return prev.filter((v) => v !== label);
      if (prev.length >= 2) return prev;
      return [...prev, label];
    });
  };

  const submitVibes = () => {
    if (selectedVibes.length === 0) return;
    sendMessage(selectedVibes.join(", "));
  };

  // ─── Derived ────────────────────────────────────────────────────────────

  const stage = status?.stage ?? "not_started";
  const briefComplete = stage === "brief_complete" || stage === "kit_delivered";
  const isQ1 = stage === "briefing_q1";
  const isQ2 = stage === "briefing_q2";
  const isQ3 = stage === "briefing_q3";

  // ─── No session ─────────────────────────────────────────────────────────

  if (!email) {
    return (
      <main style={s.page}>
        <p style={s.dim}>No session found. <a href="/nova" style={{ color: "#00e5ff" }}>Return to Nova →</a></p>
      </main>
    );
  }

  return (
    <main style={s.page}>
      {/* ── Header with scarcity badge ── */}
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

      {/* ── On-chain confirmation ── */}
      <div style={s.confirmBanner}>
        <span style={s.confirmDot} />
        <span style={s.confirmText}>Payment confirmed on Base</span>
        {txHash && (
          <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" style={s.txLink}>
            View on Basescan ↗
          </a>
        )}
      </div>

      {/* ── Stage indicator ── */}
      <div style={s.stageRow}>
        <span style={s.stageLabel}>
          {stage === "not_started" ? (lang === "es" ? "⏳ Nova está inicializando…" : "⏳ Nova is initialising…")
            : briefComplete ? (lang === "es" ? "✓ Brief recibido — entrega en 24h" : "✓ Brief received — delivery within 24h")
            : (lang === "es" ? "💬 Nova está lista — responde abajo" : "💬 Nova is ready — respond below")}
        </span>
      </div>

      {/* ── Chat interface ── */}
      {status && stage !== "not_started" && (
        <div style={s.chatWrap}>
          <div style={s.chatLog}>
            {chatLog.length === 0 && !briefComplete && (
              <p style={s.chatPlaceholder}>
                {lang === "es"
                  ? "Envía un saludo para comenzar. Nova detectará tu idioma automáticamente."
                  : "Send a greeting to begin. Nova will detect your language automatically."}
              </p>
            )}
            {chatLog.map((m, i) => (
              <div key={i} style={{ ...s.bubble, ...(m.role === "user" ? s.bubbleUser : s.bubbleNova) }}>
                {m.text}
              </div>
            ))}
            {sending && <div style={{ ...s.bubble, ...s.bubbleNova, opacity: 0.5 }}>Nova is thinking…</div>}
          </div>

          {/* ── Chips: Q1 business type ── */}
          {isQ1 && !sending && !showOtherInput && (
            <div style={s.chipWrap}>
              {BUSINESS_CHIPS[lang].map((label) => (
                <button key={label} style={s.chip} onClick={() => handleBusinessChip(label)}>
                  {label}
                </button>
              ))}
              <button style={{ ...s.chip, ...s.chipGhost }} onClick={() => handleBusinessChip(OTHER_LABEL[lang])}>
                {OTHER_LABEL[lang]}
              </button>
            </div>
          )}

          {/* ── Chips: Q2 vibe (multi-select) ── */}
          {isQ2 && !sending && (
            <div>
              <div style={s.chipWrap}>
                {VIBE_CHIPS[lang].map(({ emoji, label }) => (
                  <button
                    key={label}
                    style={{
                      ...s.chip,
                      ...(selectedVibes.includes(label) ? s.chipSelected : {}),
                    }}
                    onClick={() => handleVibeToggle(label)}
                  >
                    {emoji} {label}
                  </button>
                ))}
              </div>
              {selectedVibes.length > 0 && (
                <button style={s.submitVibesBtn} onClick={submitVibes}>
                  {lang === "es" ? `Confirmar (${selectedVibes.length}/2)` : `Confirm (${selectedVibes.length}/2)`}
                </button>
              )}
            </div>
          )}

          {/* ── Input: Q3 free text or Q1 "Other" ── */}
          {((isQ3 && !sending) || (isQ1 && showOtherInput && !sending)) && (
            <div style={s.inputRow}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={isQ3
                  ? (lang === "es" ? "Nombre de tu marca y qué hace (máx. 200 caracteres)" : "Your brand name and what it does (max 200 chars)")
                  : (lang === "es" ? "Escribe tu tipo de negocio…" : "Type your business type…")}
                style={s.chatInput}
                maxLength={200}
              />
              <button onClick={() => sendMessage()} disabled={!message.trim()} style={s.sendBtn}>
                {lang === "es" ? "Enviar" : "Send"}
              </button>
            </div>
          )}

          {/* ── Post-Q3 follow-up input ── */}
          {briefComplete && (
            <div style={s.inputRow}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={lang === "es" ? "¿Alguna pregunta?" : "Any questions?"}
                style={s.chatInput}
              />
              <button onClick={() => sendMessage()} disabled={sending || !message.trim()} style={s.sendBtn}>
                {lang === "es" ? "Enviar" : "Send"}
              </button>
            </div>
          )}

          {error && <p style={s.errNote}>{error}</p>}
        </div>
      )}

      <footer style={s.footer}>
        <span style={s.dim}>{email}</span>
      </footer>
    </main>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:            { minHeight: "100vh", maxWidth: "640px", margin: "0 auto", padding: "0 24px 80px", display: "flex", flexDirection: "column", background: "#0a0a0a" },
  header:          { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "32px", paddingBottom: "40px" },
  wordmark:        { fontSize: "11px", letterSpacing: "0.22em", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", fontWeight: 600 },
  ghostLink:       { fontSize: "11px", color: "#606060", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.08em" },
  scarcityBadge:   { fontSize: "10px", letterSpacing: "0.12em", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", padding: "4px 10px", border: "1px solid #1a2a2a", borderRadius: "2px", background: "#0a1214" },
  confirmBanner:   { display: "flex", alignItems: "center", gap: "10px", marginBottom: "32px", padding: "12px 16px", border: "1px solid #1a2a1a", borderRadius: "2px", background: "#0a140a" },
  confirmDot:      { width: "6px", height: "6px", borderRadius: "50%", background: "#00ff88", flexShrink: 0 },
  confirmText:     { fontSize: "12px", color: "#00ff88", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em", flex: 1 },
  txLink:          { fontSize: "11px", color: "#00e5ff", fontFamily: "'Share Tech Mono',monospace", letterSpacing: "0.06em", flexShrink: 0 },
  stageRow:        { marginBottom: "32px" },
  stageLabel:      { fontSize: "13px", color: "#606060", fontFamily: "'Share Tech Mono',monospace" },
  chatWrap:        { display: "flex", flexDirection: "column", gap: "12px", marginBottom: "48px" },
  chatLog:         { minHeight: "180px", display: "flex", flexDirection: "column", gap: "10px", padding: "20px", border: "1px solid #1a2a1a", borderRadius: "2px", background: "#0d1117" },
  chatPlaceholder: { fontSize: "13px", color: "#3a3a3a", fontFamily: "'Share Tech Mono',monospace", lineHeight: 1.6 },
  bubble:          { maxWidth: "80%", padding: "10px 14px", borderRadius: "2px", fontSize: "13px", fontFamily: "'Rajdhani',system-ui,sans-serif", lineHeight: 1.6, whiteSpace: "pre-wrap" as const },
  bubbleUser:      { alignSelf: "flex-end", background: "#1a1a1a", color: "#c0c0c0" },
  bubbleNova:      { alignSelf: "flex-start", background: "#0d1a12", color: "#00ff88", border: "1px solid #1a2a1a" },
  chipWrap:        { display: "flex", flexWrap: "wrap" as const, gap: "8px", padding: "8px 0" },
  chip:            { padding: "8px 16px", background: "#0d1117", border: "1px solid #1a2a2a", borderRadius: "2px", color: "#c0c0c0", fontSize: "12px", fontFamily: "'Share Tech Mono',monospace", cursor: "pointer", transition: "all 0.15s ease" },
  chipGhost:       { borderStyle: "dashed" as const, color: "#606060" },
  chipSelected:    { background: "#0a1a1a", borderColor: "#00e5ff", color: "#00e5ff" },
  submitVibesBtn:  { marginTop: "8px", padding: "10px 20px", background: "#00e5ff", color: "#0a0a0a", border: "none", borderRadius: "2px", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: "'Share Tech Mono',monospace" },
  inputRow:        { display: "flex", gap: "8px" },
  chatInput:       { flex: 1, padding: "12px 14px", background: "#0d1117", border: "1px solid #1a2a1a", borderRadius: "2px", color: "#c0c0c0", fontSize: "14px", fontFamily: "'Share Tech Mono',monospace", outline: "none" },
  sendBtn:         { padding: "12px 20px", background: "#00e5ff", color: "#0a0a0a", border: "none", borderRadius: "2px", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: "'Share Tech Mono',monospace" },
  errNote:         { fontSize: "12px", color: "#ef4444", fontFamily: "'Share Tech Mono',monospace" },
  footer:          { marginTop: "auto", paddingTop: "32px" },
  dim:             { fontSize: "11px", color: "#2a2a2a", fontFamily: "'Share Tech Mono',monospace" },
};
