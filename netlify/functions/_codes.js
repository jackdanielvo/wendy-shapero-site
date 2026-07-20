// Shared helpers for the discount-codes feature.
//
// Codes are stored as a single JSON array in the wendypix-config blob
// store under the key "discount-codes". A single blob keeps writes
// atomic (list → mutate → write) and simple to reason about since the
// list is small (dozens of codes at most, not millions).
//
// Data shape per code:
// {
//   code: "KX7R2P9",             // uppercase alphanumeric, unique
//   percentOff: 20,              // 1-100
//   influencerName: "Sarah Doe",
//   influencerEmail: "sarah@example.com",
//   expiresAt: "2026-12-31",     // ISO date string, or null (no expiry)
//   maxUses: 30,                 // integer, or null (unlimited)
//   usedCount: 0,
//   redemptions: [               // audit log — most recent last
//     {
//       at: "...",               // ISO
//       bookingId: "...",        // calendar event id
//       clientEmail: "...",
//       clientName: "...",
//       packageName: "...",
//       packagePrice: 850,
//       discountApplied: 170,    // dollars off
//     }
//   ],
//   active: true,                // Wendy can deactivate without deleting
//   createdAt: "..."
// }

const { getConfigStore } = require("./_blobs");

const STORE_KEY = "discount-codes";

// Alphabet for auto-generated codes — omits 0/O and 1/I/L so influencers
// can read them aloud without ambiguity. Also skips U/V pairs that get
// confused in some sans-serif fonts.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
const CODE_LENGTH = 7;

async function listCodes() {
  const store = getConfigStore();
  const stored = await store.get(STORE_KEY, { type: "json" });
  return Array.isArray(stored) ? stored : [];
}

async function saveCodes(codes) {
  const store = getConfigStore();
  await store.setJSON(STORE_KEY, codes);
}

// Generate a random code, retrying if it collides with an existing one.
function generateCode(existing) {
  const taken = new Set((existing || []).map((c) => c.code));
  for (let attempt = 0; attempt < 200; attempt++) {
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!taken.has(out)) return out;
  }
  // Astronomically unlikely, but if we somehow generate 200 collisions
  // in a row, fall back to a timestamped code — still unique.
  return "T" + Date.now().toString(36).toUpperCase().slice(-6);
}

// Normalize a user-supplied code (URL param, form input) into the
// canonical stored form: uppercase, alphanumeric only.
function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Validate that a code is redeemable RIGHT NOW. Returns a plain object:
//   { valid: true, code: <full record> }
// or:
//   { valid: false, reason: "<user-facing message>" }
function validateCode(record) {
  if (!record) return { valid: false, reason: "Code not found." };
  if (!record.active) return { valid: false, reason: "This code has been deactivated." };
  if (record.expiresAt) {
    // expiresAt is a date-only string in local (Los Angeles) semantics.
    // Interpret expiry as "valid THROUGH the end of that day" so a code
    // dated 2026-12-31 works all day on Dec 31.
    const expiryEnd = new Date(record.expiresAt + "T23:59:59-08:00");
    if (Number.isFinite(expiryEnd.getTime()) && Date.now() > expiryEnd.getTime()) {
      return { valid: false, reason: "This code has expired." };
    }
  }
  if (record.maxUses != null && record.usedCount >= record.maxUses) {
    return { valid: false, reason: "This code has reached its usage limit." };
  }
  return { valid: true, code: record };
}

// Compute the discounted price. Returns { discountedPrice, discountApplied }
// both in the same unit as `originalPrice` (dollars, whole numbers).
function applyDiscount(originalPrice, percentOff) {
  const price = Number(originalPrice) || 0;
  const pct = Number(percentOff) || 0;
  const discountApplied = Math.round((price * pct) / 100);
  return {
    discountedPrice: Math.max(0, price - discountApplied),
    discountApplied,
  };
}

// Increment usedCount + append a redemption record. Uses a read-modify-
// write pattern on the single blob. Netlify Blobs' strong consistency
// means concurrent writes to the same key will not silently interleave —
// worst case one write briefly overshadows another and the count is
// slightly off, which is acceptable for this domain.
async function recordRedemption(codeStr, redemption) {
  const codes = await listCodes();
  const idx = codes.findIndex((c) => c.code === codeStr);
  if (idx === -1) return { ok: false, reason: "not-found" };
  const record = codes[idx];
  record.usedCount = (record.usedCount || 0) + 1;
  record.redemptions = Array.isArray(record.redemptions) ? record.redemptions : [];
  record.redemptions.push({ at: new Date().toISOString(), ...redemption });
  await saveCodes(codes);
  return { ok: true, code: record };
}

module.exports = {
  listCodes,
  saveCodes,
  generateCode,
  normalizeCode,
  validateCode,
  applyDiscount,
  recordRedemption,
  CODE_LENGTH,
};
