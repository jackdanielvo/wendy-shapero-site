// Admin endpoint: GET returns the current packages, PUT saves a new
// list. Auth-gated via Netlify Identity — only logged-in admin users
// can write.
//
// Validates each package on PUT so a typo in the form can't break
// the booking page (e.g. duration must be a positive int, name must
// be non-empty, etc.).

const { getConfigStore } = require("./_blobs");
const { DEFAULT_PACKAGES } = require("./_packages");
const { requireAuth } = require("./_auth");

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  const store = getConfigStore();

  if (event.httpMethod === "GET") {
    const stored = await store.get("packages", { type: "json" });
    const packages = stored && Array.isArray(stored) ? stored : DEFAULT_PACKAGES;
    return json(200, { packages });
  }

  if (event.httpMethod === "PUT") {
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return json(400, { error: "Invalid JSON" });
    }
    if (!Array.isArray(body.packages)) {
      return json(400, { error: "packages must be an array" });
    }
    const cleaned = [];
    for (const p of body.packages) {
      const v = validate(p);
      if (v.error) return json(400, { error: `Package "${p && p.name}": ${v.error}` });
      cleaned.push(v.value);
    }
    await store.setJSON("packages", cleaned);
    return json(200, { ok: true, packages: cleaned });
  }

  if (event.httpMethod === "DELETE") {
    // "Reset to defaults" — wipes the override, public endpoint will
    // fall back to DEFAULT_PACKAGES.
    await store.delete("packages");
    return json(200, { ok: true, packages: DEFAULT_PACKAGES });
  }

  return json(405, { error: "Method not allowed" });
};

function validate(p) {
  if (!p || typeof p !== "object") return { error: "must be an object" };
  if (!p.id || typeof p.id !== "string") return { error: "id required" };
  if (!/^[a-z0-9-]+$/.test(p.id)) return { error: "id can only contain lowercase letters, digits, and hyphens" };
  if (!p.name || typeof p.name !== "string") return { error: "name required" };
  if (!Array.isArray(p.includes)) return { error: "includes must be an array" };

  const inquiry = Boolean(p.inquiry);
  let price = null;
  let duration = null;
  if (!inquiry) {
    price = Number(p.price);
    if (!Number.isFinite(price) || price < 0) return { error: "price must be a non-negative number" };
    duration = Number(p.duration);
    if (!Number.isFinite(duration) || duration < 15 || duration > 480) {
      return { error: "duration must be between 15 and 480 minutes" };
    }
  }

  return {
    value: {
      id: p.id,
      name: p.name.trim(),
      price: inquiry ? null : price,
      duration: inquiry ? null : duration,
      description: (p.description || "").trim(),
      includes: p.includes.map((s) => String(s).trim()).filter(Boolean),
      featured: Boolean(p.featured),
      inquiry,
    },
  };
}

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
