// inquiry.js
// --------------------------------------------------------------
// POST endpoint for inquiry-only packages (lifestyle, events).
// Receives the inline form from /book and emails Wendy via Resend.
// Optionally sends a confirmation back to the client.
//
// Request body shape:
//   {
//     "packageId":   "event-inquiry",
//     "packageName": "Event Coverage",
//     "name":        "Maria Jones",
//     "email":       "maria@example.com",
//     "phone":       "+1 213 555 0100",
//     "eventDate":   "2026-06-15",
//     "guestCount":  60,
//     "notes":       "Birthday party at our home in Pasadena."
//   }
//
// Required env vars:
//   RESEND_API_KEY — same key used by book.js / confirm.js
// Optional:
//   WENDY_EMAIL    — defaults to wendy@wendypix.com

const WENDY_EMAIL_DEFAULT = "wendy@wendypix.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "POST only" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // Validate required fields
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const packageName = String(body.packageName || "Inquiry").trim();
  if (!name) return json(400, { error: "Name is required." });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "A valid email is required." });
  }
  if (name.length > 200 || email.length > 200) {
    return json(400, { error: "Name or email is too long." });
  }

  // Pull and sanitize the rest
  const phone = String(body.phone || "").trim().slice(0, 60);
  const eventDate = String(body.eventDate || "").trim().slice(0, 40);
  const guestCount = String(body.guestCount || "").trim().slice(0, 12);
  const notes = String(body.notes || "").trim().slice(0, 4000);
  const packageId = String(body.packageId || "").trim().slice(0, 80);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No email service configured — log on the server so Wendy can
    // at least find it in Netlify function logs.
    console.warn("[inquiry] RESEND_API_KEY not set — logging only.");
    console.warn("[inquiry] body:", JSON.stringify(body));
    return json(200, {
      ok: true,
      emailed: false,
      message:
        "Thanks — we received your inquiry. Wendy will be in touch within 24 hours.",
    });
  }

  const wendyEmail = process.env.WENDY_EMAIL || WENDY_EMAIL_DEFAULT;

  // Format the body of the email to Wendy
  const lines = [
    `Package: ${packageName}${packageId ? ` (${packageId})` : ""}`,
    `Name:    ${name}`,
    `Email:   ${email}`,
    phone ? `Phone:   ${phone}` : null,
    eventDate ? `Date:    ${eventDate}` : null,
    guestCount ? `Guests:  ${guestCount}` : null,
    "",
    notes ? `Notes:\n${notes}` : "(no notes provided)",
  ]
    .filter(Boolean)
    .join("\n");

  // HTML version with light teal accents matching the site palette
  const htmlBody = `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <p style="margin: 0 0 8px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #1d5e62; font-weight: 800;">New inquiry · WendyPix</p>
  <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 800;">${escapeHtml(packageName)}</h1>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
    <tr><td style="padding: 6px 0; color: #6b6b6b; width: 110px;">Name</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(name)}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b6b6b;">Email</td><td style="padding: 6px 0;"><a href="mailto:${encodeURIComponent(email)}" style="color: #1d5e62;">${escapeHtml(email)}</a></td></tr>
    ${phone ? `<tr><td style="padding: 6px 0; color: #6b6b6b;">Phone</td><td style="padding: 6px 0;"><a href="tel:${encodeURIComponent(phone)}" style="color: #1d5e62;">${escapeHtml(phone)}</a></td></tr>` : ""}
    ${eventDate ? `<tr><td style="padding: 6px 0; color: #6b6b6b;">Date</td><td style="padding: 6px 0;">${escapeHtml(eventDate)}</td></tr>` : ""}
    ${guestCount ? `<tr><td style="padding: 6px 0; color: #6b6b6b;">Guests</td><td style="padding: 6px 0;">${escapeHtml(guestCount)}</td></tr>` : ""}
  </table>

  ${
    notes
      ? `<p style="margin: 0 0 6px; color: #6b6b6b; font-size: 13px;">Notes</p>
         <div style="padding: 12px 16px; background: #f5f1ea; border-left: 4px solid #1d5e62; border-radius: 4px; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(notes)}</div>`
      : `<p style="color: #888; font-style: italic;">No notes provided.</p>`
  }

  <p style="margin: 24px 0 0; font-size: 12px; color: #888;">
    Submitted via the inquiry form at wendypix.com/book.
    Reply directly to this email to respond — it goes to the client.
  </p>
</body></html>`;

  try {
    // Email Wendy. Set Reply-To to the client so she can just hit Reply.
    await resendSend(apiKey, {
      from: "WendyPix Inquiries <wendy@wendypix.com>",
      to: [wendyEmail],
      reply_to: email,
      subject: `Inquiry · ${packageName} · ${name}`,
      text: lines,
      html: htmlBody,
    });

    // Optional confirmation to the client so they know it landed
    try {
      await resendSend(apiKey, {
        from: "Wendy Shapero <wendy@wendypix.com>",
        to: [email],
        reply_to: wendyEmail,
        subject: `Got it — ${packageName} inquiry received`,
        text:
          `Hi ${name},\n\nThanks for reaching out about a ${packageName.toLowerCase()} session. I got your inquiry and will be in touch within 24 hours to scope it together.\n\n— Wendy\nwendy@wendypix.com\n+1 (818) 383-0102`,
        html: `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h1 style="font-size: 28px; font-weight: 900; margin: 0 0 16px;"><span style="color:#1d5e62;">WENDY</span><span style="color:#b347b9;">PIX</span></h1>
  <p style="font-size: 16px; line-height: 1.55;">Hi ${escapeHtml(name)},</p>
  <p style="font-size: 16px; line-height: 1.55;">Thanks for reaching out about a <strong>${escapeHtml(packageName.toLowerCase())}</strong> session. I got your inquiry and will be in touch within 24 hours to scope it together.</p>
  <p style="font-size: 16px; line-height: 1.55;">&mdash; Wendy</p>
  <p style="font-size: 13px; color: #666; margin-top: 28px;">
    <a href="mailto:wendy@wendypix.com" style="color:#1d5e62;">wendy@wendypix.com</a>
    &nbsp;·&nbsp;
    <a href="tel:+18183830102" style="color:#1d5e62;">+1 (818) 383-0102</a>
    &nbsp;·&nbsp;
    <a href="https://wendypix.com" style="color:#1d5e62;">wendypix.com</a>
  </p>
</body></html>`,
      });
    } catch (clientErr) {
      // Non-fatal — Wendy still got hers, that's the important one
      console.warn("[inquiry] client confirmation failed:", clientErr.message);
    }

    return json(200, {
      ok: true,
      emailed: true,
      message:
        "Thanks — your inquiry's in. Wendy will be in touch within 24 hours.",
    });
  } catch (err) {
    console.error("[inquiry] resend failed:", err);
    return json(500, {
      error:
        "Couldn't send the inquiry right now. Please email wendy@wendypix.com directly.",
    });
  }
};

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function resendSend(apiKey, payload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`resend ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function json(code, body) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
