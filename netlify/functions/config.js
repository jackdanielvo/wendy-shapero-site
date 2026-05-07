// Returns small bits of frontend config that depend on the server
// environment — currently just whether Stripe is wired up. The booking
// page reads this to decide how to phrase the deposit note (charged
// automatically vs Wendy will follow up).

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
    }),
  };
};
