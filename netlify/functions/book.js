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
const { sign } = require("./_token");
const { getBookingsStore } = require("./_blobs");
const tpl = require("./_email");

const TIMEZONE_LABEL = "Pacific Standard Time"; // for Outlook event
const WENDY_EMAIL = "wendy@wendypix.com";

// Where the confirm/decline buttons in Wendy's email link back to.
// Falls back to the Netlify site URL if a custom domain isn't set yet.
const SITE_URL =
  process.env.URL || "https://wendypix.netlify.app";

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

  // Step 2: store booking metadata keyed by event id. Confirm/Decline
  // read this to get the client email — much more reliable than
  // parsing it back out of the Outlook event body (Outlook reformats
  // bodies into HTML which breaks plain-text regex extraction).
  try {
    const store = getBookingsStore();
    await store.setJSON(`booking/${calEventId}`, {
      eventId: calEventId,
      name: payload.name,
      email: payload.email,
      phone: payload.phone || null,
      packageName: payload.packageName,
      packagePrice: payload.packagePrice || null,
      durationMin,
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      looks: payload.looks || null,
      hmua: Boolean(payload.hmua),
      notes: payload.notes || null,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    // Non-fatal — booking still works, just confirm/decline emails will fail
    console.error("[book] booking metadata blob write failed:", e.message);
  }

  // Step 3: send emails (best-effort — booking is still considered
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

  const startStr = tpl.formatDate(start);
  const firstName = payload.name.split(" ")[0];

  // Client email — branded with WendyPix shell
  try {
    const body =
      tpl.eyebrow("Booking request received") +
      tpl.headline("On hold.") +
      tpl.paragraph(`Hi <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
      tpl.paragraph("Got your booking request — here's what I have:") +
      tpl.callout(
        `<strong>${tpl.escapeHtml(payload.packageName)}</strong>` +
        (payload.packagePrice ? ` &middot; $${payload.packagePrice}` : "") +
        `<br/>${tpl.escapeHtml(startStr)}`
      ) +
      tpl.paragraph(
        "I'll confirm within 24 hours and send the deposit instructions " +
        "(50% non-refundable retainer to hold the date). The slot is " +
        "held tentatively for you in the meantime."
      ) +
      tpl.paragraph("Anything I should know in advance? Just reply to this email.") +
      tpl.paragraph("&mdash; Wendy");

    const sendResult = await resendSend(apiKey, {
      from: "Wendy Shapero <wendy@wendypix.com>",
      to: [payload.email],
      subject: `Booking request received — ${payload.packageName}`,
      html: tpl.wrap({
        preheader: `${payload.packageName} — ${startStr}`,
        body,
      }),
    });
    console.log("[book] client email sent:", sendResult && sendResult.id, "to:", payload.email);
    result.client = true;
  } catch (e) {
    console.error("[book] client email failed:", e.message, "to:", payload.email);
  }

  // Wendy notification — includes one-click Confirm / Decline buttons
  // that hit signed token endpoints. The token carries the calendar
  // event id + action + expiry, signed with CONFIRM_SECRET so a stray
  // URL guess can't fake a confirmation.
  try {
    let confirmUrl = "";
    let declineUrl = "";
    try {
      confirmUrl = `${SITE_URL}/api/confirm?t=${sign({ eventId: calEventId, action: "confirm" })}`;
      declineUrl = `${SITE_URL}/api/decline?t=${sign({ eventId: calEventId, action: "decline" })}`;
    } catch (e) {
      // CONFIRM_SECRET not set yet — skip the buttons rather than failing
      console.warn("[book] confirm token signing failed:", e.message);
    }

    const buttonsHtml = confirmUrl && declineUrl
      ? tpl.buttonRow([
          { href: confirmUrl, label: "Confirm booking", primary: true },
          { href: declineUrl, label: "Decline" },
        ]) +
        tpl.fineprint(
          "Confirm flips the calendar event from tentative to busy and emails the client. " +
          "Decline removes the event and sends a polite \"can't take this one\" note. " +
          "Links expire in 7 days."
        )
      : tpl.fineprint(
          "Tentative event added to your calendar — confirm or decline it " +
          "manually in Outlook for now. " +
          "Set <code>CONFIRM_SECRET</code> in Netlify env vars to enable one-click buttons."
        );

    const detailsLines = [
      `<strong>${tpl.escapeHtml(payload.name)}</strong>`,
      `<a href="mailto:${encodeURIComponent(payload.email)}" style="color:${tpl.COLORS.PLUM};">${tpl.escapeHtml(payload.email)}</a>`,
      payload.phone ? tpl.escapeHtml(payload.phone) : null,
    ].filter(Boolean).join("<br/>");

    const extras = [
      payload.looks ? `Looks: <strong>${tpl.escapeHtml(String(payload.looks))}</strong>` : null,
      payload.hmua ? `<strong>+ Hair &amp; makeup ($200)</strong>` : null,
    ].filter(Boolean).join("<br/>");

    const wendyBody =
      tpl.eyebrow("New booking request") +
      tpl.headline("Inquiry.") +
      tpl.callout(
        `<strong>${tpl.escapeHtml(payload.packageName)}</strong>` +
        (payload.packagePrice ? ` &middot; $${payload.packagePrice}` : "") +
        `<br/>${tpl.escapeHtml(startStr)}`
      ) +
      tpl.paragraph(detailsLines) +
      (extras ? tpl.paragraph(extras) : "") +
      (payload.notes
        ? tpl.paragraph(`<strong>Notes</strong><br/>${tpl.escapeHtml(payload.notes).replace(/\n/g, "<br/>")}`)
        : "") +
      buttonsHtml;

    await resendSend(apiKey, {
      from: "WendyPix Bookings <wendy@wendypix.com>",
      to: [WENDY_EMAIL],
      reply_to: payload.email,
      subject: `New booking: ${payload.packageName} — ${payload.name}`,
      html: tpl.wrap({
        preheader: `${payload.name} — ${payload.packageName} — ${startStr}`,
        body: wendyBody,
        showHomeLink: false, // internal email — no need for site link
      }),
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
