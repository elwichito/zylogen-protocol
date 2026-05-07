"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Order {
  id: number;
  email: string;
  wallet: string | null;
  stage: string;
  delivery_status: string | null;
  branding_kit: object | null;
  created_at: string;
  escrow_status: string | null;
  tx_hash: string | null;
  amount_cents: number | null;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [expandedKit, setExpandedKit] = useState<string | null>(null);

  // ─── Load admin key from localStorage ───────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("nova_admin_key");
    if (stored) setAdminKey(stored);
  }, []);

  // ─── Fetch orders ───────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    if (!adminKey) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND}/api/nova/admin/orders`, {
        headers: { "X-Admin-Key": adminKey },
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("nova_admin_key");
          setAdminKey(null);
          setError("Invalid admin key");
          return;
        }
        throw new Error(data.error ?? "Failed to fetch orders");
      }

      setOrders(data.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    if (adminKey) fetchOrders();
  }, [adminKey, fetchOrders]);

  // ─── Handle login ───────────────────────────────────────────────────────

  const handleLogin = () => {
    if (!keyInput.trim()) return;
    localStorage.setItem("nova_admin_key", keyInput.trim());
    setAdminKey(keyInput.trim());
    setKeyInput("");
  };

  // ─── Handle logout ──────────────────────────────────────────────────────

  const handleLogout = () => {
    localStorage.removeItem("nova_admin_key");
    setAdminKey(null);
    setOrders([]);
  };

  // ─── Deliver kit ────────────────────────────────────────────────────────

  const handleDeliverKit = async (email: string) => {
    if (!adminKey) return;

    const kitJson = prompt("Enter kit JSON (or cancel to abort):");
    if (!kitJson) return;

    let kit: object;
    try {
      kit = JSON.parse(kitJson);
    } catch {
      alert("Invalid JSON");
      return;
    }

    setDelivering(email);
    setError(null);

    try {
      const res = await fetch(`${BACKEND}/api/nova/deliver-kit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey,
        },
        body: JSON.stringify({ email, kit }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to deliver kit");
      }

      alert(`Kit delivered! Escrow released: ${data.released}`);
      fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deliver kit");
    } finally {
      setDelivering(null);
    }
  };

  // ─── Login screen ───────────────────────────────────────────────────────

  if (!adminKey) {
    return (
      <main style={s.page}>
        <header style={s.header}>
          <span style={s.wordmark}>ZYLOGEN · NOVA ADMIN</span>
        </header>

        <div style={s.loginCard}>
          <h2 style={s.loginTitle}>Admin Access</h2>
          <input
            type="password"
            placeholder="Enter admin key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            style={s.input}
            autoFocus
          />
          <button onClick={handleLogin} style={s.primaryBtn}>
            Login
          </button>
          {error && <p style={s.errNote}>{error}</p>}
        </div>
      </main>
    );
  }

  // ─── Admin dashboard ────────────────────────────────────────────────────

  return (
    <main style={s.page}>
      <header style={s.header}>
        <span style={s.wordmark}>ZYLOGEN · NOVA ADMIN</span>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <button onClick={fetchOrders} disabled={loading} style={s.ghostBtn}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button onClick={handleLogout} style={s.ghostBtn}>
            Logout
          </button>
        </div>
      </header>

      {error && <p style={s.errNote}>{error}</p>}

      <div style={s.statsRow}>
        <span style={s.stat}>Total Orders: {orders.length}</span>
        <span style={s.stat}>
          Delivered: {orders.filter((o) => o.delivery_status === "delivered").length}
        </span>
        <span style={s.stat}>
          Pending: {orders.filter((o) => o.delivery_status !== "delivered").length}
        </span>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Email</th>
              <th style={s.th}>Wallet</th>
              <th style={s.th}>Stage</th>
              <th style={s.th}>Delivery</th>
              <th style={s.th}>Created</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} style={s.tr}>
                <td style={s.td}>{order.email}</td>
                <td style={s.td}>
                  {order.wallet ? (
                    <span style={s.mono}>
                      {order.wallet.slice(0, 6)}...{order.wallet.slice(-4)}
                    </span>
                  ) : (
                    <span style={s.dim}>-</span>
                  )}
                </td>
                <td style={s.td}>
                  <span style={s.stageBadge}>{order.stage}</span>
                </td>
                <td style={s.td}>
                  <span
                    style={{
                      ...s.deliveryBadge,
                      background:
                        order.delivery_status === "delivered"
                          ? "#0a1a0a"
                          : "#1a1a1a",
                      color:
                        order.delivery_status === "delivered"
                          ? "#00ff88"
                          : "#808080",
                      borderColor:
                        order.delivery_status === "delivered"
                          ? "#00ff88"
                          : "#2a2a2a",
                    }}
                  >
                    {order.delivery_status ?? "pending"}
                  </span>
                </td>
                <td style={s.td}>
                  <span style={s.dim}>
                    {new Date(order.created_at).toLocaleDateString()}
                  </span>
                </td>
                <td style={s.td}>
                  {order.delivery_status === "delivered" ? (
                    <button
                      onClick={() =>
                        setExpandedKit(expandedKit === order.email ? null : order.email)
                      }
                      style={s.actionBtn}
                    >
                      {expandedKit === order.email ? "Hide Kit" : "View Kit"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDeliverKit(order.email)}
                      disabled={delivering === order.email}
                      style={{
                        ...s.actionBtn,
                        ...s.deliverBtn,
                        opacity: delivering === order.email ? 0.5 : 1,
                      }}
                    >
                      {delivering === order.email ? "Delivering..." : "Deliver Kit"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {orders.length === 0 && !loading && (
          <p style={{ ...s.dim, textAlign: "center", padding: "40px" }}>
            No orders yet
          </p>
        )}
      </div>

      {/* Kit preview modal */}
      {expandedKit && (
        <div style={s.kitPreview}>
          <div style={s.kitHeader}>
            <span>Kit for {expandedKit}</span>
            <button onClick={() => setExpandedKit(null)} style={s.ghostBtn}>
              Close
            </button>
          </div>
          <pre style={s.kitJson}>
            {JSON.stringify(
              orders.find((o) => o.email === expandedKit)?.branding_kit,
              null,
              2
            )}
          </pre>
        </div>
      )}

      <footer style={s.footer}>
        <a href="/nova" style={s.ghostLink}>
          Back to Nova
        </a>
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
    background: "#0a0a0a",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: "32px",
    paddingBottom: "40px",
  },
  wordmark: {
    fontSize: "11px",
    letterSpacing: "0.22em",
    color: "#00ff88",
    fontFamily: "'Share Tech Mono',monospace",
    fontWeight: 600,
  },
  loginCard: {
    maxWidth: "400px",
    margin: "80px auto",
    padding: "40px",
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
    background: "#0d1a12",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  loginTitle: {
    fontSize: "18px",
    fontWeight: 500,
    color: "#ffffff",
    fontFamily: "'Rajdhani',system-ui,sans-serif",
    marginBottom: "8px",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    background: "#0d1117",
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
    color: "#c0c0c0",
    fontSize: "14px",
    fontFamily: "'Share Tech Mono',monospace",
    outline: "none",
  },
  primaryBtn: {
    display: "block",
    width: "100%",
    padding: "14px 24px",
    background: "#00e5ff",
    color: "#0a0a0a",
    border: "none",
    borderRadius: "2px",
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "'Share Tech Mono',monospace",
    textAlign: "center",
  },
  ghostBtn: {
    padding: "8px 16px",
    background: "transparent",
    color: "#606060",
    border: "1px solid #2a2a2a",
    borderRadius: "2px",
    fontSize: "11px",
    fontFamily: "'Share Tech Mono',monospace",
    letterSpacing: "0.08em",
    cursor: "pointer",
  },
  ghostLink: {
    fontSize: "11px",
    color: "#606060",
    fontFamily: "'Share Tech Mono',monospace",
    letterSpacing: "0.08em",
  },
  statsRow: {
    display: "flex",
    gap: "24px",
    marginBottom: "24px",
    padding: "16px",
    background: "#0d1117",
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
  },
  stat: {
    fontSize: "12px",
    color: "#808080",
    fontFamily: "'Share Tech Mono',monospace",
  },
  tableWrap: {
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
    overflow: "hidden",
    background: "#0d1117",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    padding: "12px 16px",
    textAlign: "left",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#606060",
    fontFamily: "'Share Tech Mono',monospace",
    background: "#0a0a0a",
    borderBottom: "1px solid #1a2a1a",
  },
  tr: {
    borderBottom: "1px solid #1a2a1a",
  },
  td: {
    padding: "12px 16px",
    fontSize: "13px",
    color: "#c0c0c0",
    fontFamily: "'Rajdhani',system-ui,sans-serif",
  },
  mono: {
    fontFamily: "'Share Tech Mono',monospace",
    fontSize: "11px",
    color: "#00e5ff",
  },
  dim: {
    color: "#3a3a3a",
  },
  stageBadge: {
    fontSize: "10px",
    padding: "4px 8px",
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: "2px",
    fontFamily: "'Share Tech Mono',monospace",
    color: "#808080",
  },
  deliveryBadge: {
    fontSize: "10px",
    padding: "4px 8px",
    border: "1px solid",
    borderRadius: "2px",
    fontFamily: "'Share Tech Mono',monospace",
  },
  actionBtn: {
    padding: "6px 12px",
    background: "transparent",
    color: "#606060",
    border: "1px solid #2a2a2a",
    borderRadius: "2px",
    fontSize: "10px",
    fontFamily: "'Share Tech Mono',monospace",
    letterSpacing: "0.06em",
    cursor: "pointer",
  },
  deliverBtn: {
    borderColor: "#00e5ff",
    color: "#00e5ff",
  },
  kitPreview: {
    marginTop: "24px",
    padding: "20px",
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
    background: "#0d1117",
  },
  kitHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
    fontSize: "12px",
    color: "#808080",
    fontFamily: "'Share Tech Mono',monospace",
  },
  kitJson: {
    padding: "16px",
    background: "#0a0a0a",
    border: "1px solid #1a2a1a",
    borderRadius: "2px",
    fontSize: "11px",
    color: "#00ff88",
    fontFamily: "'Share Tech Mono',monospace",
    overflow: "auto",
    maxHeight: "400px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  errNote: {
    fontSize: "12px",
    color: "#ef4444",
    fontFamily: "'Share Tech Mono',monospace",
    marginBottom: "16px",
  },
  footer: {
    marginTop: "auto",
    paddingTop: "32px",
  },
};
