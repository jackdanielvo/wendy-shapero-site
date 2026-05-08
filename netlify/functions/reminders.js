// 24-hour pre-session reminder emails.
//
// Runs as a Netlify Scheduled Function (hourly — see netlify.toml).
// Walks every booking blob and, for each confirmed session happening
// roughly 24 hours from now, sends a friendly "see you tomorrow"
// email — once. Tracks sent state in the blob's `reminderSentAt`
// field so subsequent ticks don't double-send.
//
// Why hourly with a 4-hour-wide window (22h–26h until session):
//   * Reliable against scheduled-function drift / one-off skipped runs
//     — if a tick is missed, the next tick still catches the booking
//     before it falls out of the window
//   * Tracking sent state in the blob means the wide window is safe
//   * Hourly is cheap (a single blob list + a few Graph reads per tick)
//
// What counts as "confirmed":
//   * paid: true (Stripe path completed)
//   * OR the matching Outlook event has showAs = "busy" (Wendy
//     manually confirmed, or it was confirmed via /api/confirm)
// Tentative or deleted events are skipped — we don't want to remind
// somebody about a session that hasn't been locked in.

const { graphFetch } = require("./_msgraph");
const { getBookingsStore } = require("./_blobs");
const tpl = require("./_email");

// Window of "hours until session" that triggers a reminder. 22..26 is
// 4 hours wide so a one-off missed cron tick still catches the booking.
const REMIND_MIN_HOURS = 22;
const REMIND_MAX_HOURS = 26;

exports.handler = async () => {
  const startedAt = Date.now();
  let sent = 0;
  let alreadyReminded = 0;
  let outsideWindow = 0;
  let notConfirmed = 0;
  let errors = 0;

  if (!process.env.RESEND_API_KEY) {
    console.warn("[reminders] RESEND_API_KEY missing — no-op");
    return json({ ok: false, reason: "no resend key" }, 200);
  }

  let store;
  try {
    store = getBookingsStore();
  } catch (e) {
    console.error("[reminders] couldn't open bookings store:", e.message);
    return json({ error: e.message }, 500);
  }

  let list;
  try {
    list = await store.list({ prefix: "booking/" });
  } catch (e) {
    console.error("[reminders] list failed:", e.message);
    return json({ error: e.message }, 500);
  }

  const now = Date.now();
  const minMs = REMIND_MIN_HOURS * 3600 * 1000;
  const maxMs = REMIND_MAX_HOURS * 3600 * 1000;

  for (const blob of list.blobs || []) {
    let data;
    try {
      data = await store.get(blob.key, { type: "json" });
    } catch (e) {
      console.warn("[reminders] read failed for", blob.key, e.message);
      errors++;
      continue;
    }
    if (!data || !data.email || !data.slotStart) continue;

    // Already reminded — skip
    if (data.reminderSentAt) {
      alreadyReminded++;
      continue;
    }

    // Time-until-session check
    const slotMs = new Date(data.slotStart).getTime();
    const delta = slotMs - now;
    if (delta < minMs || delta > maxMs) {
      outsideWindow++;
      continue;
    }

    // Confirm the booking is locked in. Stripe-paid bookings have
    // paid:true. Manual-confirmed bookings won't, but their Outlook
    // event will be busy. Tentative or deleted: skip.
    let confirmed = Boolean(data.paid);
    if (!confirmed) {
      try {
        const res = await graphFetch(
          `/me/events/${encodeURIComponent(data.eventId)}?$select=showAs`
        );
        if (res.ok) {
          const ev = await res.json();
          confirmed = (ev.showAs || "").toLowerCase() === "busy";
        } else if (res.status === 404) {
          // Event was deleted (declined or gone). Mark as reminded so
          // we don't keep checking, and move on.
          await store.setJSON(blob.key, {
            ...data,
            reminderSentAt: new Date().toISOString(),
            reminderSkipped: "event-gone",
          });
          notConfirmed++;
          continue;
        } else {
          console.warn("[reminders] event lookup failed:", res.status);
          errors++;
          continue;
        }
      } catch (e) {
        console.warn("[reminders] event lookup threw:", e.message);
        errors++;
        continue;
      }
    }
    if (!confirmed) {
      notConfirmed++;
      continue;
    }

    // Send + mark
    try {
      await sendReminderEmail(data);
      await store.setJSON(blob.key, {
        ...data,
        reminderSentAt: new Date().toISOString(),
      });
      sent++;
      console.log("[reminders] sent to:", data.email, "for", data.slotStart);
    } catch (e) {
      console.error("[reminders] send failed:", e.message, "to:", data.email);
      errors++;
      // Don't mark as sent — try again on next tick
    }
  }

  const summary = {
    sent,
    alreadyReminded,
    outsideWindow,
    notConfirmed,
    errors,
    durationMs: Date.now() - startedAt,
    ts: new Date().toISOString(),
  };
  console.log("[reminders] done", summary);
  return json(summary, 200);
};

// -----------------------------------------------------------
// EMAIL — branded reminder using the shared _email.js helpers.
// -----------------------------------------------------------
async function sendReminderEmail(meta) {
  const apiKey = process.env.RESEND_API_KEY;
  const start = new Date(meta.slotStart);
  const startStr = tpl.formatDate(start); // includes LA tz
  const firstName = (meta.name || "there").split(" ")[0];
  const packageName = meta.packageName || "your session";

  // Hours-until — readable form for the email body. We're firing on a
  // 22-26 hour window so "tomorrow" is right far more often than not.
  const hoursUntil = Math.round((start.getTime() - Date.now()) / 3600000);

  const body =
    tpl.eyebrow("Tomorrow's the day") +
    tpl.headline("See you soon.") +
    tpl.paragraph(`Hey <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
    tpl.paragraph(
      `Quick reminder — your <strong>${tpl.escapeHtml(packageName)}</strong> ` +
      `session is coming up in about ${hoursUntil} hours.`
    ) +
    tpl.callout(
      `${tpl.escapeHtml(packageName)}<br/>` +
      `<span style="font-weight:600;opacity:0.95;">${tpl.escapeHtml(startStr)}</span>`
    ) +
    tpl.paragraph(
      `A few last-minute things:`
    ) +
    tpl.paragraph(
      `&bull; Iron or steam your wardrobe tonight if you haven't.<br/>` +
      `&bull; Bring your full set of options — we'll edit down on the day.<br/>` +
      `&bull; Outfits on hangers, accessories in bags, makes look-changes faster.<br/>` +
      `&bull; Get a good night's sleep and arrive a few minutes early.`
    ) +
    tpl.softCallout(
      `Need to reschedule or have a question? Just reply to this email or ` +
      `text <strong>818.383.0102</strong> — I'll see it right away.`
    ) +
    tpl.paragraph(`Looking forward to it.`) +
    tpl.signoff("&mdash; Wendy");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Wendy Shapero <wendy@wendypix.com>",
      to: [meta.email],
      subject: `Reminder — your ${packageName} is tomorrow (${shortDate(start)})`,
      html: tpl.wrap({
        preheader: `${packageName} — ${startStr}`,
        body,
      }),
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`resend ${res.status}: ${txt.slice(0, 200)}`);
  }
}

// e.g. "Fri, May 8" in LA time — for the email subject line
function shortDate(d) {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function json(body, code) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
