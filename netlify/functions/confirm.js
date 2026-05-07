// Wendy clicked the "Confirm booking" button in her notification email.
// We:
//   1. Verify the signed token to make sure this isn't a forged URL
//   2. Flip the Outlook event from tentative → busy
//   3. Pull the client email from the event body and send them a
//      "your session is confirmed" email via Resend
//   4. Show Wendy a friendly success page

const { graphFetch } = require("./_msgraph");
const { verify } = require("./_token");

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

  // 3. Best-effort: email the client a confirmation
  let emailedClient = false;
  const clientEmail = extractClientEmail(eventData.body && eventData.body.content);
  if (clientEmail && process.env.RESEND_API_KEY) {
    try {
      await sendClientConfirm(clientEmail, eventData);
      emailedClient = true;
    } catch (e) {
      console.error("[confirm] client email failed:", e.message);
    }
  }

  return html(200, successHtml(eventData, emailedClient ? "confirmed-emailed" : "confirmed-no-email"));
};

// Pull the client email out of the event body (we wrote it there in
// book.js as "Email:  someone@example.com")
function extractClientEmail(bodyContent) {
  if (!bodyContent) return null;
  // Strip HTML if present (Outlook may convert plain text bodies)
  const text = bodyContent.replace(/<[^>]+>/g, " ");
  const m = text.match(/Email:\s*([^\s<>]+@[^\s<>]+)/i);
  return m ? m[1] : null;
}

async function sendClientConfirm(toEmail, eventData) {
  const apiKey = process.env.RESEND_API_KEY;
  const start = eventData.start ? new Date(
    eventData.start.dateTime + (eventData.start.dateTime.endsWith("Z") ? "" : "Z")
  ) : null;
  const startStr = start ? start.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }) : "your session";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Wendy Shapero <wendy@wendypix.com>",
      to: [toEmail],
      subject: `Your session is confirmed — ${startStr}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <p style="font-size:18px;font-weight:700">Hi —</p>
          <p>You're booked! See you on:</p>
          <p style="background:#f1ece2;border-left:4px solid #b347b9;padding:14px 18px;margin:18px 0">
            <strong>${escapeHtml(startStr)}</strong>
          </p>
          <p>I'll be in touch shortly with the deposit invoice (50% non-refundable
          retainer) and any pre-shoot details. Reply to this email anytime if
          you have questions.</p>
          <p style="margin-top:32px">— Wendy<br/>
          <a href="https://wendypix.com" style="color:#b347b9">wendypix.com</a></p>
        </div>`,
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
