// Admin endpoint: list of upcoming bookings.
//
// Reads from the bookings blob store (one JSON blob per booking,
// keyed by `booking/<eventId>`). For each upcoming booking, also
// looks up the matching Outlook calendar event to report current
// status (tentative = awaiting Wendy's decision, busy = confirmed).

const { getBookingsStore } = require("./_blobs");
const { graphFetch } = require("./_msgraph");
const { requireAuth } = require("./_auth");

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const store = getBookingsStore();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000); // include the last 24h too

  // List all booking blobs. Netlify Blobs paginates; for our scale
  // (one photographer's bookings) the first page is plenty.
  let bookings = [];
  try {
    const list = await store.list({ prefix: "booking/" });
    for (const blob of list.blobs || []) {
      const data = await store.get(blob.key, { type: "json" });
      if (!data || !data.slotStart) continue;
      if (new Date(data.slotStart) < cutoff) continue;
      bookings.push(data);
    }
  } catch (e) {
    console.warn("[admin-bookings] list failed:", e.message);
    return json(500, { error: "Couldn't list bookings: " + e.message });
  }

  // Sort upcoming first
  bookings.sort((a, b) => new Date(a.slotStart) - new Date(b.slotStart));

  // Look up each event's current status from Outlook (parallel)
  const enriched = await Promise.all(
    bookings.map(async (b) => {
      let status = "unknown";
      let outlookSubject = null;
      try {
        const res = await graphFetch(`/me/events/${encodeURIComponent(b.eventId)}?$select=showAs,subject`);
        if (res.ok) {
          const ev = await res.json();
          status = (ev.showAs || "").toLowerCase() || "unknown";
          outlookSubject = ev.subject || null;
        } else if (res.status === 404) {
          status = "deleted";
        }
      } catch (e) {
        console.warn("[admin-bookings] event lookup failed for", b.eventId, e.message);
      }
      return { ...b, status, outlookSubject };
    })
  );

  return json(200, { bookings: enriched, generatedAt: new Date().toISOString() });
};

function json(code, payload) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}
