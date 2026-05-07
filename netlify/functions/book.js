// Receives a booking submission from /book.
//
// Steps:
//   1. Validate input
//   2. Create a TENTATIVE event in Wendy's calendar via Microsoft Graph,
//      with the client's intake details in the description
//   3. (If RESEND_API_KEY is set) email the client a "request received"
//      confirmation, and email Wendy a notification with all details
//   4. (If STRIPE_SECRET_KEY is set — future) start a Stripe Checkout
//      session for the 50% deposit and return the redirect URL
//
// Each integration is gated on its env var. Bookings still succeed
// without Resend/Stripe — they just produce fewer side effects (e.g.
// no auto-email) which Wendy can handle manually until those services
// are wired up.

const { graphFetch } = require("./_msgraph");

const TIMEZONE_LABEL = "Pacific Standard Time"; // for Outlook event
const WENDY_EMAIL = "wendy@wendypix.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonError(405, "Method Not Allowed");
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  // Validation
  const required = ["packageId", "packageName", "slotStart", "name", "email"];
  for (const k of required) {
    if (!payload[k]) return jsonError(400, `Missing field: ${k}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return jsonError(400, "Invalid email");
  }

  const start = new Date(payload.slotStart);
  if (Number.isNaN(start.getTime())) return jsonError(400, "Invalid slotStart");
  const durationMin = Number(payload.packageDurationMin) || 60;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  // Step 1: create the calendar event
  let calEventId = null;
  try {
    calEventId = await createCalendarEvent({ payload, start, end });
  } catch (err) {
    console.error("[book] calendar event create failed:", err);
    return jsonError(
      502,
      "Couldn't reach Wendy's calendar. Email wendy@wendypix.com and we'll set this up manually."
    );
  }

  // Step 2: send emails (best-effort — booking is still considered
  // successful even if email send fails)
  const emailResults = await sendEmails({ payload, start, calEventId });

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      ok: true,
      bookingId: calEventId,
      emailedClient: emailResults.client,
      emailedWendy: emailResults.wendy,
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
    }),
  };
};

// ----------------------------------------------------------
// Microsoft Graph: create a tentative event in Wendy's calendar.
// ----------------------------------------------------------
async function createCalendarEvent({ payload, start, end }) {
  const subject = `WendyPix: ${payload.packageName} — ${payload.name}`;
  const body = [
    `BOOKING REQUEST (tentative — confirm or decline)`,
    ``,
    `Package: ${payload.packageName}` + (payload.packagePrice ? ` ($${payload.packagePrice})` : ""),
    `Duration: ${payload.packageDurationMin || "?"} min`,
    ``,
    `Client: ${payload.name}`,
    `Email:  ${payload.email}`,
    payload.phone ? `Phone:  ${payload.phone}` : null,
    payload.looks ? `Looks:  ${payload.looks}` : null,
    payload.hmua ? `Hair & makeup: yes (+$200)` : null,
    payload.notes ? `\nNotes:\n${payload.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const eventBody = {
    subject,
    body: { contentType: "text", content: body },
    start: {
      dateTime: start.toISOString().replace("Z", ""),
      timeZone: "UTC",
    },
    end: {
      dateTime: end.toISOString().replace("Z", ""),
      timeZone: "UTC",
    },
    showAs: "tentative",
    isReminderOn: true,
    reminderMinutesBeforeStart: 60,
    categories: ["WendyPix Booking"],
    transactionId: `wendypix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  const res = await graphFetch("/me/events", {
    method: "POST",
    body: JSON.stringify(eventBody),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`createEvent ${res.status}: ${txt.slice(0, 300)}`);
  }
  const created = await res.json();
  return created.id;
}

// ----------------------------------------------------------
// Resend: send confirmation to client + notification to Wendy.
// Both gated on RESEND_API_KEY. Best-effort — booking is still
// considered successful even if these fail.
// ----------------------------------------------------------
async function sendEmails({ payload, start, calEventId }) {
  const result = { client: false, wendy: false };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return result;

  const startStr = start.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });

  // Client email
  try {
    await resendSend(apiKey, {
      from: "Wendy Shapero <wendy@wendypix.com>",
      to: [payload.email],
      subject: `Booking request received — ${payload.packageName}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <p style="font-size:18px;font-weight:700">Hi ${escapeHtml(payload.name.split(" ")[0])},</p>
          <p>Got your booking request — here's what I have:</p>
          <p style="background:#f1ece2;border-left:4px solid #b347b9;padding:14px 18px;margin:18px 0">
            <strong>${escapeHtml(payload.packageName)}</strong><br/>
            ${escapeHtml(startStr)}
          </p>
          <p>I'll confirm this within 24 hours and send the deposit instructions
          (50% non-refundable retainer to hold the date).
          The slot is held tentatively for you in the meantime.</p>
          <p>Anything I should know in advance? Just reply to this email.</p>
          <p style="margin-top:32px">— Wendy<br/>
          <a href="https://wendypix.com" style="color:#b347b9">wendypix.com</a></p>
        </div>
      `,
    });
    result.client = true;
  } catch (e) {
    console.error("[book] client email failed:", e.message);
  }

  // Wendy notification
  try {
    await resendSend(apiKey, {
      from: "WendyPix Bookings <wendy@wendypix.com>",
      to: [WENDY_EMAIL],
      reply_to: payload.email,
      subject: `New booking: ${payload.packageName} — ${payload.name}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px">
          <h2 style="margin:0 0 12px">New booking request</h2>
          <p style="background:#f1ece2;padding:12px 16px;border-left:4px solid #b347b9">
            <strong>${escapeHtml(payload.packageName)}</strong>
            ${payload.packagePrice ? ` — $${payload.packagePrice}` : ""}<br/>
            ${escapeHtml(startStr)}
          </p>
          <p>
            <strong>${escapeHtml(payload.name)}</strong><br/>
            <a href="mailto:${encodeURIComponent(payload.email)}">${escapeHtml(payload.email)}</a>
            ${payload.phone ? `<br/>${escapeHtml(payload.phone)}` : ""}
          </p>
          <p>
            ${payload.looks ? `Looks: ${escapeHtml(String(payload.looks))}<br/>` : ""}
            ${payload.hmua ? `<strong>+ Hair &amp; makeup ($200)</strong><br/>` : ""}
          </p>
          ${payload.notes ? `<p><strong>Notes</strong><br/>${escapeHtml(payload.notes).replace(/\n/g, "<br/>")}</p>` : ""}
          <p style="margin-top:24px;font-size:13px;color:#666">
            Tentative event added to your calendar. Confirm or decline manually,
            then send the client deposit instructions.
            Calendar event id: <code>${escapeHtml(calEventId)}</code>
          </p>
        </div>
      `,
    });
    result.wendy = true;
  } catch (e) {
    console.error("[book] wendy email failed:", e.message);
  }

  return result;
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

function jsonError(code, msg) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: msg }),
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
