// Returns the available date/time slots for a session of a given
// duration. Reads Wendy's Outlook/Exchange calendar via Microsoft
// Graph (/me/calendarView) to find busy times, then walks her
// configured working hours filling in the gaps.
//
// Falls back to a synthetic mock if Microsoft Graph isn't configured
// yet (no refresh token in storage), so the booking page still works
// in dev / preview deploys before OAuth is run.

const { graphFetch } = require("./_msgraph");

const SETTINGS = {
  // Working hours by weekday number (0=Sun..6=Sat), 24-hour clock,
  // Pacific Time. 0 (Sun) and any missing day = closed.
  hoursByDay: {
    1: { start: "09:00", end: "18:00" },
    2: { start: "09:00", end: "18:00" },
    3: { start: "09:00", end: "18:00" },
    4: { start: "09:00", end: "18:00" },
    5: { start: "09:00", end: "18:00" },
    6: { start: "10:00", end: "14:00" },
  },
  leadTimeHours: 48,        // earliest a client can book
  bufferMin: 30,            // minimum gap between sessions
  daysToShow: 21,           // how far ahead to look
  maxSlotsPerDay: 4,        // visual cap per day
  timezone: "America/Los_Angeles",
};

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const duration = Math.max(30, Math.min(240, Number(params.duration) || 60));

  const now = new Date();
  const earliest = new Date(now.getTime() + SETTINGS.leadTimeHours * 3600 * 1000);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + SETTINGS.daysToShow);

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
  });

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      duration,
      timezone: SETTINGS.timezone,
      days,
      mock,
    }),
  };
};

// Walk every day in the horizon, generate candidate slots based on
// working hours, drop those that conflict with busy ranges or sit
// before the lead-time cutoff.
function buildDays({ duration, earliest, horizon, busy }) {
  const days = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= horizon) {
    const dow = cursor.getDay();
    const hours = SETTINGS.hoursByDay[dow];
    if (hours) {
      const slots = generateSlots(cursor, hours, duration, earliest, busy);
      if (slots.length) {
        days.push({
          date: cursor.toISOString().slice(0, 10),
          slots: slots.slice(0, SETTINGS.maxSlotsPerDay),
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function generateSlots(day, hours, durationMin, earliest, busy) {
  const slots = [];
  const [sH, sM] = hours.start.split(":").map(Number);
  const [eH, eM] = hours.end.split(":").map(Number);
  const stepMin = durationMin + SETTINGS.bufferMin;
  let mark = sH * 60 + sM;
  const dayEnd = eH * 60 + eM;

  while (mark + durationMin <= dayEnd) {
    const start = new Date(day);
    start.setHours(Math.floor(mark / 60), mark % 60, 0, 0);
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
