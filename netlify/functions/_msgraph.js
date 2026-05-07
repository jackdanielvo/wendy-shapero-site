// Shared helper for Microsoft Graph API calls.
//
// Holds the refresh-token logic so availability.js, book.js, etc.
// don't each have to re-implement it. Reads the stored refresh token
// from Netlify Blobs, exchanges it for a fresh access token (with a
// short cache so back-to-back invocations don't hit the token
// endpoint each time), and provides a small fetch() wrapper that
// retries once if the token expired mid-request.

const { getSecretsStore } = require("./_blobs");

let cachedAccessToken = null;
let cachedExpiresAt = 0;

async function getAccessToken() {
  // Reuse a cached token if it's still valid for at least 5 minutes
  const now = Date.now();
  if (cachedAccessToken && now < cachedExpiresAt - 5 * 60 * 1000) {
    return cachedAccessToken;
  }

  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Missing MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET env vars");
  }

  const store = getSecretsStore();
  const stored = await store.get("ms-graph-refresh-token", { type: "json" });
  if (!stored || !stored.refreshToken) {
    throw new Error(
      "No refresh token in storage. Visit /.netlify/functions/auth-start to connect Wendy's calendar."
    );
  }

  // Exchange refresh token for fresh access token (and a rotated refresh token)
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
    scope: "Calendars.ReadWrite offline_access User.Read",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tokens = await res.json();
  if (!res.ok) {
    throw new Error(
      "Refresh token exchange failed: " + (tokens.error_description || JSON.stringify(tokens))
    );
  }

  // Microsoft typically rotates the refresh token. Save the new one.
  if (tokens.refresh_token && tokens.refresh_token !== stored.refreshToken) {
    await store.setJSON("ms-graph-refresh-token", {
      // (re-using the same store from above)
      refreshToken: tokens.refresh_token,
      obtainedAt: new Date().toISOString(),
      scope: tokens.scope,
    });
  }

  cachedAccessToken = tokens.access_token;
  cachedExpiresAt = now + (tokens.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

// Small fetch wrapper: prefixes the Graph base URL, attaches the
// access token, retries once on 401 by clearing the cache.
async function graphFetch(path, options = {}) {
  const doRequest = async () => {
    const token = await getAccessToken();
    const url = path.startsWith("http") ? path : "https://graph.microsoft.com/v1.0" + path;
    return fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  };

  let res = await doRequest();
  if (res.status === 401) {
    // Token may have been revoked or expired — clear cache and retry once.
    cachedAccessToken = null;
    res = await doRequest();
  }
  return res;
}

module.exports = { getAccessToken, graphFetch };
