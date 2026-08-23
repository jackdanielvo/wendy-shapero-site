// Receives a booking submission from /book.
//
// Steps:
//   1. Validate input
//   2. Create a TENTATIVE event in Wendy's calendar via Microsoft Graph,
//      with the client's intake details in the description
//   3. (If RESEND_API_KEY is set) email the client a "request received"
//      confirmation, and email Wendy a notification with all details
//   4. (If STRIPE_SECRET_KEY is set) start a Stripe Checkout session
//      for the deposit (DEPOSIT_PERCENT below) and return the redirect URL

// Each integration is gated on its env var. Bookings still succeed
// without Resend/Stripe — they just produce fewer side effects (e.g.
// no auto-email) which Wendy can handle manually until those services
// are wired up.
//
// Deposit percentage is now stored in admin settings (editable from
// /admin → Settings) and fetched per-request via getSettings(). Falls
// back to the default (25%) if the blob has never been written.

const { graphFetch } = require("./_msgraph");
const { sign } = require("./_token");
const { getBookingsStore } = require("./_blobs");
const { getSettings } = require("./_settings");
const tpl = require("./_email");
const { createCheckoutSession } = require("./_stripe");
const {
  listCodes,
  normalizeCode,
  validateCode,
  applyDiscount,
  recordRedemption,
} = require("./_codes");
const { listAddons } = require("./_addons");

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

  // Discount code (optional). If supplied, revalidate SERVER-SIDE — the
  // frontend preview via /api/redeem-code is untrusted, and a stale
  // client tab could hold a code that's since expired or hit its
  // usage cap. The discount is applied to both the deposit AND the
  // remaining balance calculation via the effectivePrice below.
  let promo = null; // { code, percentOff, originalPrice, discountedPrice, discountApplied, record }
  const rawCode = normalizeCode(payload.promoCode);
  if (rawCode) {
    try {
      const codes = await listCodes();
      const record = codes.find((c) => c.code === rawCode);
      const check = validateCode(record);
      if (!check.valid) {
        return jsonError(400, `Promo code: ${check.reason}`);
      }
      const originalPrice = Number(payload.packagePrice) || 0;
      const { discountedPrice, discountApplied } = applyDiscount(originalPrice, record.percentOff);
      promo = {
        code: record.code,
        percentOff: record.percentOff,
        influencerName: record.influencerName,
        influencerEmail: record.influencerEmail,
        originalPrice,
        discountedPrice,
        discountApplied,
      };
    } catch (err) {
      console.warn("[book] promo lookup failed (proceeding without discount):", err.message);
      // Don't hard-fail the booking on a Blobs hiccup — clearer to
      // let it through at full price than to lose the booking.
    }
  }

  // Server-side add-ons resolution. The client sends an array of
  // add-on ids (e.g. ["hmua"]) — we look each one up in the addon
  // store to get the authoritative price. This closes the door on a
  // client sending a fake price via a manipulated payload.
  const addonsCharged = []; // [{ id, label, price }]
  let addonsTotal = 0;
  const requestedAddonIds = Array.isArray(payload.addons)
    ? payload.addons.map(String)
    : [];
  // Legacy: the old client sent `hmua: true` instead of addons array.
  // Honor that flag so existing bookings in flight don't lose HMUA.
  if (payload.hmua && !requestedAddonIds.includes("hmua")) {
    requestedAddonIds.push("hmua");
  }
  if (requestedAddonIds.length) {
    try {
      const allAddons = await listAddons();
      for (const id of requestedAddonIds) {
        const rec = allAddons.find((a) => a.id === id && a.bookable);
        if (rec) {
          const price = Number(rec.price) || 0;
          addonsCharged.push({ id: rec.id, label: rec.label, price });
          addonsTotal += price;
        } else {
          console.warn("[book] client requested unknown/non-bookable addon:", id);
        }
      }
    } catch (err) {
      console.warn("[book] addon lookup failed (ignoring addons):", err.message);
    }
  }

  // effectivePrice is what we actually charge and quote in emails.
  // Falls back to the raw packagePrice when there's no discount.
  // Add-ons are added AFTER the discount so the promo percentage applies
  // to the package only, not the add-ons. If Wendy wants add-ons to
  // also be discounted, flip these two lines around.
  const basePrice = promo ? promo.discountedPrice : (Number(payload.packagePrice) || 0);
  const effectivePrice = basePrice + addonsTotal;

  // Step 1a: conflict check. Prevents double-booking when two users
  // race for the same slot — e.g. user A submits and goes to Stripe,
  // user B (already on the booking page) clicks submit a second
  // later. Without this check, two overlapping tentative events would
  // both be created. The check is a narrow Graph query for any
  // busy/tentative/oof event overlapping [start, end). If the call
  // fails (Graph flaky), we fail soft — let the booking proceed
  // rather than block legitimate clients.
  try {
    const conflicts = await findConflicts(start, end);
    if (conflicts.length) {
      console.log("[book] slot conflict for", payload.email, "at", start.toISOString());
      return jsonError(
        409,
        "That slot was just taken. Please refresh and pick another time — sorry!"
      );
    }
  } catch (err) {
    console.warn("[book] conflict check failed (proceeding):", err.message);
  }

  // Step 1b: create the calendar event
  let calEventId = null;
  try {
    calEventId = await createCalendarEvent({ payload, start, end, addonsCharged });
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
      // effectivePrice is what the client actually pays (post-discount).
      // Keep both so admin views can show the sticker vs. paid amount.
      effectivePrice: effectivePrice || null,
      promo: promo
        ? {
            code: promo.code,
            percentOff: promo.percentOff,
            discountApplied: promo.discountApplied,
            influencerName: promo.influencerName,
            influencerEmail: promo.influencerEmail,
          }
        : null,
      durationMin,
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      looks: payload.looks || null,
      // hmua kept for backward compat (older confirmation emails read it)
      hmua: addonsCharged.some((a) => a.id === "hmua"),
      // New: full list of ticked add-ons with server-resolved prices
      addons: addonsCharged,
      addonsTotal,
      notes: payload.notes || null,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    // Non-fatal — booking still works, just confirm/decline emails will fail
    console.error("[book] booking metadata blob write failed:", e.message);
  }

  // Step 3: branch on whether Stripe is configured.
  //
  // STRIPE PATH: create a Checkout session for the deposit and
  //   return its URL — frontend redirects there. We DON'T send the
  //   "request received" / "new booking" emails here; the webhook
  //   sends "you're booked + paid" + Wendy notification on payment
  //   success. If client abandons checkout, the tentative calendar
  //   event sits there until the cleanup function deletes it.
  //
  // NON-STRIPE PATH (current default): send emails immediately so
  //   Wendy can manually confirm/decline + invoice deposit out-of-band.
  const settings = await getSettings();
  const depositPercent = settings.depositPercent;
  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
  if (stripeEnabled && payload.packagePrice && !payload.inquiry) {
    try {
      // Convert effectivePrice (post-discount USD) → deposit cents at the
      // configured percent. e.g. $850 × 25 = 21250 cents = $212.50.
      // If a promo code was applied, the discount cascades to the deposit
      // (25% of the DISCOUNTED total, not the sticker price) so the deal
      // the influencer promised is the deal the client actually gets.
      const depositCents = Math.round(effectivePrice * depositPercent);
      const session = await createCheckoutSession({
        packageName: payload.packageName + (promo ? ` — ${promo.percentOff}% off` : ""),
        amountCents: depositCents,
        depositLabel: `${depositPercent}% deposit`,
        customerEmail: payload.email,
        metadata: {
          eventId: calEventId,
          packageId: payload.packageId,
          packageName: payload.packageName,
          packagePrice: String(payload.packagePrice),
          effectivePrice: String(effectivePrice),
          slotStart: start.toISOString(),
          name: payload.name,
          email: payload.email,
          phone: payload.phone || "",
          promoCode: promo ? promo.code : "",
          promoPercentOff: promo ? String(promo.percentOff) : "",
        },
        successUrl: `${SITE_URL}/book-success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${SITE_URL}/book?canceled=1`,
      });

      // Mark the blob as in-checkout so the cleanup function can
      // release the slot quickly (~15 min) if the user abandons
      // Stripe — vs. waiting the full 24h that "manual confirm"
      // tentative bookings get. A short-lived hold keeps high-
      // demand slots from being dead-locked by abandoned checkouts.
      try {
        const store = getBookingsStore();
        const existing = (await store.get(`booking/${calEventId}`, { type: "json" })) || {};
        await store.setJSON(`booking/${calEventId}`, {
          ...existing,
          checkoutStartedAt: new Date().toISOString(),
          stripeSessionId: session.id,
        });
      } catch (e) {
        console.warn("[book] couldn't mark checkoutStartedAt:", e.message);
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: true, bookingId: calEventId, checkoutUrl: session.url }),
      };
    } catch (err) {
      console.error("[book] Stripe checkout creation failed:", err);
      return jsonError(502, "Couldn't start the deposit checkout. Email wendy@wendypix.com and we'll set this up manually.");
    }
  }

  // Non-Stripe path: send emails immediately + count the redemption
  // right now (no Stripe webhook to defer it to). On the Stripe path,
  // the webhook (stripe-webhook.js) records the redemption + notifies
  // Wendy after payment succeeds — so an abandoned checkout doesn't
  // burn a use.
  if (promo) {
    try {
      await recordRedemption(promo.code, {
        bookingId: calEventId,
        clientEmail: payload.email,
        clientName: payload.name,
        packageName: payload.packageName,
        packagePrice: promo.originalPrice,
        discountApplied: promo.discountApplied,
      });
    } catch (err) {
      console.warn("[book] recordRedemption failed:", err.message);
    }
    try {
      await sendRedemptionAlert({ promo, payload, start });
    } catch (err) {
      console.warn("[book] redemption alert failed:", err.message);
    }
  }
  const emailResults = await sendEmails({ payload, start, calEventId, depositPercent, promo, effectivePrice, addonsCharged });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      ok: true,
      bookingId: calEventId,
      emailedClient: emailResults.client,
      emailedWendy: emailResults.wendy,
      stripeEnabled: false,
    }),
  };
};

// ----------------------------------------------------------
// Microsoft Graph: query for any busy/tentative/oof events that
// overlap [start, end). Returns the array (may be empty). Used by
// the book handler to detect a slot conflict before creating a new
// tentative event — protects against simultaneous submits.
// ----------------------------------------------------------
async function findConflicts(start, end) {
  // Pad the window by 1 second so identical-timestamp edge cases get
  // caught without false positives on adjacent (but non-overlapping)
  // back-to-back sessions.
  const params = new URLSearchParams({
    startDateTime: new Date(start.getTime() - 1000).toISOString(),
    endDateTime: new Date(end.getTime() + 1000).toISOString(),
    $select: "id,start,end,showAs,subject",
    $top: "20",
  });
  const res = await graphFetch("/me/calendarView?" + params.toString(), {
    method: "GET",
    headers: { Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`calendarView ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const blocking = ["busy", "tentative", "oof"];
  return (data.value || [])
    .filter((ev) => blocking.includes((ev.showAs || "").toLowerCase()))
    .filter((ev) => {
      // Strict overlap: an event blocks our slot only if its window
      // intersects the requested [start, end). Adjacent events
      // (start = our end, or end = our start) are NOT a conflict.
      const evStart = new Date(ev.start.dateTime + (ev.start.dateTime.endsWith("Z") ? "" : "Z"));
      const evEnd = new Date(ev.end.dateTime + (ev.end.dateTime.endsWith("Z") ? "" : "Z"));
      return evStart < end && evEnd > start;
    });
}

// ----------------------------------------------------------
// Microsoft Graph: create a tentative event in Wendy's calendar.
// ----------------------------------------------------------
async function createCalendarEvent({ payload, start, end, addonsCharged }) {
  const subject = `WendyPix: ${payload.packageName} — ${payload.name}`;
  // Render each add-on on its own line with its authoritative price
  // (looked up server-side). If nothing was ticked, addonsLines is
  // empty and gets filtered out below.
  const addonsLines = (addonsCharged || []).map(
    (a) => `Add-on: ${a.label} (+$${a.price})`
  );
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
    ...addonsLines,
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
async function sendEmails({ payload, start, calEventId, depositPercent, promo, effectivePrice, addonsCharged }) {
  const result = { client: false, wendy: false };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return result;

  const startStr = tpl.formatDate(start);
  const firstName = payload.name.split(" ")[0];

  // Price string for the client callout — reflects the discount if any.
  const priceStr = promo
    ? ` <span style="opacity:0.85;"><s>$${payload.packagePrice}</s> &middot; <strong>$${effectivePrice}</strong> (${promo.percentOff}% off)</span>`
    : (payload.packagePrice ? ` <span style="opacity:0.85;">&middot; $${payload.packagePrice}</span>` : "");

  // Client email — branded with WendyPix shell
  try {
    const body =
      tpl.eyebrow("Booking request received") +
      tpl.headline("On hold.") +
      tpl.paragraph(`Hey <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
      tpl.paragraph("Got your request — here's what I have:") +
      tpl.callout(
        `${tpl.escapeHtml(payload.packageName)}` +
        priceStr +
        `<br/><span style="font-weight:600;opacity:0.95;">${tpl.escapeHtml(startStr)}</span>`
      ) +
      tpl.paragraph(
        `I'll confirm within 24 hours and send deposit instructions ` +
        `(${depositPercent}% non-refundable retainer to lock the date). Your slot is ` +
        `held for you in the meantime.`
      ) +
      tpl.paragraph("Anything I should know in advance? Just hit reply.") +
      tpl.signoff("&mdash; Wendy");

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
      `<a href="mailto:${encodeURIComponent(payload.email)}" style="color:${tpl.COLORS.TEAL};">${tpl.escapeHtml(payload.email)}</a>`,
      payload.phone ? tpl.escapeHtml(payload.phone) : null,
    ].filter(Boolean).join("<br/>");

    // Dynamic add-on lines (one per ticked add-on). Falls back to
    // empty when nothing's ticked so the extras block just shows Looks.
    // Uses the server-authoritative price from addonsCharged, not the
    // untrusted client payload.
    const addonLines = (addonsCharged || []).map(
      (a) =>
        `<strong>+ ${tpl.escapeHtml(a.label)} ($${a.price})</strong>`
    );
    const extras = [
      payload.looks ? `Looks: <strong>${tpl.escapeHtml(String(payload.looks))}</strong>` : null,
      ...addonLines,
    ].filter(Boolean).join("<br/>");

    // Promo-code line: bold if a code was used so it can't be missed
    // scanning the email. Includes the influencer name for context.
    const promoLine = promo
      ? `<br/><span style="color:#b347b9;font-weight:800;">${tpl.escapeHtml(promo.code)}</span>` +
        ` &middot; ${promo.percentOff}% off &middot; via ${tpl.escapeHtml(promo.influencerName)}`
      : "";
    const priceCalloutStr = promo
      ? ` &middot; <s>$${payload.packagePrice}</s> $${effectivePrice}`
      : (payload.packagePrice ? ` &middot; $${payload.packagePrice}` : "");

    const wendyBody =
      tpl.eyebrow("New booking request") +
      tpl.headline("Inquiry.") +
      tpl.callout(
        `<strong>${tpl.escapeHtml(payload.packageName)}</strong>` +
        priceCalloutStr +
        `<br/>${tpl.escapeHtml(startStr)}` +
        promoLine
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

// ----------------------------------------------------------
// Redemption alert — a dedicated "your code was just used" email to
// Wendy so she can track which influencers are driving bookings. Runs
// AFTER recordRedemption() so the "uses remaining" figure it reports
// is post-increment.
// ----------------------------------------------------------
async function sendRedemptionAlert({ promo, payload, start }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  // Re-read the code record so uses-remaining is fresh.
  let usesRemainingLine = "No usage cap set.";
  try {
    const codes = await listCodes();
    const rec = codes.find((c) => c.code === promo.code);
    if (rec && rec.maxUses != null) {
      const remaining = Math.max(0, rec.maxUses - rec.usedCount);
      usesRemainingLine =
        `<strong>${rec.usedCount}</strong> of ${rec.maxUses} uses claimed &middot; ` +
        `<strong>${remaining}</strong> remaining.`;
    } else if (rec) {
      usesRemainingLine = `<strong>${rec.usedCount}</strong> total uses to date &middot; no cap.`;
    }
  } catch (err) {
    console.warn("[book] redemption alert stats fetch failed:", err.message);
  }

  const startStr = tpl.formatDate(start);
  const body =
    tpl.eyebrow("Discount code used") +
    tpl.headline("Booking with a code.") +
    tpl.callout(
      `<span style="font-family:monospace;font-size:28px;letter-spacing:0.08em;">${tpl.escapeHtml(promo.code)}</span><br/>` +
      `<span style="opacity:0.9;">${promo.percentOff}% off &middot; via ${tpl.escapeHtml(promo.influencerName)}</span>`
    ) +
    tpl.paragraph(
      `<strong>${tpl.escapeHtml(payload.name)}</strong> ` +
      `(<a href="mailto:${encodeURIComponent(payload.email)}" style="color:${tpl.COLORS.TEAL};">` +
      tpl.escapeHtml(payload.email) +
      `</a>) just booked ${tpl.escapeHtml(payload.packageName)} on ` +
      `${tpl.escapeHtml(startStr)}.`
    ) +
    tpl.paragraph(
      `Sticker price: <s>$${payload.packagePrice}</s> &middot; ` +
      `They paid: <strong>$${promo.discountedPrice}</strong> ` +
      `(you gave up $${promo.discountApplied}).`
    ) +
    tpl.paragraph(usesRemainingLine) +
    tpl.fineprint(
      `You can see the full audit log for this code in Admin → Discounts.`
    );

  await resendSend(apiKey, {
    from: "WendyPix Bookings <wendy@wendypix.com>",
    to: [WENDY_EMAIL],
    subject: `Code ${promo.code} used — ${promo.influencerName} drove a booking`,
    html: tpl.wrap({
      preheader: `${promo.percentOff}% off &middot; ${payload.name} &middot; ${payload.packageName}`,
      body,
      showHomeLink: false,
    }),
  });
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
