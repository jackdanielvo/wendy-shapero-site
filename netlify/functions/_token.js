// Tiny signed-token helper used for Wendy's one-click Confirm / Decline
// links in her notification emails. The links carry an HMAC over the
// event id + action + expiry so even if someone guesses the URL shape
// they can't forge a valid token. Wendy never sees the token — it's
// just URL-encoded inside the buttons we email her.

const crypto = require("crypto");

function getSecret() {
  const s = process.env.CONFIRM_SECRET;
  if (!s) {
    throw new Error(
      "CONFIRM_SECRET env var missing. Set it in Netlify → Project " +
      "configuration → Environment variables. Any random 32+ char string."
    );
  }
  return s;
}

// Build a signed token for (eventId, action). Includes a 7-day expiry
// so stale links can't be used long after Wendy ignored them.
function sign({ eventId, action, ttlSec = 7 * 24 * 3600 }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${eventId}|${action}|${exp}`;
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  // We URL-encode the eventId because it contains slashes and equals
  // signs that confuse query parsers.
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

// Verify and return {eventId, action} if valid; null otherwise.
function verify(token) {
  let raw;
  try {
    raw = Buffer.from(token, "base64url").toString();
  } catch {
    return null;
  }
  const parts = raw.split("|");
  if (parts.length !== 4) return null;
  const [eventId, action, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(`${eventId}|${action}|${exp}`)
    .digest("base64url");

  // Constant-time comparison
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return { eventId, action };
}

module.exports = { sign, verify };
