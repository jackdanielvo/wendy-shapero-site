// Wendy clicked the "Confirm booking" button in her notification email.
// We:
//   1. Verify the signed token to make sure this isn't a forged URL
//   2. Flip the Outlook event from tentative → busy
//   3. Pull the client email from the event body and send them a
//      "your session is confirmed" email via Resend
//   4. Show Wendy a friendly success page

const { graphFetch } = require("./_msgraph");
const { verify } = require("./_token");
const { getBookingsStore } = require("./_blobs");
const tpl = require("./_email");

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).t;
  if (!token) return html(400, "<h2>Missing token.</h2>");

  let parsed;
  try {
    parsed = verify(token);
  } catch (e) {
    return html(500, `<h2>Server config error.</h2><p>${escapeHtml(e.message)}</p>`);
  }
  if (!parsed) return html(400, "<h2>This link is invalid or has expired.</h2>");
  if (parsed.action !== "confirm") return html(400, "<h2>Wrong action for this link.</h2>");

  // 1. Read the existing event so we can grab its details + client email
  let eventData;
  try {
    const res = await graphFetch(`/me/events/${encodeURIComponent(parsed.eventId)}`);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`get event ${res.status}: ${txt.slice(0, 200)}`);
    }
    eventData = await res.json();
  } catch (e) {
    return html(500, `<h2>Couldn't load the event.</h2><p>${escapeHtml(e.message)}</p>`);
  }

  // Idempotency — if it's already busy, just re-show the confirmation.
  if ((eventData.showAs || "").toLowerCase() === "busy") {
    return html(200, successHtml(eventData, "already-confirmed"));
  }

  // 2. PATCH it to busy
  try {
    const res = await graphFetch(`/me/events/${encodeURIComponent(parsed.eventId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        showAs: "busy",
        subject: (eventData.subject || "WendyPix booking").replace(/^WendyPix:\s*/, "WendyPix ✓ "),
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`patch ${res.status}: ${txt.slice(0, 200)}`);
    }
  } catch (e) {
    return html(500, `<h2>Couldn't confirm the event.</h2><p>${escapeHtml(e.message)}</p>`);
  }

  // 3. Best-effort: email the client a confirmation. Look up the
  //    client's email from the bookings store (written when the
  //    booking was created) rather than scraping the calendar event
  //    body, which Outlook often reformats into HTML that breaks
  //    plain-text regex extraction.
  let emailedClient = false;
  let meta = null;
  try {
    const store = getBookingsStore();
    meta = await store.get(`booking/${parsed.eventId}`, { type: "json" });
  } catch (e) {
    console.warn("[confirm] bookings blob read failed:", e.message);
  }

  if (meta && meta.email && process.env.RESEND_API_KEY) {
    try {
      await sendClientConfirm(meta.email, eventData, meta);
      emailedClient = true;
    } catch (e) {
      console.error("[confirm] client email failed:", e.message);
    }
  }

  return html(200, successHtml(eventData, emailedClient ? "confirmed-emailed" : "confirmed-no-email"));
};

async function sendClientConfirm(toEmail, eventData, meta) {
  const apiKey = process.env.RESEND_API_KEY;
  const startSrc = (meta && meta.slotStart) || (eventData && eventData.start && eventData.start.dateTime);
  const start = startSrc ? new Date(
    startSrc.endsWith("Z") || startSrc.includes("+") ? startSrc : startSrc + "Z"
  ) : null;
  const firstName = meta && meta.name ? meta.name.split(" ")[0] : "there";
  const packageName = meta && meta.packageName ? meta.packageName : "your session";
  const startStr = tpl.formatDate(start);

  const body =
    tpl.eyebrow("Confirmed") +
    tpl.headline("You're booked.") +
    tpl.paragraph(`Hey <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
    tpl.paragraph("Locked in. See you on:") +
    tpl.callout(
      `${tpl.escapeHtml(packageName)}<br/>` +
      `<span style="font-weight:600;opacity:0.95;">${tpl.escapeHtml(startStr)}</span>`
    ) +
    tpl.paragraph(
      "I'll send the deposit invoice (50% non-refundable retainer) shortly, " +
      "along with the pre-shoot details — what to bring, where to meet, " +
      "what to wear. Reply anytime with questions."
    ) +
    tpl.signoff("&mdash; Wendy");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Wendy Shapero <wendy@wendypix.com>",
      to: [toEmail],
      subject: `Your ${packageName} is confirmed — ${startStr}`,
      html: tpl.wrap({
        preheader: `Locked in. ${packageName} — ${startStr}`,
        body,
      }),
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`resend ${res.status}: ${txt.slice(0, 200)}`);
  }
}

function successHtml(ev, mode) {
  const subject = (ev && ev.subject) || "Booking";
  const messages = {
    confirmed: "Booking confirmed in your calendar.",
    "already-confirmed": "This booking was already confirmed — nothing changed.",
    "confirmed-emailed": "Booking confirmed in your calendar. Confirmation email sent to the client.",
    "confirmed-no-email": "Booking confirmed in your calendar. Couldn't send the client an email automatically — drop them a note manually.",
  };
  const msg = messages[mode] || messages.confirmed;
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:80px auto;padding:0 24px">
      <h1 style="font-weight:900;letter-spacing:-0.04em;font-size:48px;margin:0">CONFIRMED.</h1>
      <p style="font-size:18px;color:#444;margin:20px 0">${escapeHtml(msg)}</p>
      <p style="background:#f1ece2;border-left:4px solid #b347b9;padding:14px 18px;margin:24px 0;font-weight:600">
        ${escapeHtml(subject)}
      </p>
      <p style="font-size:14px;color:#888">You can close this tab.</p>
    </div>`;
}

function html(code, body) {
  return {
    statusCode: code,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">${body}`,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
