"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const express   = require("express");
const cors      = require("cors");
const helmet    = require("helmet");
const rateLimit = require("express-rate-limit");
const { server: log, createRequestLogger } = require("./lib/logger");
const webhookRouter = require("./routes/webhook");
const novaRouter    = require("./routes/nova");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── SECURITY HEADERS ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
// Trust proxy for correct IP detection behind Railway/load balancer
app.set("trust proxy", 1);

// General rate limit: 100 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// AI chat endpoint: 10 requests per minute per IP
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many chat requests, please slow down" },
});

// Payment initiation: 5 requests per minute per IP
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checkout requests, please wait before trying again" },
});

// Admin deliver-kit: 20 requests per minute per IP
const deliverKitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many delivery requests" },
});

// Apply general rate limit to all routes
app.use(generalLimiter);

// ─── REQUEST LOGGING ──────────────────────────────────────────────────────────
app.use(createRequestLogger());

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

// Apply specific rate limits to Nova endpoints before the router
app.post("/api/nova/message", messageLimiter);
app.post("/api/nova/checkout", checkoutLimiter);
app.post("/api/nova/deliver-kit", deliverKitLimiter);

app.use("/api/nova", novaRouter);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "zylogen-nova" }));

app.use((err, req, res, _next) => {
  log.error({ err, reqId: req.id }, "Unhandled server error");
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  log.info({ port: PORT }, "Nova backend started");
  log.info({ routes: [
    "POST /webhooks/stripe",
    "GET  /api/nova/scarcity",
    "POST /api/nova/checkout",
    "POST /api/nova/message",
    "POST /api/nova/verify-payment",
    "GET  /api/nova/status?email=",
    "GET  /health",
  ]}, "Available routes");
});

module.exports = app;
