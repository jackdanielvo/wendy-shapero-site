// Auth gate for admin endpoints. Netlify Identity injects the logged-in
// user into context.clientContext.user when a valid bearer token is
// sent in the Authorization header. We just check that's present —
// Netlify already verified the JWT signature against the site's
// Identity instance before this function ran.

function requireAuth(context) {
  const user = context && context.clientContext && context.clientContext.user;
  if (!user) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized — admin login required" }),
    };
  }
  return null; // pass — caller proceeds
}

module.exports = { requireAuth };
