// Source of truth for runtime-editable booking settings.
//
// What lives here:
//   - working hours per weekday
//   - lead time (minimum hours between booking and session)
//   - buffer between sessions (minutes)
//   - days lookahead for the picker
//   - max slots shown per day
//   - deposit percentage charged at booking
//
// Storage: a single key in the wendypix-config blob ("settings").
// Reads transparently fall back to DEFAULT_SETTINGS when the blob has
// never been written, so the booking page works on a fresh install.
//
// All values are also validated on write — see validate() — so a typo
// in the admin form can't break /api/availability.

const { getConfigStore } = require("./_blobs");

// Defaults match what was previously hardcoded in availability.js +
// book.js. Keep these in sync if you change SETTINGS shape.
const DEFAULT_SETTINGS = {
  // Working hours per weekday. Keys 0..6 (Sun..Sat). null = closed.
  hoursByDay: {
    0: null,                                  // Sun closed
    1: { start: "09:00", end: "18:00" },      // Mon
    2: { start: "09:00", end: "18:00" },
    3: { start: "09:00", end: "18:00" },
    4: { start: "09:00", end: "18:00" },
    5: { start: "09:00", end: "18:00" },      // Fri
    6: { start: "10:00", end: "14:00" },      // Sat
  },
  leadTimeHours: 48,
  bufferMin: 30,
  daysToShow: 21,
  maxSlotsPerDay: 4,
  depositPercent: 25,
  timezone: "America/Los_Angeles",
};

// Friendly day labels for UI. Index matches the hoursByDay keys.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Read the active settings from the config blob, falling back to
 * defaults. Always returns a fully-populated object — every field
 * present, every weekday key set (to {start,end} or null).
 */
async function getSettings() {
  try {
    const store = getConfigStore();
    const stored = await store.get("settings", { type: "json" });
    return mergeWithDefaults(stored);
  } catch (err) {
    // Blob unreachable (env vars missing, network) — defaults keep
    // the booking page working rather than 500ing the user.
    console.warn("[_settings] blob read failed, using defaults:", err.message);
    return { ...DEFAULT_SETTINGS, hoursByDay: { ...DEFAULT_SETTINGS.hoursByDay } };
  }
}

/**
 * Persist settings (overwrites). Caller must have validated.
 */
async function putSettings(settings) {
  const store = getConfigStore();
  await store.setJSON("settings", settings);
  return settings;
}

/**
 * Wipe the override — getSettings() will then return DEFAULT_SETTINGS.
 */
async function deleteSettings() {
  const store = getConfigStore();
  await store.delete("settings");
}

/**
 * Merge stored object over defaults so a partial blob can't leave
 * the caller with undefined fields. Also normalizes the hoursByDay
 * keys to strings (blob round-trips JSON, so numeric keys come back
 * as strings — we standardize on numeric for the function code).
 */
function mergeWithDefaults(stored) {
  if (!stored || typeof stored !== "object") {
    return { ...DEFAULT_SETTINGS, hoursByDay: { ...DEFAULT_SETTINGS.hoursByDay } };
  }
  const hours = { ...DEFAULT_SETTINGS.hoursByDay };
  if (stored.hoursByDay && typeof stored.hoursByDay === "object") {
    for (let d = 0; d <= 6; d++) {
      const v = stored.hoursByDay[d] ?? stored.hoursByDay[String(d)];
      if (v === null) hours[d] = null;
      else if (v && typeof v === "object" && v.start && v.end) {
        hours[d] = { start: String(v.start), end: String(v.end) };
      }
    }
  }
  return {
    hoursByDay: hours,
    leadTimeHours: numOr(stored.leadTimeHours, DEFAULT_SETTINGS.leadTimeHours),
    bufferMin: numOr(stored.bufferMin, DEFAULT_SETTINGS.bufferMin),
    daysToShow: numOr(stored.daysToShow, DEFAULT_SETTINGS.daysToShow),
    maxSlotsPerDay: numOr(stored.maxSlotsPerDay, DEFAULT_SETTINGS.maxSlotsPerDay),
    depositPercent: numOr(stored.depositPercent, DEFAULT_SETTINGS.depositPercent),
    timezone: stored.timezone || DEFAULT_SETTINGS.timezone,
  };
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Validate a settings object on PUT. Returns { value, error }.
 * On success, value is the cleaned settings ready to persist.
 */
function validate(input) {
  if (!input || typeof input !== "object") {
    return { error: "Settings must be an object" };
  }

  // hoursByDay: each entry must be either null OR { start: "HH:MM", end: "HH:MM" }
  // with end > start. We accept missing keys (treat as null/closed).
  const hours = {};
  if (input.hoursByDay && typeof input.hoursByDay === "object") {
    for (let d = 0; d <= 6; d++) {
      const v = input.hoursByDay[d] ?? input.hoursByDay[String(d)];
      if (v == null) {
        hours[d] = null;
        continue;
      }
      if (typeof v !== "object" || !v.start || !v.end) {
        return { error: `${DAY_NAMES[d]}: must be either closed or have a start and end time` };
      }
      const start = parseHHMM(v.start);
      const end = parseHHMM(v.end);
      if (start == null) return { error: `${DAY_NAMES[d]}: bad start time "${v.start}" (use HH:MM 24-hour)` };
      if (end == null) return { error: `${DAY_NAMES[d]}: bad end time "${v.end}" (use HH:MM 24-hour)` };
      if (end <= start) return { error: `${DAY_NAMES[d]}: end time must be after start time` };
      hours[d] = { start: v.start, end: v.end };
    }
  } else {
    return { error: "hoursByDay required" };
  }

  // Numeric ranges with sensible bounds — wide enough not to be
  // annoying, tight enough that obviously-bad values get rejected.
  const lead = num(input.leadTimeHours, 0, 720);   // 0..30 days
  if (lead.error) return { error: `Lead time: ${lead.error}` };

  const buf = num(input.bufferMin, 0, 240);        // 0..4 hours
  if (buf.error) return { error: `Buffer: ${buf.error}` };

  const days = num(input.daysToShow, 1, 180);      // 1..6 months
  if (days.error) return { error: `Days lookahead: ${days.error}` };

  const slots = num(input.maxSlotsPerDay, 1, 24);
  if (slots.error) return { error: `Max slots per day: ${slots.error}` };

  const deposit = num(input.depositPercent, 0, 100);
  if (deposit.error) return { error: `Deposit %: ${deposit.error}` };

  return {
    value: {
      hoursByDay: hours,
      leadTimeHours: lead.value,
      bufferMin: buf.value,
      daysToShow: days.value,
      maxSlotsPerDay: slots.value,
      depositPercent: deposit.value,
      // Timezone isn't user-editable from the UI yet — keep whatever's
      // current or default to LA.
      timezone: typeof input.timezone === "string" ? input.timezone : DEFAULT_SETTINGS.timezone,
    },
  };
}

function num(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { error: "must be a number" };
  if (n < min) return { error: `must be at least ${min}` };
  if (n > max) return { error: `must be at most ${max}` };
  return { value: n };
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

module.exports = {
  DEFAULT_SETTINGS,
  DAY_NAMES,
  getSettings,
  putSettings,
  deleteSettings,
  validate,
};
