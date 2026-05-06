"use strict";

/**
 * email.js — Email notification service using Resend
 *
 * Simple transactional emails for:
 * - Payment confirmation (Stripe or crypto)
 * - Kit delivery notification
 */

const { email: log } = require("../lib/logger");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM || "Nova <nova@zylogen.xyz>";

/**
 * Send an email via Resend API
 * @param {string} to - recipient email
 * @param {string} subject - email subject
 * @param {string} html - HTML body
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    log.warn({ to, subject }, "RESEND_API_KEY not set - skipping email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      log.error({ to, subject, apiError: data }, "Resend API error");
      return { success: false, error: data.message || "Failed to send email" };
    }

    log.info({ to, subject, emailId: data.id }, "Email sent");
    return { success: true, id: data.id };
  } catch (err) {
    log.error({ err, to, subject }, "Email send failed");
    return { success: false, error: err.message };
  }
}

/**
 * Send payment confirmation email
 * @param {string} email - recipient email
 * @param {string} paymentMethod - "stripe" or "crypto"
 */
async function sendPaymentConfirmedEmail(email, paymentMethod = "stripe") {
  const subject = "Payment Confirmed — Welcome to the Founding 100";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
    .badge { display: inline-block; background: #10b981; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">Payment Confirmed</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">You're officially in the Founding 100</p>
  </div>
  <div class="content">
    <p>Hey there,</p>
    <p>Your payment has been confirmed${paymentMethod === "crypto" ? " on-chain" : ""}. You now have full access to Nova, your AI branding consultant.</p>
    <p><span class="badge">Founding 100 Member</span></p>
    <p>Head to your dashboard to start the conversation:</p>
    <p><a href="https://zylogen.xyz/nova/dashboard?email=${encodeURIComponent(email)}" style="color: #667eea; font-weight: 600;">Open Dashboard →</a></p>
    <p>Nova will guide you through creating your personalized Instagram branding kit. The whole process takes about 10-15 minutes of chatting.</p>
    <p style="margin-top: 30px;">— The Zylogen Team</p>
  </div>
  <div class="footer">
    <p>Zylogen Protocol · Building the future of AI-powered services</p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail(email, subject, html);
}

/**
 * Send kit delivered notification email
 * @param {string} email - recipient email
 * @param {object} kitSummary - optional summary of the kit contents
 */
async function sendKitDeliveredEmail(email, kitSummary = null) {
  const subject = "Your Branding Kit is Ready";

  // Build a simple summary if provided
  let kitSection = "";
  if (kitSummary) {
    const items = [];
    if (kitSummary.handle) items.push(`<li><strong>Handle:</strong> @${kitSummary.handle}</li>`);
    if (kitSummary.tagline) items.push(`<li><strong>Tagline:</strong> ${kitSummary.tagline}</li>`);
    if (kitSummary.colorPalette) items.push(`<li><strong>Colors:</strong> ${Array.isArray(kitSummary.colorPalette) ? kitSummary.colorPalette.join(", ") : kitSummary.colorPalette}</li>`);
    if (kitSummary.fonts) items.push(`<li><strong>Fonts:</strong> ${Array.isArray(kitSummary.fonts) ? kitSummary.fonts.join(", ") : kitSummary.fonts}</li>`);

    if (items.length > 0) {
      kitSection = `
        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #374151;">Kit Preview</h3>
          <ul style="margin: 0; padding-left: 20px;">
            ${items.join("\n            ")}
          </ul>
        </div>
      `;
    }
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
    .cta { display: inline-block; background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">Your Kit is Ready!</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">Nova has finished crafting your branding kit</p>
  </div>
  <div class="content">
    <p>Great news!</p>
    <p>Nova has completed your personalized Instagram branding kit. Your complete kit is waiting for you on the dashboard.</p>
    ${kitSection}
    <p style="text-align: center;">
      <a href="https://zylogen.xyz/nova/dashboard?email=${encodeURIComponent(email)}" class="cta">View Your Kit →</a>
    </p>
    <p>Need changes? You can continue chatting with Nova to refine any aspect of your kit.</p>
    <p style="margin-top: 30px;">— The Zylogen Team</p>
  </div>
  <div class="footer">
    <p>Zylogen Protocol · Building the future of AI-powered services</p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail(email, subject, html);
}

module.exports = {
  sendEmail,
  sendPaymentConfirmedEmail,
  sendKitDeliveredEmail,
};
