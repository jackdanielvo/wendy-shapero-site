// Returns the available date/time slots for a session of a given
// duration. Reads Wendy's Outlook/Exchange calendar via Microsoft
// Graph (/me/calendarView) to find busy times, then walks her
// configured working hours filling in the gaps.
//
// Falls back to a synthetic mock if Microsoft Graph isn't configured
// yet (no refresh token in storage), so the booking page still works
// in dev / preview deploys before OAuth is run.

const { graphFetch } = require("./_msgraph");
const { getSettings } = require("./_settings");

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const duration = Math.max(30, Math.min(240, Number(params.duration) || 60));

  // Pull working hours, lead time, etc. from the admin-editable blob.
  // Falls back to defaults so this still works on a fresh install.
  const settings = await getSettings();

  const now = new Date();
  const earliest = new Date(now.getTime() + settings.leadTimeHours * 3600 * 1000);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + settings.daysToShow);

  // Try to read busy times from Microsoft Graph. If the token store is
  // empty (OAuth not run yet) or the call fails, fall back to mock so
  // the page still renders.
  let busy = [];
  let mock = false;
  try {
    busy = await fetchBusy(now, horizon);
  } catch (err) {
    console.warn("[availability] Graph fetch failed, returning mock:", err.message);
    mock = true;
  }

  const days = buildDays({
    duration,
    earliest,
    horizon,
    busy,
    settings,
  });

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      duration,
      timezone: settings.timezone,
      days,
      mock,
    }),
  };
};

// Walk every day in the horizon, generate candidate slots based on
// working hours, drop those that conflict with busy ranges or sit
// before the lead-time cutoff.
//
// IMPORTANT: this all runs in `settings.timezone` (default LA), not the
// server's local time. Netlify functions run in UTC, so naive Date.setHours
// would produce 9am UTC = 2am Pacific. Instead we iterate calendar days
// IN the configured timezone and convert each wall-clock time to UTC for
// the Date instance.
function buildDays({ duration, earliest, horizon, busy, settings }) {
  const tz = settings.timezone;
  const days = [];

  // Start from today's calendar date in the configured tz, walk forward.
  let cal = calendarInTZ(new Date(), tz);
  const horizonCal = calendarInTZ(horizon, tz);

  while (calBeforeOrEqual(cal, horizonCal)) {
    const hours = settings.hoursByDay[cal.dow];
    if (hours) {
      const slots = generateSlots(cal, hours, duration, earliest, busy, settings);
      if (slots.length) {
        days.push({
          // YYYY-MM-DD in the configured tz — matches what the booking
          // page renders for the day label.
          date: `${cal.year}-${pad2(cal.month)}-${pad2(cal.day)}`,
          slots: slots.slice(0, settings.maxSlotsPerDay),
        });
      }
    }
    cal = nextCalDay(cal);
  }
  return days;
}

function generateSlots(cal, hours, durationMin, earliest, busy, settings) {
  const slots = [];
  const [sH, sM] = hours.start.split(":").map(Number);
  const [eH, eM] = hours.end.split(":").map(Number);
  const stepMin = durationMin + settings.bufferMin;
  let mark = sH * 60 + sM;
  const dayEnd = eH * 60 + eM;

  while (mark + durationMin <= dayEnd) {
    const h = Math.floor(mark / 60);
    const m = mark % 60;
    // wall-clock h:m in the configured tz → corresponding UTC instant
    const start = tzWallClockToUTC(cal.year, cal.month, cal.day, h, m, settings.timezone);
    const end = new Date(start.getTime() + durationMin * 60 * 1000);

    if (start >= earliest && !overlapsBusy(start, end, busy)) {
      slots.push({
        start: start.toISOString(),
        duration: durationMin,
      });
    }
    mark += stepMin;
  }
  return slots;
}

// ---------------------------------------------------------
// Timezone helpers — JS's built-in Date API doesn't let you
// directly construct "9am Pacific on May 8" without a library,
// so we use Intl.DateTimeFormat to do the math.
// ---------------------------------------------------------

// Returns calendar components for `instant` AS OBSERVED IN `tz`.
// e.g. for `new Date()` at 03:00 UTC on May 8 with tz='America/Los_Angeles',
// returns { year: 2026, month: 5, day: 7, dow: 4 } (still May 7 in LA).
function calendarInTZ(instant, tz) {
  // en-CA gives the cleanest "YYYY-MM-DD" / "00..23" outputs across
  // Intl implementations (en-US has been observed to render midnight
  // as "24" on some platforms).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const o = {};
  parts.forEach((p) => { o[p.type] = p.value; });
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    dow: dowMap[o.weekday],
  };
}

// Returns the calendar object for the day after `cal`. Handles month
// and year rollover via Date.UTC arithmetic.
function nextCalDay({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
  };
}

function calBeforeOrEqual(a, b) {
  if (a.year !== b.year) return a.year < b.year;
  if (a.month !== b.month) return a.month < b.month;
  return a.day <= b.day;
}

// Given a wall-clock date+time IN `tz`, return the corresponding UTC
// Date. Uses the round-trip technique: pretend the wall-clock is UTC,
// see what tz makes of it, and double-back to find the actual UTC
// instant that DISPLAYS as the desired wall-clock in tz.
//
// Handles DST automatically because Intl applies the right offset for
// the date in question.
function tzWallClockToUTC(year, month, day, hour, min, tz) {
  const candidate = Date.UTC(year, month - 1, day, hour, min);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(candidate));
  const o = {};
  parts.forEach((p) => { o[p.type] = p.value; });
  const observed = Date.UTC(
    Number(o.year),
    Number(o.month) - 1,
    Number(o.day),
    Number(o.hour),
    Number(o.minute),
    Number(o.second)
  );
  // observed is what `candidate` shows as in tz, expressed as a UTC ms.
  // candidate - observed = tz offset (positive when tz is behind UTC).
  // The instant that DISPLAYS as the desired wall-clock in tz is
  // candidate + (candidate - observed) = 2*candidate - observed.
  return new Date(2 * candidate - observed);
}

function pad2(n) { return String(n).padStart(2, "0"); }

function overlapsBusy(start, end, busy) {
  for (const b of busy) {
    // Overlap if our [start,end) intersects b's [bStart,bEnd)
    if (start < b.end && end > b.start) return true;
  }
  return false;
}

// Read Wendy's calendar events (busy/tentative/oof) for the date range.
async function fetchBusy(from, to) {
  const params = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $select: "start,end,showAs,isAllDay,subject",
    $top: "200",
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
  // Treat busy + tentative + oof as blocking. Free events don't block.
  const blocking = ["busy", "tentative", "oof"];
  return (data.value || [])
    .filter((ev) => blocking.includes((ev.showAs || "").toLowerCase()))
    .map((ev) => ({
      start: new Date(ev.start.dateTime + (ev.start.dateTime.endsWith("Z") ? "" : "Z")),
      end: new Date(ev.end.dateTime + (ev.end.dateTime.endsWith("Z") ? "" : "Z")),
    }));
}
