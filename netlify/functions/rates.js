// Public endpoint — returns the current rates ledgers for Lifestyle,
// Events, and Travel sections of /pricing.
// Response shape: { rates: { lifestyle: Row[], events: Row[], travel: Row[] } }

const { listRates, DEFAULT_RATES } = require("./_rates");

exports.handler = async () => {
  let rates;
  try {
    rates = await listRates();
  } catch (e) {
    console.warn("[rates] read failed, returning defaults:", e.message);
    rates = { ...DEFAULT_RATES };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10",
    },
    body: JSON.stringify({ rates }),
  };
};
