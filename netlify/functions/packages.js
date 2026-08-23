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
      // Short cache so booking + pricing pages don't hammer this on
      // every load, but admin edits propagate almost immediately. 10s
      // is a good balance: repeat page loads in the same session skip
      // the function invocation, but "did my edit take?" checks after
      // saving in admin succeed on the next page reload.
      "Cache-Control": "public, max-age=10",
    },
    body: JSON.stringify({ packages }),
  };
};
