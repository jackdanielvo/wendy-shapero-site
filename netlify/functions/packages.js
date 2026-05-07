// Public endpoint: returns the current package list. The /book page
// fetches this on load instead of using a hardcoded array, so any
// edits Wendy makes in /admin show up immediately on the booking page.
//
// No auth — anyone can read the package definitions (they're shown
// publicly anyway). Writes go through admin-packages.js with auth.

const { getConfigStore } = require("./_blobs");
const { DEFAULT_PACKAGES } = require("./_packages");

exports.handler = async () => {
  let packages;
  try {
    const store = getConfigStore();
    const stored = await store.get("packages", { type: "json" });
    packages = stored && Array.isArray(stored) ? stored : DEFAULT_PACKAGES;
  } catch (e) {
    console.warn("[packages] read failed, returning defaults:", e.message);
    packages = DEFAULT_PACKAGES;
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      // Short cache so booking page doesn't hammer this on every load
      // but admin edits propagate within a minute.
      "Cache-Control": "public, max-age=60",
    },
    body: JSON.stringify({ packages }),
  };
};
