// Wendy clicked "Decline" in her notification email. We:
//   1. Verify the signed token
//   2. Delete the Outlook event (frees the slot for other clients)
//   3. Pull the client email from the event body and send a polite
//      "can't take this one" note via Resend
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
  if (parsed.action !== "decline") return html(400, "<h2>Wrong action for this link.</h2>");

  // Read event first so we can extract the client email before deleting
  let eventData = null;
  try {
    const res = await graphFetch(`/me/events/${encodeURIComponent(parsed.eventId)}`);
    if (res.ok) {
      eventData = await res.json();
    } else if (res.status === 404) {
      // Already deleted — show idempotent success
      return html(200, successHtml(null, "already-removed"));
    }
  } catch (e) {
    console.warn("[decline] couldn't read event before delete:", e.message);
  }

  // Delete the event
  try {
    const res = await graphFetch(`/me/events/${encodeURIComponent(parsed.eventId)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text();
      throw new Error(`delete ${res.status}: ${txt.slice(0, 200)}`);
    }
  } catch (e) {
    return html(500, `<h2>Couldn't decline the event.</h2><p>${escapeHtml(e.message)}</p>`);
  }

  // Best-effort: email the client. Look up their address from the
  // bookings blob (written at booking time) — more reliable than
  // parsing it out of the Outlook event body, which Outlook reformats.
  let emailedClient = false;
  if (process.env.RESEND_API_KEY) {
    let meta = null;
    try {
      const store = getBookingsStore();
      meta = await store.get(`booking/${parsed.eventId}`, { type: "json" });
    } catch (e) {
      console.warn("[decline] bookings blob read failed:", e.message);
    }
    if (meta && meta.email) {
      try {
        await sendClientDecline(meta.email, meta);
        emailedClient = true;
      } catch (e) {
        console.error("[decline] client email failed:", e.message);
      }
    }
  }

  // Clean up the bookings blob — the event is gone, no reason to keep its metadata
  try {
    const store = getBookingsStore();
    await store.delete(`booking/${parsed.eventId}`);
  } catch (e) {
    // Non-fatal
    console.warn("[decline] bookings blob cleanup failed:", e.message);
  }

  return html(200, successHtml(eventData, emailedClient ? "removed-emailed" : "removed-no-email"));
};

async function sendClientDecline(toEmail, meta) {
  const apiKey = process.env.RESEND_API_KEY;
  const firstName = meta && meta.name ? meta.name.split(" ")[0] : "there";

  const body =
    tpl.eyebrow("Booking update") +
    tpl.headline("Sorry —") +
    tpl.paragraph(`Hi <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
    tpl.paragraph(
      "Thanks so much for the booking request. Unfortunately I'm not " +
      "able to take this one — either the timing doesn't work on my end " +
      "or my schedule's already full that day."
    ) +
    tpl.paragraph(
      'If you\'d like, head back to <a href="https://wendypix.com/book" ' +
      `style="color:${tpl.COLORS.PLUM};font-weight:700;">wendypix.com/book</a> and pick ` +
      "another date — there are usually openings within a few weeks. " +
      "Or just reply to this email and we'll figure it out."
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
      subject: "About your booking request",
      html: tpl.wrap({
        preheader: "About your booking request",
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
  const subject = ev && ev.subject ? ev.subject : "Booking";
  const messages = {
    "removed-emailed": "Booking declined and removed from your calendar. The client was notified.",
    "removed-no-email": "Booking declined and removed from your calendar. Couldn't auto-notify the client — drop them a note manually.",
    "already-removed": "This booking was already removed — nothing changed.",
  };
  const msg = messages[mode] || "Booking declined.";
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:80px auto;padding:0 24px">
      <h1 style="font-weight:900;letter-spacing:-0.04em;font-size:48px;margin:0">DECLINED.</h1>
      <p style="font-size:18px;color:#444;margin:20px 0">${escapeHtml(msg)}</p>
      ${ev ? `<p style="background:#f1ece2;border-left:4px solid #b347b9;padding:14px 18px;margin:24px 0;font-weight:600">${escapeHtml(subject)}</p>` : ""}
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
