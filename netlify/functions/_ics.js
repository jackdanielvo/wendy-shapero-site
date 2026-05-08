// iCalendar (.ics) generator for booking confirmations.
//
// Produces an RFC 5545 VEVENT that opens cleanly in Apple Calendar,
// Google Calendar, Outlook, and Fantastical so clients can add the
// session to their calendar with one click instead of re-typing it.
//
// We attach this to the confirmation email (Stripe path AND manual-
// confirm path). Resend wants attachments as base64-encoded bytes,
// so the helper exposes a `toBase64()` convenience too.
//
// What we DON'T do here:
//   * VTIMEZONE blocks — we emit DTSTART/DTEND in UTC (Z suffix),
//     which every client interprets correctly. VTIMEZONE is finicky
//     to author by hand and almost no client cares as long as the
//     timestamp is unambiguous.
//   * RSVP / METHOD:REQUEST — that's for "invite-and-track-yes/no"
//     flows. We're not asking the client to accept; the booking is
//     already confirmed. METHOD:PUBLISH means "informational, save it
//     if you want", which is exactly the right semantic.

/**
 * Build an iCalendar VCALENDAR + VEVENT string.
 *
 * @param {object} opts
 * @param {string} opts.uid          — globally-unique identifier for the event
 *                                     (use the calendar event id from Outlook)
 * @param {string} opts.title        — SUMMARY line, e.g. "WendyPix — Standard Headshot"
 * @param {string} [opts.description] — DESCRIPTION (optional, multi-line allowed)
 * @param {string} [opts.location]   — LOCATION (optional)
 * @param {Date}   opts.start        — session start
 * @param {Date}   opts.end          — session end
 * @param {string} [opts.organizerName]
 * @param {string} [opts.organizerEmail]
 * @param {string} [opts.attendeeName]
 * @param {string} [opts.attendeeEmail]
 * @returns {string} the .ics content (CRLF line endings)
 */
function buildIcs({
  uid,
  title,
  description,
  location,
  start,
  end,
  organizerName,
  organizerEmail,
  attendeeName,
  attendeeEmail,
}) {
  if (!uid) throw new Error("ics: uid required");
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new Error("ics: valid start required");
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw new Error("ics: valid end required");
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WendyPix//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUTC(new Date())}`,
    `DTSTART:${formatUTC(start)}`,
    `DTEND:${formatUTC(end)}`,
    `SUMMARY:${escapeText(title || "WendyPix Session")}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    location ? `LOCATION:${escapeText(location)}` : null,
    organizerEmail
      ? `ORGANIZER;CN=${escapeText(organizerName || "")}:mailto:${organizerEmail}`
      : null,
    attendeeEmail
      ? `ATTENDEE;CN=${escapeText(attendeeName || "")};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${attendeeEmail}`
      : null,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  // Apply RFC 5545 line folding — content lines > 75 octets must be
  // wrapped with CRLF + leading-space continuation. Most clients will
  // also accept un-folded long lines, but folding is correct.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/**
 * Convenience — return the ics content as base64, ready to drop into
 * Resend's `attachments[].content` field.
 */
function toBase64(ics) {
  return Buffer.from(ics, "utf8").toString("base64");
}

// ------------- helpers -------------

function pad2(n) { return String(n).padStart(2, "0"); }

// Format a Date as RFC 5545 "DATE-TIME" in UTC: YYYYMMDDTHHMMSSZ
function formatUTC(d) {
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

// Escape SUMMARY/DESCRIPTION/LOCATION content per RFC 5545:
//   backslash → \\, comma → \,, semicolon → \;, newline → \n
function escapeText(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// Fold lines longer than 75 octets at column 75, continuation lines
// start with a single space. Counts in BYTES, not characters, since
// the spec is octet-based.
function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const chunks = [];
  let i = 0;
  while (i < bytes.length) {
    const end = Math.min(i + (i === 0 ? 75 : 74), bytes.length);
    chunks.push(bytes.slice(i, end).toString("utf8"));
    i = end;
  }
  return chunks.join("\r\n ");
}

module.exports = { buildIcs, toBase64 };
