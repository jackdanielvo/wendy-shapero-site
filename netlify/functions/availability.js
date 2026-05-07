// Returns the available date/time slots for a session of a given
// duration. In production this reads Wendy's Google Calendar (busy
// times) and fills in the gaps according to her configured working
// hours, lead time, and per-day cap.
//
// PHASE 1 STUB: returns synthetic availability so the booking page
// works end-to-end while we wait for Google Calendar OAuth setup.
// Replace the buildMockDays() body with real Google Calendar logic
// once GCAL_CLIENT_ID / GCAL_CLIENT_SECRET / GCAL_REFRESH_TOKEN env
// vars are set.

const SETTINGS = {
  // Wendy's working hours, by weekday number (0=Sun..6=Sat).
  // Times in 24-hour clock, Pacific time, half-hour granularity.
  hoursByDay: {
    1: { start: "09:00", end: "18:00" },  // Mon
    2: { start: "09:00", end: "18:00" },  // Tue
    3: { start: "09:00", end: "18:00" },  // Wed
    4: { start: "09:00", end: "18:00" },  // Thu
    5: { start: "09:00", end: "18:00" },  // Fri
    6: { start: "10:00", end: "14:00" },  // Sat
    // 0 (Sun): closed
  },
  leadTimeHours: 48,        // earliest a client can book is 48h from now
  bufferMin: 30,            // gap between sessions
  daysToShow: 21,           // how far ahead the calendar runs
  maxSlotsPerDay: 4,        // visual cap so days don't get cluttered
  timezone: "America/Los_Angeles",
};

function buildMockDays(durationMin) {
  // Synthetic generator: walks the next N days, filters to working
  // days, and emits a few open slots per day. No real conflict
  // detection — that's what the Google Calendar integration will add.
  const days = [];
  const now = new Date();
  const earliest = new Date(now.getTime() + SETTINGS.leadTimeHours * 3600 * 1000);

  for (let i = 0; i < SETTINGS.daysToShow; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dow = d.getDay();
    const hours = SETTINGS.hoursByDay[dow];
    if (!hours) continue;

    const dateStr = d.toISOString().slice(0, 10);
    const slots = [];

    const [sH, sM] = hours.start.split(":").map(Number);
    const [eH, eM] = hours.end.split(":").map(Number);

    // Generate slots every (durationMin + bufferMin) starting at sH
    const stepMin = durationMin + SETTINGS.bufferMin;
    let mark = sH * 60 + sM;
    const dayEnd = eH * 60 + eM;
    while (mark + durationMin <= dayEnd && slots.length < SETTINGS.maxSlotsPerDay) {
      const slotH = Math.floor(mark / 60);
      const slotM = mark % 60;
      const start = new Date(d);
      start.setHours(slotH, slotM, 0, 0);
      // Skip slots that fall before lead time
      if (start >= earliest) {
        slots.push({
          start: start.toISOString(),
          duration: durationMin,
        });
      }
      mark += stepMin;
    }

    if (slots.length) {
      days.push({ date: dateStr, slots });
    }
  }
  return days;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const duration = Math.max(30, Math.min(240, Number(params.duration) || 60));

  // TODO: replace with real Google Calendar lookup once OAuth tokens
  // are available in env vars. For now: synthetic availability.
  const days = buildMockDays(duration);

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
      mock: !process.env.GCAL_REFRESH_TOKEN,  // signal to frontend that this isn't real
    }),
  };
};
