// Admin endpoint for add-ons. Netlify Identity JWT required for all
// methods.
//   GET    — list current add-ons (falls back to defaults if none saved)
//   PUT    — save the full list (client sends the whole array)
//   DELETE — wipe the override so /api/addons falls back to defaults
//
// Client is expected to save the ENTIRE list at once (same pattern as
// admin-packages). Simpler than per-row create/update/delete and keeps
// ordering trivial (server just stores the array as-is).

const { requireAuth } = require("./_auth");
const {
  listAddons,
  saveAddons,
  resetAddons,
  validateAddon,
  DEFAULT_ADDONS,
} = require("./_addons");

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  try {
    if (event.httpMethod === "GET") {
      const addons = await listAddons();
      return json(200, { addons });
    }

    if (event.httpMethod === "PUT") {
      let body;
      try { body = JSON.parse(event.body || "{}"); }
      catch { return json(400, { error: "Invalid JSON" }); }
      if (!Array.isArray(body.addons)) {
        return json(400, { error: "addons must be an array" });
      }
      const cleaned = [];
      const seenIds = new Set();
      for (const a of body.addons) {
        const v = validateAddon(a);
        if (v.error) {
          return json(400, { error: `Add-on "${a && a.label}": ${v.error}` });
        }
        if (seenIds.has(v.value.id)) {
          return json(400, { error: `Duplicate id "${v.value.id}" — each add-on needs a unique id.` });
        }
        seenIds.add(v.value.id);
        cleaned.push(v.value);
      }
      // Renumber `order` so gaps from deletes don't accumulate.
      cleaned.forEach((row, i) => { row.order = i + 1; });
      await saveAddons(cleaned);
      return json(200, { ok: true, addons: cleaned });
    }

    if (event.httpMethod === "DELETE") {
      await resetAddons();
      return json(200, { ok: true, addons: DEFAULT_ADDONS });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-addons] error:", err);
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
