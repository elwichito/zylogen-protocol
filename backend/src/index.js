"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const express = require("express");
const cors    = require("cors");
const webhookRouter = require("./routes/webhook");
const novaRouter    = require("./routes/nova");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allowlist both the canonical domain and the Vercel preview URL.
// Add further origins to ALLOWED_ORIGINS in .env as a comma-separated list.

const ALWAYS_ALLOWED = [
  "https://zylogen.xyz",
  "https://www.zylogen.xyz",
  "https://zylogen-protocol.vercel.app",
];

const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((o) => o.trim()).filter(Boolean);

const allowedOrigins = new Set([...ALWAYS_ALLOWED, ...extraOrigins]);

// localhost is allowed in non-production for local dev
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.add("http://localhost:3000");
  allowedOrigins.add("http://localhost:3001");
}

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server requests (no Origin header) and whitelisted origins
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,   // browsers cache preflight for 24h
}));

// /webhooks/stripe must receive raw body — register before express.json()
app.use("/webhooks", webhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use("/api/nova", novaRouter);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "zylogen-nova" }));

app.use((err, _req, res, _next) => {
  console.error("[server]", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`[server] Nova backend on :${PORT}`);
  console.log(`  POST /webhooks/stripe`);
  console.log(`  GET  /api/nova/scarcity`);
  console.log(`  POST /api/nova/checkout`);
  console.log(`  POST /api/nova/message`);
  console.log(`  GET  /api/nova/status?email=`);
  console.log(`  GET  /health`);
});

module.exports = app;
