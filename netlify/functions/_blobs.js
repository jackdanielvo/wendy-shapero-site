// Helper that returns a Netlify Blobs store with explicit credentials.
// Netlify *should* auto-configure Blobs for Functions, but in our build
// the environment isn't being injected — so we configure explicitly using
// SITE_ID (auto-set by Netlify in the function runtime) and a Personal
// Access Token the user provides via NETLIFY_API_TOKEN env var.
//
// To create the token: Netlify dashboard → user avatar (top right) →
// User settings → Applications → Personal access tokens → New access
// token. Name it "WendyPix Blobs", set a long expiry, copy the value,
// and paste it as NETLIFY_API_TOKEN in Project configuration → Env vars.

const { getStore } = require("@netlify/blobs");

function getSecretsStore() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;

  if (!siteID) {
    throw new Error(
      "SITE_ID env var missing. Netlify usually auto-injects this — " +
      "if it's missing, add it manually in Project configuration → Environment variables."
    );
  }
  if (!token) {
    throw new Error(
      "NETLIFY_API_TOKEN env var missing. Create a Personal Access Token at " +
      "Netlify → user settings → Applications → Personal access tokens, " +
      "then paste it as NETLIFY_API_TOKEN."
    );
  }

  return getStore({
    name: "wendypix-secrets",
    consistency: "strong",
    siteID,
    token,
  });
}

// Separate store for booking metadata (per-event JSON). Confirm/Decline
// read this to get the client email since parsing it back out of the
// Outlook event body is brittle (Outlook reformats bodies into HTML).
function getBookingsStore() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (!siteID || !token) {
    throw new Error("Bookings store needs SITE_ID and NETLIFY_API_TOKEN env vars");
  }
  return getStore({
    name: "wendypix-bookings",
    consistency: "strong",
    siteID,
    token,
  });
}

// Config store — admin-editable settings (packages, working hours, etc.).
function getConfigStore() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (!siteID || !token) {
    throw new Error("Config store needs SITE_ID and NETLIFY_API_TOKEN env vars");
  }
  return getStore({
    name: "wendypix-config",
    consistency: "strong",
    siteID,
    token,
  });
}

module.exports = { getSecretsStore, getBookingsStore, getConfigStore };
