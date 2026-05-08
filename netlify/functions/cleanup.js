// Hourly auto-cleanup of stale tentative bookings.
//
// Runs as a Netlify Scheduled Function (see netlify.toml schedule).
// Walks every booking blob, and for each:
//
//   * If the booking has been marked paid (Stripe path completed),
//     leave it alone — the calendar event is already busy and it's
//     none of our business.
//   * If the booking is younger than 24 hours, leave it alone —
//     Wendy may still confirm/decline manually, or the client may
//     still be in checkout.
//   * Otherwise look up the matching Outlook event:
//       - if it's TENTATIVE (Wendy never confirmed, no payment): delete
//         the event AND the blob — the slot frees up for other bookers
//       - if it's BUSY (already confirmed): leave alone
//       - if it's already gone (404): clean up the orphan blob
//
// Idempotent — safe to run repeatedly. Returns a small JSON summary
// for log inspection.

const { graphFetch } = require("./_msgraph");
const { getBookingsStore } = require("./_blobs");

// "Stale" age cutoffs for releasing tentative slots:
//   * Manual-confirm path: Wendy might take a day to click Confirm,
//     so we wait 24h before reclaiming the slot.
//   * Stripe checkout path (checkoutStartedAt set): a real user
//     deciding on a card decides in <5 min. If they're 15+ min in
//     and haven't paid, treat it as abandoned and release the slot
//     so other clients can book it. Stripe sessions auto-expire
//     after 24h on Stripe's side, so the upper bound is enforced
//     either way — this just makes it faster.
const STALE_AGE_MS = 24 * 3600 * 1000;
const CHECKOUT_STALE_MS = 15 * 60 * 1000;

exports.handler = async () => {
  const startedAt = Date.now();
  let deleted = 0;
  let orphansCleaned = 0;
  let stillFresh = 0;
  let alreadyConfirmed = 0;
  let errors = 0;

  let store;
  try {
    store = getBookingsStore();
  } catch (e) {
    console.error("[cleanup] couldn't open bookings store:", e.message);
    return jsonResponse({ error: e.message }, 500);
  }

  let list;
  try {
    list = await store.list({ prefix: "booking/" });
  } catch (e) {
    console.error("[cleanup] list failed:", e.message);
    return jsonResponse({ error: e.message }, 500);
  }

  for (const blob of list.blobs || []) {
    let data;
    try {
      data = await store.get(blob.key, { type: "json" });
    } catch (e) {
      console.warn("[cleanup] read failed for", blob.key, e.message);
      errors++;
      continue;
    }
    if (!data) continue;

    // Skip paid bookings — Stripe path completed, calendar event is
    // already busy and confirmed.
    if (data.paid) {
      alreadyConfirmed++;
      continue;
    }

    // Decide which staleness threshold applies.
    //   * If the booking is in active checkout (checkoutStartedAt set
    //     AND not paid), use the SHORT 15-min threshold — abandoned
    //     Stripe checkouts shouldn't dead-lock a slot for 24 hours.
    //   * Otherwise use the regular 24h threshold for manual-confirm
    //     bookings Wendy hasn't gotten to yet.
    const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;
    const checkoutStartedAt = data.checkoutStartedAt
      ? new Date(data.checkoutStartedAt).getTime()
      : 0;
    let stale;
    if (checkoutStartedAt) {
      stale = startedAt - checkoutStartedAt > CHECKOUT_STALE_MS;
    } else if (createdAt) {
      stale = startedAt - createdAt > STALE_AGE_MS;
    } else {
      stale = false; // missing both timestamps — leave alone
    }
    if (!stale) {
      stillFresh++;
      continue;
    }

    // Inspect the matching Outlook event
    let showAs = null;
    let calStatus = "unknown";
    try {
      const res = await graphFetch(
        `/me/events/${encodeURIComponent(data.eventId)}?$select=showAs`
      );
      if (res.ok) {
        const ev = await res.json();
        showAs = (ev.showAs || "").toLowerCase();
        calStatus = "found";
      } else if (res.status === 404) {
        calStatus = "gone";
      } else {
        const txt = await res.text();
        console.warn("[cleanup] event lookup failed:", res.status, txt.slice(0, 200));
        errors++;
        continue;
      }
    } catch (e) {
      console.warn("[cleanup] event lookup threw:", e.message);
      errors++;
      continue;
    }

    if (calStatus === "gone") {
      // Calendar event was deleted (probably by Wendy in Outlook), but
      // the blob is still hanging around. Clean it up.
      try {
        await store.delete(blob.key);
        orphansCleaned++;
      } catch (e) {
        console.warn("[cleanup] orphan blob delete failed:", e.message);
        errors++;
      }
      continue;
    }

    if (showAs !== "tentative") {
      // Wendy already confirmed (or transitioned to something else). Leave alone.
      alreadyConfirmed++;
      continue;
    }

    // It's a tentative event older than 24 hours and unpaid. Delete it.
    try {
      const delRes = await graphFetch(
        `/me/events/${encodeURIComponent(data.eventId)}`,
        { method: "DELETE" }
      );
      if (!delRes.ok && delRes.status !== 404) {
        const txt = await delRes.text();
        console.warn("[cleanup] event DELETE failed:", delRes.status, txt.slice(0, 200));
        errors++;
        continue;
      }
      await store.delete(blob.key);
      deleted++;
      console.log("[cleanup] removed stale tentative:", data.eventId, data.email);
    } catch (e) {
      console.error("[cleanup] delete threw:", e.message);
      errors++;
    }
  }

  const summary = {
    deletedStale: deleted,
    orphansCleaned,
    stillFresh,
    alreadyConfirmed,
    errors,
    durationMs: Date.now() - startedAt,
    ts: new Date().toISOString(),
  };
  console.log("[cleanup] done", summary);
  return jsonResponse(summary, 200);
};

function jsonResponse(body, code) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
