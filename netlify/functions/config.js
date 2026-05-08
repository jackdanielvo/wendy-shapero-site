// Returns small bits of frontend config that depend on the server
// environment + admin-editable settings: whether Stripe is wired up
// and the current deposit percentage. The booking page uses this to
// phrase the deposit note correctly (charged automatically vs Wendy
// will follow up) and to compute the deposit dollars shown.

const { getSettings } = require("./_settings");

exports.handler = async () => {
  let depositPercent = 25; // safe default if blob read fails
  try {
    const settings = await getSettings();
    depositPercent = settings.depositPercent;
  } catch (err) {
    console.warn("[config] settings read failed:", err.message);
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
      depositPercent,
    }),
  };
};
