// Generates the Microsoft consent URL and redirects the user there.
// Visit /.netlify/functions/auth-start once (signed in as Wendy) to
// kick off the OAuth flow. Microsoft will send the user back to
// auth-callback with an authorization code.
//
// This function is the one-time setup step. After it runs successfully,
// auth-callback stores a refresh token in Netlify Blobs, and from then
// on availability.js and book.js use that refresh token to talk to
// Microsoft Graph without Wendy having to log in again.

exports.handler = async () => {
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const redirectUri = process.env.MS_REDIRECT_URI;

  if (!tenantId || !clientId || !redirectUri) {
    return {
      statusCode: 500,
      body:
        "Missing one of MS_TENANT_ID, MS_CLIENT_ID, MS_REDIRECT_URI in env vars. " +
        "Set them in Netlify → Site settings → Environment variables, then redeploy.",
    };
  }

  // Scopes:
  //   Calendars.ReadWrite — read busy times, create/update events
  //   offline_access      — get a refresh token so we don't have to
  //                         re-auth every hour
  //   User.Read           — read profile info for confirmation/UX
  const scopes = ["Calendars.ReadWrite", "offline_access", "User.Read"];

  // CSRF token. We don't have a session store yet so we just bake a
  // random value into the URL and validate it on return. Good enough
  // for a single-use admin flow run by Wendy herself.
  const state = Math.random().toString(36).slice(2);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
    state,
    prompt: "consent",  // force the consent screen first time
  });

  const consentUrl =
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
    params.toString();

  return {
    statusCode: 302,
    headers: { Location: consentUrl },
    body: "",
  };
};
