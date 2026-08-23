// Admin endpoint for the /pricing ledgers (Lifestyle, Events, Travel).
// Auth required. Client sends the ENTIRE rates object at once (same
// PUT-the-whole-thing pattern as admin-packages / admin-addons).
//
//   GET    — returns current rates (falls back to defaults per section)
//   PUT    — save whole rates object
//   DELETE — reset all sections to defaults

const { requireAuth } = require("./_auth");
const {
  listRates,
  saveRates,
  resetRates,
  validateRow,
  SECTIONS,
  DEFAULT_RATES,
} = require("./_rates");

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  try {
    if (event.httpMethod === "GET") {
      const rates = await listRates();
      return json(200, { rates });
    }

    if (event.httpMethod === "PUT") {
      let body;
      try { body = JSON.parse(event.body || "{}"); }
      catch { return json(400, { error: "Invalid JSON" }); }
      if (!body.rates || typeof body.rates !== "object") {
        return json(400, { error: "rates object required" });
      }
      const cleaned = {};
      for (const key of SECTIONS) {
        const arr = body.rates[key];
        if (!Array.isArray(arr)) {
          // Section not touched → keep existing (or default).
          const current = await listRates();
          cleaned[key] = current[key];
          continue;
        }
        cleaned[key] = [];
        const seenIds = new Set();
        for (const r of arr) {
          const v = validateRow(r);
          if (v.error) {
            return json(400, {
              error: `${key} row "${(r && r.label) || "(untitled)"}": ${v.error}`,
            });
          }
          // Disambiguate duplicate ids within a section.
          while (seenIds.has(v.value.id)) {
            v.value.id = v.value.id + "-" + Math.random().toString(36).slice(2, 4);
          }
          seenIds.add(v.value.id);
          cleaned[key].push(v.value);
        }
      }
      await saveRates(cleaned);
      return json(200, { ok: true, rates: cleaned });
    }

    if (event.httpMethod === "DELETE") {
      await resetRates();
      return json(200, { ok: true, rates: DEFAULT_RATES });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-rates] error:", err);
    return json(500, { error: err.message });
  }
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
