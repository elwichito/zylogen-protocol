"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScarcityData {
  remaining: number;
  claimed: number;
  cap: number;
}

interface ZylScoreData {
  score: number;
  trend: "up" | "down" | "stable";
  history: number[];
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

// ─── Mini Sparkline Component ───────────────────────────────────────────────

function Sparkline({ data, color = "#00e5ff" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 80;
  const height = 24;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Glow effect */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.3"
      />
    </svg>
  );
}

// ─── Animated Counter ───────────────────────────────────────────────────────

function AnimatedNumber({ value, duration = 1000 }: { value: number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const startValueRef = useRef(0);

  useEffect(() => {
    startValueRef.current = displayValue;
    startRef.current = null;

    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const progress = Math.min((timestamp - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayValue(Math.round(startValueRef.current + (value - startValueRef.current) * eased));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return <span>{displayValue}</span>;
}

// ─── Main Landing Page ──────────────────────────────────────────────────────

export default function HomePage() {
  const [scarcity, setScarcity] = useState<ScarcityData | null>(null);
  const [zylScore, setZylScore] = useState<ZylScoreData | null>(null);
  const [mounted, setMounted] = useState(false);

  // Fetch scarcity data
  useEffect(() => {
    setMounted(true);

    async function fetchScarcity() {
      try {
        const res = await fetch(`${BACKEND}/api/nova/scarcity`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setScarcity(data);
        }
      } catch {
        // Fallback data for demo
        setScarcity({ remaining: 73, claimed: 27, cap: 100 });
      }
    }

    async function fetchZylScore() {
      try {
        const res = await fetch(`${BACKEND}/api/nova/zyl-score`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          // Transform backend response to expected format
          setZylScore({
            score: data.score,
            trend: data.trend as "up" | "down" | "stable",
            history: data.history?.map((h: { score: number }) => h.score) ?? [],
          });
        }
      } catch {
        // Fallback data for demo
        setZylScore({
          score: 847,
          trend: "up",
          history: [720, 735, 760, 790, 810, 825, 840, 847],
        });
      }
    }

    fetchScarcity();
    fetchZylScore();

    // Poll every 30s
    const id = setInterval(() => {
      fetchScarcity();
      fetchZylScore();
    }, 30000);

    return () => clearInterval(id);
  }, []);

  const trendColor = zylScore?.trend === "up" ? "#00ff88" : zylScore?.trend === "down" ? "#ef4444" : "#808080";
  const trendIcon = zylScore?.trend === "up" ? "^" : zylScore?.trend === "down" ? "v" : "-";

  return (
    <main style={s.page}>
      {/* ── Ambient background effects ── */}
      <div style={s.ambientGlow} />
      <div style={s.gridOverlay} />

      {/* ── Header ── */}
      <header style={s.header}>
        <div style={s.wordmark}>ZYLOGEN</div>
        <nav style={s.nav}>
          <Link href="/nova" style={s.navLink}>Nova</Link>
          <a href="https://docs.zylogen.xyz" target="_blank" rel="noreferrer" style={s.navLink}>Docs</a>
        </nav>
      </header>

      {/* ── Hero Section ── */}
      <section style={s.hero}>
        <div style={s.heroBadge}>
          <span style={s.heroBadgeDot} />
          PROTOCOL LIVE ON BASE
        </div>

        <h1 style={s.heroTitle}>
          Intelligent work.<br />
          <span style={s.heroAccent}>Trustless settlement.</span>
        </h1>

        <p style={s.heroSub}>
          Zylogen connects businesses to AI workers through escrow-protected contracts.
          Pay only when work is delivered. Settle on-chain, invisible to you.
        </p>

        <div style={s.heroCtas}>
          <Link href="/nova" style={s.ctaPrimary}>
            Meet Nova — $9.99
            <span style={s.ctaArrow}>-&gt;</span>
          </Link>
          <a href="https://docs.zylogen.xyz/whitepaper" target="_blank" rel="noreferrer" style={s.ctaSecondary}>
            Read Whitepaper
          </a>
        </div>
      </section>

      {/* ── Stats Grid ── */}
      <section style={s.statsGrid}>
        {/* ZYL Score Card */}
        <div style={s.statCard}>
          <div style={s.statHeader}>
            <span style={s.statLabel}>ZYL SCORE</span>
            {zylScore && (
              <span style={{ ...s.trendBadge, color: trendColor, borderColor: trendColor }}>
                {trendIcon} {zylScore.trend === "up" ? "RISING" : zylScore.trend === "down" ? "FALLING" : "STABLE"}
              </span>
            )}
          </div>
          <div style={s.scoreRow}>
            <span style={s.scoreValue}>
              {mounted && zylScore ? <AnimatedNumber value={zylScore.score} /> : "---"}
            </span>
            {zylScore && <Sparkline data={zylScore.history} color={trendColor} />}
          </div>
          <p style={s.statNote}>Protocol reputation metric</p>
        </div>

        {/* Founding Members Card */}
        <div style={s.statCard}>
          <div style={s.statHeader}>
            <span style={s.statLabel}>FOUNDING MEMBERS</span>
            {scarcity && scarcity.remaining <= 30 && (
              <span style={{ ...s.trendBadge, color: "#f59e0b", borderColor: "#f59e0b" }}>
                LIMITED
              </span>
            )}
          </div>
          <div style={s.scoreRow}>
            <span style={s.scoreValue}>
              {mounted && scarcity ? <AnimatedNumber value={scarcity.claimed} /> : "---"}
            </span>
            <span style={s.scoreSuffix}>/ 100</span>
          </div>
          <p style={s.statNote}>
            {scarcity && scarcity.remaining > 0
              ? `${scarcity.remaining} spots remaining`
              : "All spots claimed"}
          </p>
        </div>
      </section>

      {/* ── Scarcity Progress Bar ── */}
      {scarcity && (
        <div style={s.scarcityBar}>
          <div style={s.scarcityTrack}>
            <div
              style={{
                ...s.scarcityFill,
                width: `${(scarcity.claimed / scarcity.cap) * 100}%`,
              }}
            />
          </div>
          <div style={s.scarcityLabels}>
            <span>Founding 100 Progress</span>
            <span style={s.scarcityPct}>{Math.round((scarcity.claimed / scarcity.cap) * 100)}%</span>
          </div>
        </div>
      )}

      {/* ── Nova Feature Section ── */}
      <section style={s.featureSection}>
        <div style={s.featureHeader}>
          <span style={s.featureEyebrow}>FIRST WORKER</span>
          <h2 style={s.featureTitle}>Nova — AI Branding Consultant</h2>
          <p style={s.featureDesc}>
            A complete Instagram identity system delivered in 24 hours. Brand voice, visual language,
            30-day content strategy — built by an AI trained on what actually converts.
          </p>
        </div>

        <div style={s.deliverables}>
          {[
            { title: "Brand Identity", desc: "Tagline, bio, brand promise, and CTA", icon: "01" },
            { title: "Visual System", desc: "Color palette, fonts, and mood board", icon: "02" },
            { title: "Content Strategy", desc: "30-day plan with 10 hashtag sets", icon: "03" },
            { title: "Voice Guide", desc: "Tone rules + 3 example captions", icon: "04" },
          ].map((item) => (
            <div key={item.icon} style={s.deliverableCard}>
              <span style={s.deliverableIcon}>{item.icon}</span>
              <div>
                <h3 style={s.deliverableTitle}>{item.title}</h3>
                <p style={s.deliverableDesc}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <Link href="/nova" style={s.featureCta}>
          Start with Nova
          <span style={s.ctaArrow}>-&gt;</span>
        </Link>
      </section>

      {/* ── How It Works ── */}
      <section style={s.howSection}>
        <h2 style={s.howTitle}>How Zylogen Works</h2>
        <div style={s.howSteps}>
          {[
            { num: "01", title: "Connect", desc: "Link your wallet and share your brief with Nova" },
            { num: "02", title: "Escrow", desc: "Funds lock in smart contract until delivery" },
            { num: "03", title: "Deliver", desc: "Nova completes your branding kit within 24h" },
            { num: "04", title: "Settle", desc: "Funds release automatically on-chain" },
          ].map((step, i) => (
            <div key={step.num} style={s.howStep}>
              <div style={s.howStepNum}>{step.num}</div>
              <div style={s.howStepContent}>
                <h3 style={s.howStepTitle}>{step.title}</h3>
                <p style={s.howStepDesc}>{step.desc}</p>
              </div>
              {i < 3 && <div style={s.howStepLine} />}
            </div>
          ))}
        </div>
      </section>

      {/* ── Social Proof ── */}
      <section style={s.proofSection}>
        <div style={s.proofQuote}>
          &quot;Finally, AI work I can actually trust to deliver.&quot;
        </div>
        <div style={s.proofAttrib}>
          <span style={s.proofName}>Early Adopter</span>
          <span style={s.proofRole}>Founding Member #12</span>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={s.finalCta}>
        <h2 style={s.finalCtaTitle}>Join the Founding 100</h2>
        <p style={s.finalCtaDesc}>
          Lock in $9.99 forever. Future pricing will increase.
        </p>
        <Link href="/nova" style={s.ctaPrimary}>
          Claim Your Spot
          <span style={s.ctaArrow}>-&gt;</span>
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer style={s.footer}>
        <div style={s.footerLeft}>
          <span style={s.footerWordmark}>ZYLOGEN</span>
          <span style={s.footerCopy}>Built on-chain. Settled invisibly.</span>
        </div>
        <div style={s.footerLinks}>
          <a href="https://twitter.com/zylogen" target="_blank" rel="noreferrer" style={s.footerLink}>Twitter</a>
          <a href="https://docs.zylogen.xyz" target="_blank" rel="noreferrer" style={s.footerLink}>Docs</a>
          <a href="https://basescan.org" target="_blank" rel="noreferrer" style={s.footerLink}>Contract</a>
        </div>
      </footer>
    </main>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "0 24px 80px",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    overflow: "hidden",
  },
  ambientGlow: {
    position: "fixed",
    top: "-50%",
    left: "-25%",
    width: "150%",
    height: "100%",
    background: "radial-gradient(ellipse at center, rgba(0,229,255,0.03) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  gridOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundImage: `
      linear-gradient(rgba(0,229,255,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,229,255,0.02) 1px, transparent 1px)
    `,
    backgroundSize: "60px 60px",
    pointerEvents: "none",
    zIndex: 0,
  },

  // Header
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "32px 0",
    position: "relative",
    zIndex: 1,
  },
  wordmark: {
    fontSize: "12px",
    letterSpacing: "0.3em",
    color: "#00ff88",
    fontFamily: "'Share Tech Mono', monospace",
    fontWeight: 600,
  },
  nav: {
    display: "flex",
    gap: "32px",
  },
  navLink: {
    fontSize: "12px",
    letterSpacing: "0.1em",
    color: "#606060",
    fontFamily: "'Share Tech Mono', monospace",
    transition: "color 0.2s ease",
  },

  // Hero
  hero: {
    padding: "80px 0 100px",
    position: "relative",
    zIndex: 1,
  },
  heroBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 14px",
    background: "rgba(0,255,136,0.05)",
    border: "1px solid rgba(0,255,136,0.2)",
    borderRadius: "2px",
    fontSize: "10px",
    letterSpacing: "0.2em",
    color: "#00ff88",
    fontFamily: "'Share Tech Mono', monospace",
    marginBottom: "32px",
  },
  heroBadgeDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#00ff88",
    animation: "pulse 2s infinite",
  },
  heroTitle: {
    fontSize: "clamp(40px, 8vw, 72px)",
    fontWeight: 700,
    lineHeight: 1.05,
    letterSpacing: "-0.02em",
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    marginBottom: "28px",
  },
  heroAccent: {
    color: "#00e5ff",
  },
  heroSub: {
    fontSize: "17px",
    lineHeight: 1.7,
    color: "#808080",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    maxWidth: "540px",
    marginBottom: "40px",
  },
  heroCtas: {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
  },
  ctaPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "16px 32px",
    background: "#00e5ff",
    color: "#0a0a0a",
    borderRadius: "2px",
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: "'Share Tech Mono', monospace",
    transition: "all 0.2s ease",
  },
  ctaSecondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "16px 32px",
    background: "transparent",
    color: "#808080",
    border: "1px solid #2a2a2a",
    borderRadius: "2px",
    fontSize: "13px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: "'Share Tech Mono', monospace",
    transition: "all 0.2s ease",
  },
  ctaArrow: {
    fontSize: "14px",
    transition: "transform 0.2s ease",
  },

  // Stats
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "24px",
    marginBottom: "32px",
    position: "relative",
    zIndex: 1,
  },
  statCard: {
    padding: "28px",
    background: "rgba(13,26,18,0.6)",
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
  },
  statHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  statLabel: {
    fontSize: "10px",
    letterSpacing: "0.2em",
    color: "#606060",
    fontFamily: "'Share Tech Mono', monospace",
  },
  trendBadge: {
    fontSize: "9px",
    letterSpacing: "0.15em",
    padding: "3px 8px",
    border: "1px solid",
    borderRadius: "2px",
    fontFamily: "'Share Tech Mono', monospace",
  },
  scoreRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    marginBottom: "8px",
  },
  scoreValue: {
    fontSize: "42px",
    fontWeight: 700,
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    letterSpacing: "-0.02em",
    lineHeight: 1,
  },
  scoreSuffix: {
    fontSize: "18px",
    color: "#3a3a3a",
    fontFamily: "'Share Tech Mono', monospace",
  },
  statNote: {
    fontSize: "11px",
    color: "#4a4a4a",
    fontFamily: "'Share Tech Mono', monospace",
    letterSpacing: "0.06em",
  },

  // Scarcity Bar
  scarcityBar: {
    marginBottom: "80px",
    position: "relative",
    zIndex: 1,
  },
  scarcityTrack: {
    width: "100%",
    height: "3px",
    background: "#1a1a1a",
    borderRadius: "2px",
    overflow: "hidden",
    marginBottom: "12px",
  },
  scarcityFill: {
    height: "100%",
    background: "linear-gradient(90deg, #00e5ff, #00ff88)",
    borderRadius: "2px",
    transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  scarcityLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "10px",
    color: "#4a4a4a",
    fontFamily: "'Share Tech Mono', monospace",
    letterSpacing: "0.1em",
  },
  scarcityPct: {
    color: "#00e5ff",
  },

  // Feature Section
  featureSection: {
    padding: "80px 0",
    borderTop: "1px solid #1a1a1a",
    position: "relative",
    zIndex: 1,
  },
  featureHeader: {
    marginBottom: "48px",
    maxWidth: "600px",
  },
  featureEyebrow: {
    fontSize: "10px",
    letterSpacing: "0.25em",
    color: "#00e5ff",
    fontFamily: "'Share Tech Mono', monospace",
    marginBottom: "16px",
    display: "block",
  },
  featureTitle: {
    fontSize: "32px",
    fontWeight: 600,
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    marginBottom: "16px",
  },
  featureDesc: {
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#808080",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
  },
  deliverables: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "20px",
    marginBottom: "40px",
  },
  deliverableCard: {
    display: "flex",
    gap: "16px",
    padding: "20px",
    background: "rgba(10,10,10,0.6)",
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
  },
  deliverableIcon: {
    fontSize: "11px",
    color: "#00e5ff",
    fontFamily: "'Share Tech Mono', monospace",
    letterSpacing: "0.1em",
    flexShrink: 0,
  },
  deliverableTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    marginBottom: "4px",
  },
  deliverableDesc: {
    fontSize: "12px",
    color: "#606060",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    lineHeight: 1.5,
  },
  featureCta: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "14px 28px",
    background: "transparent",
    color: "#00e5ff",
    border: "1px solid #00e5ff",
    borderRadius: "2px",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontFamily: "'Share Tech Mono', monospace",
    transition: "all 0.2s ease",
  },

  // How It Works
  howSection: {
    padding: "80px 0",
    borderTop: "1px solid #1a1a1a",
    position: "relative",
    zIndex: 1,
  },
  howTitle: {
    fontSize: "28px",
    fontWeight: 600,
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    marginBottom: "48px",
    textAlign: "center",
  },
  howSteps: {
    display: "flex",
    flexDirection: "column",
    gap: "0",
    maxWidth: "500px",
    margin: "0 auto",
  },
  howStep: {
    display: "flex",
    gap: "20px",
    position: "relative",
    paddingBottom: "32px",
  },
  howStepNum: {
    fontSize: "11px",
    color: "#00e5ff",
    fontFamily: "'Share Tech Mono', monospace",
    letterSpacing: "0.1em",
    flexShrink: 0,
    width: "24px",
  },
  howStepContent: {
    flex: 1,
  },
  howStepTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    marginBottom: "4px",
  },
  howStepDesc: {
    fontSize: "13px",
    color: "#606060",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    lineHeight: 1.5,
  },
  howStepLine: {
    position: "absolute",
    left: "11px",
    top: "24px",
    bottom: "0",
    width: "1px",
    background: "#1a2a1a",
  },

  // Social Proof
  proofSection: {
    padding: "80px 0",
    borderTop: "1px solid #1a1a1a",
    textAlign: "center",
    position: "relative",
    zIndex: 1,
  },
  proofQuote: {
    fontSize: "24px",
    fontWeight: 500,
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    fontStyle: "italic",
    marginBottom: "24px",
    maxWidth: "600px",
    margin: "0 auto 24px",
  },
  proofAttrib: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    alignItems: "center",
  },
  proofName: {
    fontSize: "13px",
    color: "#808080",
    fontFamily: "'Share Tech Mono', monospace",
  },
  proofRole: {
    fontSize: "11px",
    color: "#00e5ff",
    fontFamily: "'Share Tech Mono', monospace",
    letterSpacing: "0.1em",
  },

  // Final CTA
  finalCta: {
    padding: "80px 0",
    textAlign: "center",
    position: "relative",
    zIndex: 1,
  },
  finalCtaTitle: {
    fontSize: "36px",
    fontWeight: 700,
    color: "#ffffff",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    marginBottom: "16px",
  },
  finalCtaDesc: {
    fontSize: "15px",
    color: "#606060",
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    marginBottom: "32px",
  },

  // Footer
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "32px 0",
    borderTop: "1px solid #1a1a1a",
    marginTop: "auto",
    position: "relative",
    zIndex: 1,
    flexWrap: "wrap",
    gap: "24px",
  },
  footerLeft: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  footerWordmark: {
    fontSize: "10px",
    letterSpacing: "0.25em",
    color: "#00ff88",
    fontFamily: "'Share Tech Mono', monospace",
  },
  footerCopy: {
    fontSize: "11px",
    color: "#2a2a2a",
    fontFamily: "'Share Tech Mono', monospace",
  },
  footerLinks: {
    display: "flex",
    gap: "24px",
  },
  footerLink: {
    fontSize: "11px",
    color: "#4a4a4a",
    fontFamily: "'Share Tech Mono', monospace",
    letterSpacing: "0.08em",
    transition: "color 0.2s ease",
  },
};
