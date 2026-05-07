// Microsoft sends the user here after they grant consent. We exchange
// the authorization code for an access token + refresh token, then
// store the refresh token in Netlify Blobs so the booking functions
// can use it from then on.
//
// Wendy hits this URL exactly once per registration. After that the
// refresh token rotates itself indefinitely.

const { getSecretsStore } = require("./_blobs");

exports.handler = async (event) => {
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const redirectUri = process.env.MS_REDIRECT_URI;

  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    return text(500, "Missing one of MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI.");
  }

  const params = event.queryStringParameters || {};
  const code = params.code;
  const errorMsg = params.error_description || params.error;
  if (errorMsg) return text(400, "Microsoft returned an error: " + errorMsg);
  if (!code) return text(400, "Missing ?code parameter on callback.");

  // Exchange the auth code for tokens.
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: "Calendars.ReadWrite offline_access User.Read",
  });

  let tokens;
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    tokens = await res.json();
    if (!res.ok) {
      return text(
        500,
        "Token exchange failed: " + (tokens.error_description || JSON.stringify(tokens))
      );
    }
  } catch (e) {
    return text(500, "Network error calling Microsoft token endpoint: " + e.message);
  }

  if (!tokens.refresh_token) {
    return text(
      500,
      "Microsoft did not return a refresh_token. Make sure the app has " +
        "the `offline_access` permission (under API permissions in Azure)."
    );
  }

  // Store the refresh token in Netlify Blobs. Booking functions read
  // this on each invocation and exchange it for a fresh access token.
  try {
    const store = getSecretsStore();
    await store.setJSON("ms-graph-refresh-token", {
      refreshToken: tokens.refresh_token,
      obtainedAt: new Date().toISOString(),
      scope: tokens.scope,
    });
  } catch (e) {
    return text(500, "Stored token but Blobs write failed: " + e.message);
  }

  return text(
    200,
    "✅ Calendar connected. Refresh token stored. You can close this tab.\n\n" +
      "Booking page is now live — clients can pick real available slots from your calendar, " +
      "and confirmed bookings will show up as events."
  );
};

function text(code, body) {
  return {
    statusCode: code,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}
