// Admin endpoint for booking settings — working hours, lead time,
// buffer, days lookahead, deposit %. Mirrors admin-packages.js shape.
//
//   GET    → current settings (or defaults if nothing saved yet)
//   PUT    → validate + save; returns the persisted settings on success
//   DELETE → wipe override; subsequent reads return DEFAULT_SETTINGS

const {
  DEFAULT_SETTINGS,
  getSettings,
  putSettings,
  deleteSettings,
  validate,
} = require("./_settings");
const { requireAuth } = require("./_auth");

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  if (event.httpMethod === "GET") {
    const settings = await getSettings();
    return json(200, { settings });
  }

  if (event.httpMethod === "PUT") {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return json(400, { error: "Invalid JSON" });
    }
    const v = validate(body && body.settings);
    if (v.error) return json(400, { error: v.error });
    const saved = await putSettings(v.value);
    return json(200, { ok: true, settings: saved });
  }

  if (event.httpMethod === "DELETE") {
    await deleteSettings();
    return json(200, { ok: true, settings: DEFAULT_SETTINGS });
  }

  return json(405, { error: "Method not allowed" });
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
