"use client";

import { useEffect, useState, useCallback } from "react";

interface NovaStatus {
  stage: "not_started" | "briefing" | "kit_delivered";
  kit?: BrandingKit | null;
}

interface BrandingKit {
  brandIdentity?: { tagline?: string; bio?: string; brandPromise?: string; cta?: string };
  visualSystem?: { primaryColor?: string; secondaryColor?: string; accent?: string; fonts?: { heading?: string; body?: string }; moodBoard?: string[] };
  contentStrategy?: { hooks?: string[]; hashtagSets?: string[][] };
  voiceGuide?: { dos?: string[]; donts?: string[] };
  edge?: { positioning?: string; differentiators?: string[] };
  raw?: string;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const POLL_MS = 6000;

export default function DashboardPage() {
  const [email,    setEmail]    = useState<string | null>(null);
  const [txHash,   setTxHash]   = useState<string | null>(null);
  const [status,   setStatus]   = useState<NovaStatus | null>(null);
  const [message,  setMessage]  = useState("");
  const [chatLog,  setChatLog]  = useState<{ role: "user" | "nova"; text: string }[]>([]);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // ─── Read params from URL ─────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    setEmail(p.get("email"));
    setTxHash(p.get("tx"));
  }, []);

  // ─── Poll /api/nova/status ────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    if (!email) return;
    try {
      const res = await fetch(`${BACKEND}/api/nova/status?email=${encodeURIComponent(email)}`);
      const data: NovaStatus = await res.json();
      setStatus(data);
    } catch { /* network hiccup — keep polling */ }
  }, [email]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => {
      if (status?.stage === "kit_delivered") { clearInterval(id); return; }
      fetchStatus();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [email, fetchStatus, status?.stage]);

  // ─── Nova chat ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    if (!message.trim() || !email) return;
    const userMsg = message.trim();
    setMessage("");
    setSending(true);
    setChatLog((prev) => [...prev, { role: "user", text: userMsg }]);

    try {
      const res = await fetch(`${BACKEND}/api/nova/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message: userMsg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Nova error");

      const reply = data.reply ?? (data.stage === "kit_delivered" ? "Your Branding Kit is ready." : "");
      if (reply) setChatLog((prev) => [...prev, { role: "nova", text: reply }]);
      if (data.stage === "kit_delivered") fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nova error");
    } finally {
      setSending(false);
    }
  }, [message, email, fetchStatus]);

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (!email) {
    return (
      <main style={s.page}>
        <p style={s.dim}>No session found. <a href="/nova" style={{ color: "#c9a96e" }}>Return to Nova →</a></p>
      </main>
    );
  }

  return (
    <main style={s.page}>
      <header style={s.header}>
        <span style={s.wordmark}>ZYLOGEN · NOVA</span>
        <a href="/nova" style={s.ghostLink}>← Back</a>
      </header>

      {/* ── On-chain confirmation ── */}
      <div style={s.confirmBanner}>
        <span style={s.confirmDot} />
        <span style={s.confirmText}>Payment confirmed on Base</span>
        {txHash && (
          <a
            href={`https://sepolia.basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            style={s.txLink}
          >
            View on Basescan ↗
          </a>
        )}
      </div>

      {/* ── Stage indicator ── */}
      <div style={s.stageRow}>
        <span style={s.stageLabel}>
          {!status || status.stage === "not_started"
            ? "⏳ Nova is initialising your workspace…"
            : status.stage === "briefing"
            ? "💬 Nova is ready — introduce your brand below"
            : "✓ Branding Kit delivered"}
        </span>
      </div>

      {/* ── Branding Kit (when ready) ── */}
      {status?.stage === "kit_delivered" && status.kit && (
        <KitDisplay kit={status.kit} />
      )}

      {/* ── Chat interface ── */}
      {status && status.stage !== "not_started" && (
        <div style={s.chatWrap}>
          <div style={s.chatLog}>
            {chatLog.length === 0 && (
              <p style={s.chatPlaceholder}>
                Tell Nova about your business — name, niche, and what you're building on Instagram.
              </p>
            )}
            {chatLog.map((m, i) => (
              <div key={i} style={{ ...s.bubble, ...(m.role === "user" ? s.bubbleUser : s.bubbleNova) }}>
                {m.text}
              </div>
            ))}
            {sending && <div style={{ ...s.bubble, ...s.bubbleNova, opacity: 0.5 }}>Nova is thinking…</div>}
          </div>
          <div style={s.inputRow}>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Message Nova…"
              style={s.chatInput}
              disabled={sending}
            />
            <button onClick={sendMessage} disabled={sending || !message.trim()} style={s.sendBtn}>
              Send
            </button>
          </div>
          {error && <p style={s.errNote}>{error}</p>}
        </div>
      )}

      <footer style={s.footer}>
        <span style={s.dim}>{email}</span>
      </footer>
    </main>
  );
}

// ─── Kit display ──────────────────────────────────────────────────────────────

function KitDisplay({ kit }: { kit: BrandingKit }) {
  if (kit.raw) {
    return <pre style={{ color: "#6b6b6b", fontSize: "12px", whiteSpace: "pre-wrap", marginBottom: "32px" }}>{kit.raw}</pre>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginBottom: "40px" }}>
      {kit.brandIdentity && (
        <KitSection title="Brand Identity">
          <KitRow label="Tagline"       value={kit.brandIdentity.tagline} />
          <KitRow label="Bio"           value={kit.brandIdentity.bio} />
          <KitRow label="Brand Promise" value={kit.brandIdentity.brandPromise} />
          <KitRow label="CTA"           value={kit.brandIdentity.cta} />
        </KitSection>
      )}
      {kit.visualSystem && (
        <KitSection title="Visual System">
          <div style={{ display: "flex", gap: "10px", marginBottom: "8px" }}>
            {[kit.visualSystem.primaryColor, kit.visualSystem.secondaryColor, kit.visualSystem.accent]
              .filter(Boolean)
              .map((c) => (
                <div key={c} style={{ width: "32px", height: "32px", borderRadius: "2px", background: c, border: "1px solid #222" }} title={c} />
              ))}
          </div>
          <KitRow label="Fonts" value={kit.visualSystem.fonts ? `${kit.visualSystem.fonts.heading} / ${kit.visualSystem.fonts.body}` : undefined} />
          {kit.visualSystem.moodBoard && (
            <KitRow label="Mood" value={kit.visualSystem.moodBoard.join(" · ")} />
          )}
        </KitSection>
      )}
      {kit.contentStrategy?.hooks && (
        <KitSection title="Content Hooks">
          {kit.contentStrategy.hooks.map((h, i) => (
            <p key={i} style={{ fontSize: "13px", color: "#6b6b6b", fontFamily: "system-ui,sans-serif", lineHeight: 1.5 }}>
              {i + 1}. {h}
            </p>
          ))}
        </KitSection>
      )}
      {kit.edge && (
        <KitSection title="Competitive Edge">
          <KitRow label="Positioning" value={kit.edge.positioning} />
          {kit.edge.differentiators?.map((d, i) => (
            <KitRow key={i} label={`Edge ${i + 1}`} value={d} />
          ))}
        </KitSection>
      )}
    </div>
  );
}

function KitSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #1a1a1a", borderRadius: "2px", padding: "20px 24px", background: "#0d0d0d" }}>
      <p style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#c9a96e", fontFamily: "system-ui,sans-serif", marginBottom: "14px" }}>
        {title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{children}</div>
    </div>
  );
}

function KitRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: "12px" }}>
      <span style={{ fontSize: "11px", color: "#3a3a3a", fontFamily: "system-ui,sans-serif", minWidth: "90px", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: "13px", color: "#a0a0a0", fontFamily: "system-ui,sans-serif", lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:            { minHeight: "100vh", maxWidth: "640px", margin: "0 auto", padding: "0 24px 80px", display: "flex", flexDirection: "column" },
  header:          { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "32px", paddingBottom: "40px" },
  wordmark:        { fontSize: "11px", letterSpacing: "0.22em", color: "#3a3a3a", fontFamily: "system-ui,sans-serif", fontWeight: 600 },
  ghostLink:       { fontSize: "11px", color: "#3a3a3a", fontFamily: "system-ui,sans-serif", letterSpacing: "0.08em" },
  confirmBanner:   { display: "flex", alignItems: "center", gap: "10px", marginBottom: "32px", padding: "12px 16px", border: "1px solid #1a2a1a", borderRadius: "2px", background: "#0a140a" },
  confirmDot:      { width: "6px", height: "6px", borderRadius: "50%", background: "#4a7c59", flexShrink: 0 },
  confirmText:     { fontSize: "12px", color: "#4a7c59", fontFamily: "system-ui,sans-serif", letterSpacing: "0.06em", flex: 1 },
  txLink:          { fontSize: "11px", color: "#c9a96e", fontFamily: "system-ui,sans-serif", letterSpacing: "0.06em", flexShrink: 0 },
  stageRow:        { marginBottom: "32px" },
  stageLabel:      { fontSize: "13px", color: "#5a5a5a", fontFamily: "system-ui,sans-serif" },
  chatWrap:        { display: "flex", flexDirection: "column", gap: "12px", marginBottom: "48px" },
  chatLog:         { minHeight: "180px", display: "flex", flexDirection: "column", gap: "10px", padding: "20px", border: "1px solid #1a1a1a", borderRadius: "2px", background: "#0a0a0a" },
  chatPlaceholder: { fontSize: "13px", color: "#2e2e2e", fontFamily: "system-ui,sans-serif", lineHeight: 1.6 },
  bubble:          { maxWidth: "80%", padding: "10px 14px", borderRadius: "2px", fontSize: "13px", fontFamily: "system-ui,sans-serif", lineHeight: 1.6 },
  bubbleUser:      { alignSelf: "flex-end", background: "#1a1a1a", color: "#e8e3dc" },
  bubbleNova:      { alignSelf: "flex-start", background: "#0d1a0d", color: "#a0c8a0", border: "1px solid #1a2a1a" },
  inputRow:        { display: "flex", gap: "8px" },
  chatInput:       { flex: 1, padding: "12px 14px", background: "#111", border: "1px solid #222", borderRadius: "2px", color: "#e8e3dc", fontSize: "14px", fontFamily: "system-ui,sans-serif", outline: "none" },
  sendBtn:         { padding: "12px 20px", background: "#c9a96e", color: "#080808", border: "none", borderRadius: "2px", fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: "system-ui,sans-serif" },
  errNote:         { fontSize: "12px", color: "#ef4444", fontFamily: "system-ui,sans-serif" },
  footer:          { marginTop: "auto", paddingTop: "32px" },
  dim:             { fontSize: "11px", color: "#2a2a2a", fontFamily: "system-ui,sans-serif" },
};
