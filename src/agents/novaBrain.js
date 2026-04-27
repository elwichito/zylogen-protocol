"use strict";

/**
 * novaBrain.js  —  v2 (concierge mode)
 *
 * 3-question chip-based intake → manual fulfillment by Wichi.
 * No auto-generation of kits/logos/PDFs.
 * Bilingual: auto-detects ES/EN from first user message.
 */

const Anthropic = require("@anthropic-ai/sdk");
const db = require("../db/sqlite");

let _anthropic;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const MODEL = "claude-sonnet-4-5";

// ─── Stage constants ────────────────────────────────────────────────────────

const STAGES = {
  Q1: "briefing_q1",
  Q2: "briefing_q2",
  Q3: "briefing_q3",
  COMPLETE: "brief_complete",
  DELIVERED: "kit_delivered",
};

// ─── Language detection ─────────────────────────────────────────────────────

const ES_PATTERNS = /\b(hola|mi negocio|tengo|quiero|soy|necesito|marca|negocio|empresa|tienda|somos|nuestro|nuestra|por favor|gracias|buenas|buenos)\b/i;

function detectLanguage(text) {
  return ES_PATTERNS.test(text) ? "es" : "en";
}

// ─── Scarcity helper ────────────────────────────────────────────────────────

function getMemberNumber(email) {
  const record = db.prepare(
    `SELECT id FROM escrow_records WHERE client_email = ? ORDER BY id ASC LIMIT 1`
  ).get(email);
  return record?.id ?? "?";
}

// ─── Response templates ─────────────────────────────────────────────────────

const TEMPLATES = {
  en: {
    welcome: (n) =>
      `Welcome to Nova — Founding 100 member #${n}. 🎉\nLet's build your brand in 3 quick questions.\n\n**Question 1 of 3:** What type of business?`,
    q2: `Got it. **Question 2 of 3:** What vibe are you going for?`,
    q3: `**Final question:** In 1-2 sentences, tell me your brand name and what it does.`,
    complete: (email, txHash) =>
      `Brief received. Nova is now working on your brand identity.\n\nYour deliverables will be ready within 24 hours:\n📄 Logo concept (PDF)\n📘 Brand Guide (PDF)\n\nWe'll notify you at: ${email}\nYour escrow remains locked on Base until delivery is approved.${txHash ? `\n\n[View your transaction on Basescan ↗](https://basescan.org/tx/${txHash})` : ""}`,
    followup_system: "You are Nova, a brand strategist. The client's brief is complete and awaiting manual delivery. Answer follow-up questions concisely (max 3 sentences). Do not ask new questions. Do not use sycophantic adjectives.",
  },
  es: {
    welcome: (n) =>
      `Bienvenido a Nova — Founding 100 miembro #${n}. 🎉\nVamos a construir tu marca en 3 preguntas rápidas.\n\n**Pregunta 1 de 3:** ¿Qué tipo de negocio?`,
    q2: `Entendido. **Pregunta 2 de 3:** ¿Qué estilo buscas?`,
    q3: `**Última pregunta:** En 1-2 oraciones, dime el nombre de tu marca y qué hace.`,
    complete: (email, txHash) =>
      `Brief recibido. Nova está trabajando en tu identidad de marca.\n\nTus entregables estarán listos en 24 horas:\n📄 Concepto de logo (PDF)\n📘 Guía de marca (PDF)\n\nTe notificaremos a: ${email}\nTu escrow permanece bloqueado en Base hasta que apruebes la entrega.${txHash ? `\n\n[Ver tu transacción en Basescan ↗](https://basescan.org/tx/${txHash})` : ""}`,
    followup_system: "Eres Nova, una estratega de marca. El brief del cliente está completo y pendiente de entrega manual. Responde preguntas de seguimiento de forma concisa (máximo 3 oraciones). No hagas preguntas nuevas. No uses adjetivos aduladores.",
  },
};

// ─── Core message handler ───────────────────────────────────────────────────

/**
 * @param {string} email
 * @param {string} userMessage
 * @returns {{ stage: string, reply: string, chips?: object }}
 */
async function processClientMessage(email, userMessage) {
  // Upsert session
  db.prepare(`INSERT OR IGNORE INTO nova_sessions (client_email) VALUES (?)`).run(email);

  const session = db.prepare(
    `SELECT * FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  const stage = session.stage || STAGES.Q1;

  // Load payment context
  const escrow = db.prepare(
    `SELECT client_wallet, tx_hash, created_at FROM escrow_records WHERE client_email = ? AND status IN ('locked','released') ORDER BY id ASC LIMIT 1`
  ).get(email);

  // Detect language on first message, persist it
  let lang = session.language;
  if (!lang) {
    lang = detectLanguage(userMessage);
    db.prepare(`UPDATE nova_sessions SET language = ? WHERE client_email = ?`).run(lang, email);
  }

  const t = TEMPLATES[lang];

  // ── Stage routing ───────────────────────────────────────────────────────

  if (stage === STAGES.DELIVERED) {
    // Post-delivery follow-up via Claude
    const reply = await askClaude([
      { role: "system", content: t.followup_system },
      { role: "user", content: userMessage },
    ]);
    return { stage: "followup", reply };
  }

  if (stage === STAGES.COMPLETE) {
    // Brief already submitted — short reply
    const reply = lang === "es"
      ? "Tu brief ya fue enviado. Estamos trabajando en tus entregables. Te notificaremos pronto."
      : "Your brief is already submitted. We're working on your deliverables. We'll notify you soon.";
    return { stage: STAGES.COMPLETE, reply };
  }

  if (stage === STAGES.Q1) {
    // First message — store answer, advance to Q2
    db.prepare(`
      UPDATE nova_sessions SET stage = ?, business_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE client_email = ?
    `).run(STAGES.Q2, userMessage.trim().slice(0, 100), email);

    return {
      stage: STAGES.Q2,
      reply: t.q2,
      chips: { type: "vibe", multiSelect: true, max: 2 },
    };
  }

  if (stage === STAGES.Q2) {
    // Store vibe tags, advance to Q3
    const vibes = userMessage.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 2);
    db.prepare(`
      UPDATE nova_sessions SET stage = ?, vibe_tags = ?, updated_at = CURRENT_TIMESTAMP
      WHERE client_email = ?
    `).run(STAGES.Q3, JSON.stringify(vibes), email);

    return {
      stage: STAGES.Q3,
      reply: t.q3,
      chips: null, // free text only
    };
  }

  if (stage === STAGES.Q3) {
    // Store brand description, mark brief complete
    const desc = userMessage.trim().slice(0, 200);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE nova_sessions
      SET stage = ?, brand_description = ?, brief_submitted_at = ?, delivery_status = 'pending', updated_at = CURRENT_TIMESTAMP
      WHERE client_email = ?
    `).run(STAGES.COMPLETE, desc, now, email);

    // Load full brief for logging
    const updated = db.prepare(`SELECT * FROM nova_sessions WHERE client_email = ?`).get(email);

    console.log(`[NEW_BRIEF] ═══════════════════════════════════════════════`);
    console.log(`[NEW_BRIEF] Email:    ${email}`);
    console.log(`[NEW_BRIEF] Wallet:   ${escrow?.client_wallet ?? "unknown"}`);
    console.log(`[NEW_BRIEF] Business: ${updated.business_type}`);
    console.log(`[NEW_BRIEF] Vibes:    ${updated.vibe_tags}`);
    console.log(`[NEW_BRIEF] Brand:    ${desc}`);
    console.log(`[NEW_BRIEF] Time:     ${now}`);
    console.log(`[NEW_BRIEF] ═══════════════════════════════════════════════`);

    return {
      stage: STAGES.COMPLETE,
      reply: t.complete(email, escrow?.tx_hash),
      chips: null,
    };
  }

  // Fallback — shouldn't reach here
  return { stage, reply: "Something went wrong. Please refresh the page." };
}

// ─── Claude helper ──────────────────────────────────────────────────────────

async function askClaude(messages) {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs = messages.filter((m) => m.role !== "system");

  const response = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 512,
    ...(systemMsg ? { system: systemMsg.content } : {}),
    messages: userMsgs,
  });

  return response.content[0].text;
}

module.exports = { processClientMessage };
