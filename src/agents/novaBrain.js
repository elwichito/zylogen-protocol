"use strict";

/**
 * novaBrain.js  —  MVP v2
 *
 * Single model: Claude Sonnet only.
 * No dual-routing, no GPT-4o-mini, no Privy dependency.
 * State persisted in SQLite nova_sessions table.
 */

const Anthropic = require("@anthropic-ai/sdk");
const db = require("../db/sqlite");

let _anthropic;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const MODEL = "claude-sonnet-4-5";

// ─── Briefing + Kit in one call ───────────────────────────────────────────────

/**
 * Processes a chat message from the client.
 * Runs a briefing conversation until all 7 data points are collected,
 * then generates and returns the full Branding Kit.
 *
 * @param {string} email
 * @param {string} userMessage
 * @returns {{ stage: string, reply?: string, kit?: object }}
 */
async function processClientMessage(email, userMessage) {
  // Upsert session
  db.prepare(`
    INSERT OR IGNORE INTO nova_sessions (client_email) VALUES (?)
  `).run(email);

  const session = db.prepare(
    `SELECT * FROM nova_sessions WHERE client_email = ?`
  ).get(email);

  if (session.stage === "kit_delivered") {
    // Follow-up question after kit delivery
    const reply = await askClaude([
      { role: "system", content: "You are Nova. The client's Branding Kit is complete. Answer follow-up questions concisely." },
      { role: "user",   content: userMessage },
    ]);
    return { stage: "followup", reply };
  }

  // Reconstruct conversation from stored context
  const history = session.brand_context
    ? JSON.parse(session.brand_context)
    : [];

  history.push({ role: "user", content: userMessage });

  const systemPrompt = `You are Nova, an elite branding consultant for Instagram professionals.
Collect these 7 data points through natural conversation (one question at a time):
business name, niche, target audience, brand voice (3 adjectives), color preferences,
competitor inspiration, primary quarterly goal.

Once you have all 7, respond with ONLY this block:
<BRIEFING_COMPLETE>
{"businessName":"...","niche":"...","targetAudience":"...","brandVoice":["...","...","..."],"colorPreferences":"...","competitorInspo":"...","primaryGoal":"..."}
</BRIEFING_COMPLETE>`;

  const reply = await askClaude([
    { role: "system", content: systemPrompt },
    ...history,
  ]);

  const match = reply.match(/<BRIEFING_COMPLETE>([\s\S]*?)<\/BRIEFING_COMPLETE>/);

  if (!match) {
    // Still collecting — save updated history
    history.push({ role: "assistant", content: reply });
    db.prepare(`UPDATE nova_sessions SET brand_context = ? WHERE client_email = ?`)
      .run(JSON.stringify(history), email);
    return { stage: "briefing", reply };
  }

  // Briefing complete — generate kit
  let brief;
  try {
    brief = JSON.parse(match[1].trim());
  } catch {
    return { stage: "briefing", reply: "Let me rephrase that — can you confirm your business name?" };
  }

  const kit = await generateBrandingKit(brief);

  db.prepare(`
    UPDATE nova_sessions
    SET stage = 'kit_delivered', brand_context = ?, branding_kit = ?
    WHERE client_email = ?
  `).run(JSON.stringify(brief), JSON.stringify(kit), email);

  return { stage: "kit_delivered", kit };
}

// ─── Branding Kit generation ──────────────────────────────────────────────────

async function generateBrandingKit(brief) {
  const prompt = `You are Nova, elite branding strategist for Instagram professionals.

Brand Brief:
${JSON.stringify(brief, null, 2)}

Generate a complete Branding Kit as JSON:
{
  "brandIdentity":   { "tagline":"...", "bio":"...(max 150 chars)", "brandPromise":"...", "cta":"..." },
  "visualSystem":    { "primaryColor":"#hex", "secondaryColor":"#hex", "accent":"#hex", "fonts":{"heading":"...","body":"..."}, "moodBoard":["...x5"] },
  "contentStrategy": { "30dayPlan":[{"week":1,"theme":"...","posts":3},...x4], "hashtagSets":[["...x5"],...x10], "hooks":["...x5"] },
  "voiceGuide":      { "dos":["...x5"], "donts":["...x5"], "captions":["...x3"] },
  "edge":            { "positioning":"...", "differentiators":["...x3"] }
}

Return ONLY valid JSON. No markdown fences.`;

  const raw = await askClaude([{ role: "user", content: prompt }]);

  try {
    return JSON.parse(raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, ""));
  } catch {
    return { raw };
  }
}

// ─── Claude helper ────────────────────────────────────────────────────────────

async function askClaude(messages) {
  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs  = messages.filter((m) => m.role !== "system");

  const response = await getAnthropic().messages.create({
    model:      MODEL,
    max_tokens: 4096,
    ...(systemMsg ? { system: systemMsg.content } : {}),
    messages:   userMsgs,
  });

  return response.content[0].text;
}

module.exports = { processClientMessage, generateBrandingKit };
