// Receives a booking submission from /book. In production this:
//   1. Validates the slot is still open (re-reads Wendy's Google
//      Calendar — guard against two clients racing for the same time)
//   2. Creates a TENTATIVE Google Calendar event in Wendy's calendar
//      with the client's details in the description
//   3. Sends a notification email to Wendy with Confirm / Decline links
//   4. Sends a "request received" email to the client
//   5. (If Stripe is configured) starts a Stripe Checkout session for
//      the 50% deposit and returns the redirect URL
//
// PHASE 1 STUB: validates input shape, logs the booking, returns
// success without actually writing to Calendar or sending emails.
// Filled out in Phase 1.5 once Resend + Google Calendar credentials
// are available in env vars.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  // Validate required fields
  const required = ["packageId", "packageName", "slotStart", "name", "email"];
  for (const k of required) {
    if (!payload[k]) return jsonError(400, `Missing field: ${k}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return jsonError(400, "Invalid email");
  }

  // ----------------------------------------------------------
  // PHASE 1 STUB. Wire up these calls when env vars are present:
  //   - Google Calendar create event (TENTATIVE) → eventId
  //   - Resend send-to-client (request received) → messageId
  //   - Resend send-to-Wendy (with Confirm / Decline links) → messageId
  //   - Stripe Checkout session create (if STRIPE_SECRET_KEY set) → checkoutUrl
  // ----------------------------------------------------------
  console.log("[book] received:", {
    package: payload.packageName,
    slotStart: payload.slotStart,
    client: payload.email,
  });

  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
  const calendarEnabled = Boolean(process.env.GCAL_REFRESH_TOKEN);
  const resendEnabled = Boolean(process.env.RESEND_API_KEY);

  // If Stripe is configured, we'd return a checkoutUrl for the
  // frontend to redirect to. For now return a flat success.
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      ok: true,
      bookingId: stubId(),
      // Diagnostics so we know what the live env can/can't do yet:
      mock: !(calendarEnabled && resendEnabled),
      stripeEnabled,
      calendarEnabled,
      resendEnabled,
    }),
  };
};

function jsonError(code, msg) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: msg }),
  };
}

function stubId() {
  return "bk_" + Math.random().toString(36).slice(2, 10);
}
