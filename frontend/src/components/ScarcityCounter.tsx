"use client";

import { useEffect, useState } from "react";

interface ScarcityData {
  remaining: number;
  claimed: number;
  cap: number;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

// Poll interval in ms — keeps the counter live without a websocket
const POLL_INTERVAL = 30_000;

export default function ScarcityCounter() {
  const [data, setData] = useState<ScarcityData | null>(null);
  const [error, setError] = useState(false);

  async function fetchScarcity() {
    try {
      const res = await fetch(`${BACKEND}/api/nova/scarcity`, { cache: "no-store" });
      if (!res.ok) throw new Error("non-200");
      const json: ScarcityData = await res.json();
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    fetchScarcity();
    const id = setInterval(fetchScarcity, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // Percentage of slots consumed — drives the progress bar width
  const pct = data ? Math.round((data.claimed / data.cap) * 100) : 0;

  // Urgency tier — changes label copy and accent color
  const urgency =
    !data ? "loading"
    : data.remaining === 0 ? "sold_out"
    : data.remaining <= 10 ? "critical"
    : data.remaining <= 30 ? "low"
    : "available";

  const accentColor =
    urgency === "sold_out" ? "#6b7280"
    : urgency === "critical" ? "#ef4444"
    : urgency === "low"      ? "#f59e0b"
    : "#c9a96e"; // gold

  const label =
    urgency === "loading"  ? "Checking availability…"
    : urgency === "sold_out" ? "Founding 100 — CLOSED"
    : urgency === "critical" ? `Only ${data!.remaining} spot${data!.remaining === 1 ? "" : "s"} left`
    : urgency === "low"      ? `${data!.remaining} of ${data!.cap} spots remaining`
    : `${data!.remaining} of ${data!.cap} spots remaining`;

  return (
    <div style={styles.wrapper}>
      {/* Progress bar */}
      <div style={styles.track}>
        <div
          style={{
            ...styles.fill,
            width: `${pct}%`,
            background: accentColor,
            boxShadow: urgency === "critical" ? `0 0 8px ${accentColor}88` : "none",
          }}
        />
      </div>

      {/* Label row */}
      <div style={styles.labelRow}>
        <span style={{ ...styles.label, color: error ? "#6b7280" : accentColor }}>
          {error ? "Availability unavailable" : label}
        </span>
        {data && urgency !== "sold_out" && (
          <span style={styles.claimed}>
            {data.claimed} / {data.cap} claimed
          </span>
        )}
      </div>

      {urgency === "critical" && (
        <p style={{ ...styles.urgencyNote, color: accentColor }}>
          ⚡ At this rate, all spots will be gone within hours.
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  track: {
    width: "100%",
    height: "2px",
    background: "#1e1e1e",
    borderRadius: "999px",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: "999px",
    transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1), background 0.4s ease",
  },
  labelRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: "11px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 500,
  },
  claimed: {
    fontSize: "11px",
    color: "#4a4a4a",
    fontFamily: "system-ui, sans-serif",
    letterSpacing: "0.06em",
  },
  urgencyNote: {
    fontSize: "11px",
    fontFamily: "system-ui, sans-serif",
    letterSpacing: "0.04em",
    opacity: 0.85,
  },
};
