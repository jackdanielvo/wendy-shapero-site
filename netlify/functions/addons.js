// Public endpoint — returns the current add-ons list. Consumed by
// /pricing (renders the ledger) and /book (renders bookable checkboxes).
// Writes go through admin-addons.js with auth.

const { listAddons, DEFAULT_ADDONS } = require("./_addons");

exports.handler = async () => {
  let addons;
  try {
    addons = await listAddons();
  } catch (e) {
    console.warn("[addons] read failed, returning defaults:", e.message);
    addons = DEFAULT_ADDONS.slice();
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      // Same 10s TTL as /api/packages — short enough that admin edits
      // reflect fast, long enough that repeat page loads skip the
      // function invocation.
      "Cache-Control": "public, max-age=10",
    },
    body: JSON.stringify({ addons }),
  };
};
