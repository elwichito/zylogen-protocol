"use strict";

/**
 * kitGenerator.js — Automated branding kit generation via Claude API
 *
 * Takes briefing data from nova_sessions and generates a complete branding kit:
 * - Brand name suggestions (3 options)
 * - Tagline options (3)
 * - Color palette (5 hex colors with meanings)
 * - Typography recommendations (2 font pairings)
 * - Brand voice guidelines
 * - 30-day content calendar for Instagram
 * - Instagram bio (ready to copy-paste)
 */

const Anthropic = require("@anthropic-ai/sdk");
const db = require("../db/sqlite");
const { nova: log } = require("../lib/logger");

let _anthropic;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const MODEL = "claude-sonnet-4-5";

// ─── System prompt for kit generation ───────────────────────────────────────

const SYSTEM_PROMPT_EN = `You are Nova, an expert brand strategist and creative director. Your task is to create a comprehensive branding kit based on the client's briefing data.

You must respond with ONLY a valid JSON object (no markdown, no explanation, no additional text). The JSON must follow this exact structure:

{
  "brandNames": [
    { "name": "Name1", "rationale": "Brief explanation of why this name works" },
    { "name": "Name2", "rationale": "Brief explanation" },
    { "name": "Name3", "rationale": "Brief explanation" }
  ],
  "taglines": [
    { "text": "Tagline 1", "useCase": "Primary/Hero tagline" },
    { "text": "Tagline 2", "useCase": "Social media bio" },
    { "text": "Tagline 3", "useCase": "Email signature" }
  ],
  "colorPalette": [
    { "hex": "#XXXXXX", "name": "Color name", "meaning": "What this color conveys", "usage": "Where to use it" },
    { "hex": "#XXXXXX", "name": "Color name", "meaning": "Meaning", "usage": "Usage" },
    { "hex": "#XXXXXX", "name": "Color name", "meaning": "Meaning", "usage": "Usage" },
    { "hex": "#XXXXXX", "name": "Color name", "meaning": "Meaning", "usage": "Usage" },
    { "hex": "#XXXXXX", "name": "Color name", "meaning": "Meaning", "usage": "Usage" }
  ],
  "typography": [
    {
      "role": "Headings",
      "fontName": "Font Name",
      "fontFamily": "sans-serif|serif|display",
      "googleFontsUrl": "https://fonts.google.com/specimen/FontName",
      "rationale": "Why this font"
    },
    {
      "role": "Body text",
      "fontName": "Font Name",
      "fontFamily": "sans-serif|serif",
      "googleFontsUrl": "https://fonts.google.com/specimen/FontName",
      "rationale": "Why this font"
    }
  ],
  "brandVoice": {
    "tone": "3-5 adjectives describing the tone",
    "vocabulary": ["word1", "word2", "word3", "word4", "word5"],
    "avoidWords": ["word1", "word2", "word3"],
    "examples": {
      "greeting": "Example greeting in brand voice",
      "productDescription": "Example product/service description",
      "callToAction": "Example CTA"
    }
  },
  "contentCalendar": [
    { "day": 1, "type": "Reel|Carousel|Story|Static", "topic": "Post topic", "caption": "Draft caption (2-3 sentences)", "hashtags": ["tag1", "tag2", "tag3"] },
    ... (30 days total)
  ],
  "instagramBio": {
    "lines": ["Line 1", "Line 2", "Line 3", "Line 4"],
    "emoji": true,
    "cta": "Link in bio CTA"
  }
}

Guidelines:
- Brand names should be memorable, easy to spell, and domain-friendly
- Colors should work well together and be WCAG accessible
- Use only free Google Fonts for typography
- Content calendar should have variety (mix of Reels, Carousels, Stories, Static posts)
- Instagram bio must fit within 150 characters per line
- Match the vibe and energy specified by the client
- If the client provided their brand name in the description, use it as the primary name and suggest 2 variations`;

const SYSTEM_PROMPT_ES = `Eres Nova, una estratega de marca experta y directora creativa. Tu tarea es crear un kit de branding completo basado en los datos del brief del cliente.

Debes responder SOLO con un objeto JSON valido (sin markdown, sin explicacion, sin texto adicional). El JSON debe seguir esta estructura exacta:

{
  "brandNames": [
    { "name": "Nombre1", "rationale": "Breve explicacion de por que funciona este nombre" },
    { "name": "Nombre2", "rationale": "Breve explicacion" },
    { "name": "Nombre3", "rationale": "Breve explicacion" }
  ],
  "taglines": [
    { "text": "Tagline 1", "useCase": "Tagline principal/Hero" },
    { "text": "Tagline 2", "useCase": "Bio de redes sociales" },
    { "text": "Tagline 3", "useCase": "Firma de email" }
  ],
  "colorPalette": [
    { "hex": "#XXXXXX", "name": "Nombre del color", "meaning": "Lo que transmite este color", "usage": "Donde usarlo" },
    { "hex": "#XXXXXX", "name": "Nombre", "meaning": "Significado", "usage": "Uso" },
    { "hex": "#XXXXXX", "name": "Nombre", "meaning": "Significado", "usage": "Uso" },
    { "hex": "#XXXXXX", "name": "Nombre", "meaning": "Significado", "usage": "Uso" },
    { "hex": "#XXXXXX", "name": "Nombre", "meaning": "Significado", "usage": "Uso" }
  ],
  "typography": [
    {
      "role": "Titulos",
      "fontName": "Nombre de Fuente",
      "fontFamily": "sans-serif|serif|display",
      "googleFontsUrl": "https://fonts.google.com/specimen/FontName",
      "rationale": "Por que esta fuente"
    },
    {
      "role": "Texto del cuerpo",
      "fontName": "Nombre de Fuente",
      "fontFamily": "sans-serif|serif",
      "googleFontsUrl": "https://fonts.google.com/specimen/FontName",
      "rationale": "Por que esta fuente"
    }
  ],
  "brandVoice": {
    "tone": "3-5 adjetivos que describen el tono",
    "vocabulary": ["palabra1", "palabra2", "palabra3", "palabra4", "palabra5"],
    "avoidWords": ["palabra1", "palabra2", "palabra3"],
    "examples": {
      "greeting": "Ejemplo de saludo en la voz de la marca",
      "productDescription": "Ejemplo de descripcion de producto/servicio",
      "callToAction": "Ejemplo de CTA"
    }
  },
  "contentCalendar": [
    { "day": 1, "type": "Reel|Carousel|Story|Static", "topic": "Tema del post", "caption": "Borrador del caption (2-3 oraciones)", "hashtags": ["tag1", "tag2", "tag3"] },
    ... (30 dias en total)
  ],
  "instagramBio": {
    "lines": ["Linea 1", "Linea 2", "Linea 3", "Linea 4"],
    "emoji": true,
    "cta": "CTA del link en bio"
  }
}

Directrices:
- Los nombres de marca deben ser memorables, faciles de deletrear y amigables para dominios
- Los colores deben combinar bien y ser accesibles segun WCAG
- Usa solo fuentes gratuitas de Google Fonts para tipografia
- El calendario de contenido debe tener variedad (mezcla de Reels, Carousels, Stories, posts estaticos)
- La bio de Instagram debe caber en 150 caracteres por linea
- Coincide con la vibra y energia especificada por el cliente
- Si el cliente proporciono el nombre de su marca en la descripcion, usalo como nombre principal y sugiere 2 variaciones`;

// ─── Kit generation ─────────────────────────────────────────────────────────

/**
 * Generates a branding kit from session briefing data
 * @param {string} email - Client email to look up session
 * @returns {Promise<object>} - The generated branding kit
 * @throws {Error} - If session not found or generation fails
 */
async function generateKit(email) {
  log.info({ email }, "Starting kit generation");

  // Load session data
  const session = db.prepare(`
    SELECT business_type, vibe_tags, brand_description, language
    FROM nova_sessions
    WHERE client_email = ?
  `).get(email);

  if (!session) {
    log.error({ email }, "Session not found for kit generation");
    throw new Error("Session not found");
  }

  const { business_type, vibe_tags, brand_description, language } = session;

  if (!business_type || !brand_description) {
    log.error({ email, business_type, brand_description }, "Incomplete briefing data");
    throw new Error("Incomplete briefing data - business_type and brand_description required");
  }

  // Parse vibe tags
  let vibes = [];
  try {
    vibes = vibe_tags ? JSON.parse(vibe_tags) : [];
  } catch {
    log.warn({ email, vibe_tags }, "Failed to parse vibe_tags, using empty array");
  }

  const lang = language || "en";
  const systemPrompt = lang === "es" ? SYSTEM_PROMPT_ES : SYSTEM_PROMPT_EN;

  // Build the user prompt with briefing data
  const userPrompt = lang === "es"
    ? `Crea un kit de branding completo para este cliente:

**Tipo de negocio:** ${business_type}
**Estilo/Vibra deseada:** ${vibes.length > 0 ? vibes.join(", ") : "No especificado"}
**Descripcion de la marca:** ${brand_description}

Genera el kit completo en formato JSON.`
    : `Create a complete branding kit for this client:

**Business type:** ${business_type}
**Desired vibe/style:** ${vibes.length > 0 ? vibes.join(", ") : "Not specified"}
**Brand description:** ${brand_description}

Generate the complete kit in JSON format.`;

  log.info({ email, businessType: business_type, vibes, lang }, "Calling Claude API for kit generation");

  const startTime = Date.now();

  try {
    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const duration = Date.now() - startTime;
    log.info({ email, duration, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens }, "Claude API response received");

    const rawContent = response.content[0].text;

    // Parse the JSON response
    let kit;
    try {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent.trim();
      kit = JSON.parse(jsonStr);
    } catch (parseErr) {
      log.error({ email, parseErr: parseErr.message, rawContent: rawContent.slice(0, 500) }, "Failed to parse kit JSON");
      throw new Error("Failed to parse generated kit - invalid JSON response");
    }

    // Validate kit structure
    const requiredFields = ["brandNames", "taglines", "colorPalette", "typography", "brandVoice", "contentCalendar", "instagramBio"];
    const missingFields = requiredFields.filter(f => !kit[f]);

    if (missingFields.length > 0) {
      log.error({ email, missingFields }, "Generated kit missing required fields");
      throw new Error(`Generated kit missing fields: ${missingFields.join(", ")}`);
    }

    // Add metadata to kit
    kit.metadata = {
      generatedAt: new Date().toISOString(),
      language: lang,
      model: MODEL,
      briefing: {
        businessType: business_type,
        vibes,
        brandDescription: brand_description,
      },
    };

    log.info({ email, brandNamesCount: kit.brandNames?.length, contentDays: kit.contentCalendar?.length }, "Kit generation complete");

    return kit;

  } catch (err) {
    const duration = Date.now() - startTime;
    log.error({ email, err: err.message, duration }, "Kit generation failed");
    throw err;
  }
}

/**
 * Generates kit and saves it to the session
 * @param {string} email - Client email
 * @returns {Promise<object>} - The generated kit
 */
async function generateAndSaveKit(email) {
  const kit = await generateKit(email);

  // Save kit to database
  db.prepare(`
    UPDATE nova_sessions
    SET branding_kit = ?, delivery_status = 'in_progress', updated_at = CURRENT_TIMESTAMP
    WHERE client_email = ?
  `).run(JSON.stringify(kit), email);

  log.info({ email }, "Kit saved to database");

  return kit;
}

/**
 * Marks kit as delivered and updates session stage
 * @param {string} email - Client email
 * @param {object} kit - The kit to deliver (if not already saved)
 */
function markKitDelivered(email, kit = null) {
  if (kit) {
    db.prepare(`
      UPDATE nova_sessions
      SET branding_kit = ?, delivery_status = 'delivered', stage = 'kit_delivered', updated_at = CURRENT_TIMESTAMP
      WHERE client_email = ?
    `).run(JSON.stringify(kit), email);
  } else {
    db.prepare(`
      UPDATE nova_sessions
      SET delivery_status = 'delivered', stage = 'kit_delivered', updated_at = CURRENT_TIMESTAMP
      WHERE client_email = ?
    `).run(email);
  }

  log.info({ email }, "Kit marked as delivered");
}

module.exports = {
  generateKit,
  generateAndSaveKit,
  markKitDelivered,
};
