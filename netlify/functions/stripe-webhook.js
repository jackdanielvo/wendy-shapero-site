// Stripe webhook handler. Stripe POSTs here when a checkout completes.
// We verify the signature, look up the booking metadata, flip the
// calendar event from tentative → busy, and send "you're booked" /
// "new paid booking" emails.
//
// Webhook URL to register in Stripe dashboard:
//   https://wendypix.netlify.app/.netlify/functions/stripe-webhook
//   (or via the /api alias: /api/stripe-webhook)
//
// Subscribe to event types: checkout.session.completed
//
// Set STRIPE_WEBHOOK_SECRET (from Stripe's webhook detail page) in
// Netlify env vars so we can verify request signatures.

const { graphFetch } = require("./_msgraph");
const { verifyWebhookSignature } = require("./_stripe");
const { getBookingsStore } = require("./_blobs");
const { sendPrepEmail } = require("./_prep");
const tpl = require("./_email");

const WENDY_EMAIL = "wendy@wendypix.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const sigHeader = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET env var missing");
    return { statusCode: 500, body: "Webhook secret not configured" };
  }
  // Netlify decodes the body to a string by default; signature
  // verification needs the EXACT raw body Stripe sent.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  if (!verifyWebhookSignature(rawBody, sigHeader, secret)) {
    console.warn("[stripe-webhook] Bad signature");
    return { statusCode: 400, body: "Bad signature" };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // We care about completed checkouts. Stripe also sends related events
  // (checkout.session.expired, payment_intent.succeeded, etc.) but for
  // this flow only checkout.session.completed needs action.
  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: `Ignoring ${stripeEvent.type}` };
  }

  const session = stripeEvent.data.object;
  const md = session.metadata || {};
  const eventId = md.eventId;
  if (!eventId) {
    console.warn("[stripe-webhook] session has no eventId in metadata");
    return { statusCode: 200, body: "No eventId" };
  }

  // Flip the calendar event from tentative → busy
  try {
    const res = await graphFetch(`/me/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        showAs: "busy",
        // Mark with ✓ so it's visually distinct from unconfirmed bookings
        // in Wendy's calendar
        subject: `WendyPix ✓ ${md.packageName || "Booking"} — ${md.name || ""}`.trim(),
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[stripe-webhook] event PATCH failed:", res.status, txt.slice(0, 200));
    }
  } catch (e) {
    console.error("[stripe-webhook] event PATCH threw:", e.message);
  }

  // Update bookings blob with payment info
  try {
    const store = getBookingsStore();
    const meta = (await store.get(`booking/${eventId}`, { type: "json" })) || {};
    await store.setJSON(`booking/${eventId}`, {
      ...meta,
      paid: true,
      paidAt: new Date().toISOString(),
      stripeSessionId: session.id,
      stripePaymentIntent: session.payment_intent,
      depositCents: session.amount_total,
    });
  } catch (e) {
    console.error("[stripe-webhook] blob update failed:", e.message);
  }

  // Emails — confirmation to client, notification to Wendy, plus a
  // delayed prep-guide email to the client (Resend `scheduled_at`
  // handles the ~10-minute delay so the prep email lands AFTER the
  // confirmation, not stapled to it).
  await Promise.all([
    sendClientConfirmation(md, session).catch((e) =>
      console.error("[stripe-webhook] client email failed:", e.message)
    ),
    sendWendyNotification(md, session).catch((e) =>
      console.error("[stripe-webhook] Wendy email failed:", e.message)
    ),
    md.email
      ? sendPrepEmail({
          to: md.email,
          name: md.name,
          packageName: md.packageName,
        }).catch((e) =>
          console.error("[stripe-webhook] prep email failed:", e.message)
        )
      : Promise.resolve(),
  ]);

  return { statusCode: 200, body: "ok" };
};

async function sendClientConfirmation(md, session) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const start = md.slotStart ? new Date(md.slotStart) : null;
  const startStr = tpl.formatDate(start);
  const firstName = (md.name || "there").split(" ")[0];
  const depositDollars = (session.amount_total / 100).toFixed(0);

  const body =
    tpl.eyebrow("Confirmed & paid") +
    tpl.headline("You're in.") +
    tpl.paragraph(`Hey <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
    tpl.paragraph("Deposit received and your session is locked in:") +
    tpl.callout(
      `${tpl.escapeHtml(md.packageName || "Session")}<br/>` +
      `<span style="font-weight:600;opacity:0.95;">${tpl.escapeHtml(startStr)}</span><br/>` +
      `<span style="font-size:15px;font-weight:600;opacity:0.85;letter-spacing:0.06em;text-transform:uppercase;">Deposit paid &middot; $${depositDollars}</span>`
    ) +
    tpl.paragraph(
      "I'll reach out shortly with pre-shoot details — what to bring, " +
      "where to meet, what to wear. The remaining balance is due 24 hours " +
      "before the session."
    ) +
    tpl.paragraph(
      "Reply anytime if you have questions or need to reschedule " +
      "(14 days&rsquo; notice required, see the rate card)."
    ) +
    tpl.signoff("&mdash; Wendy");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Wendy Shapero <wendy@wendypix.com>",
      to: [md.email],
      subject: `Your ${md.packageName} is confirmed — ${startStr}`,
      html: tpl.wrap({ preheader: `Locked in. Deposit received.`, body }),
    }),
  }).then((r) => { if (!r.ok) throw new Error("Resend client " + r.status); });
}

async function sendWendyNotification(md, session) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const start = md.slotStart ? new Date(md.slotStart) : null;
  const startStr = tpl.formatDate(start);
  const depositDollars = (session.amount_total / 100).toFixed(0);
  const fullPrice = md.packagePrice ? `$${md.packagePrice}` : "—";

  const body =
    tpl.eyebrow("New paid booking") +
    tpl.headline("Locked in.") +
    tpl.callout(
      `<strong>${tpl.escapeHtml(md.packageName || "Booking")}</strong>` +
      ` &middot; ${fullPrice} (deposit paid: $${depositDollars})<br/>` +
      tpl.escapeHtml(startStr)
    ) +
    tpl.paragraph(
      `<strong>${tpl.escapeHtml(md.name || "")}</strong><br/>` +
      `<a href="mailto:${encodeURIComponent(md.email || "")}" style="color:${tpl.COLORS.PLUM};">${tpl.escapeHtml(md.email || "")}</a>` +
      (md.phone ? `<br/>${tpl.escapeHtml(md.phone)}` : "")
    ) +
    tpl.paragraph(
      "Calendar event flipped from tentative to confirmed. Stripe payment " +
      `intent: <code>${tpl.escapeHtml(session.payment_intent || "")}</code>.`
    ) +
    tpl.fineprint(
      "If you need to cancel and refund, do it from the Stripe dashboard — " +
      "the calendar event will need to be deleted manually too."
    );

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "WendyPix Bookings <wendy@wendypix.com>",
      to: [WENDY_EMAIL],
      reply_to: md.email,
      subject: `New paid booking: ${md.packageName} — ${md.name}`,
      html: tpl.wrap({
        preheader: `${md.name} paid $${depositDollars} for ${md.packageName}`,
        body,
        showHomeLink: false,
      }),
    }),
  }).then((r) => { if (!r.ok) throw new Error("Resend wendy " + r.status); });
}
