// Public code-validation endpoint used by the booking page.
//
// Purpose: the booking form calls this after the client types a promo
// code so the UI can show the discounted price BEFORE they submit.
// The server also revalidates the code at actual booking time
// (see book.js) — this endpoint is a preview, not an authoritative
// hold. We deliberately don't reserve a use here since the client may
// still bail before submitting.
//
// Request:  POST /api/redeem-code   { code, packagePrice? }
// Response: 200 { valid: true,  percentOff, discountedPrice, discountApplied, message }
//           200 { valid: false, message }        // invalid code — still a 200 so
//                                                //   the frontend can render the
//                                                //   "sorry, no dice" message
//                                                //   without an error banner
//
// This endpoint is intentionally UN-authed so anyone visiting the
// booking page can validate a code before signing in / handing over
// details. No PII is exposed — we only reveal percentOff, not the
// influencer name, email, or usage counts.

const { listCodes, normalizeCode, validateCode, applyDiscount } = require("./_codes");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { valid: false, message: "Method not allowed" });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const codeStr = normalizeCode(body.code);
  if (!codeStr) {
    return json(200, { valid: false, message: "Please enter a code." });
  }

  let codes;
  try {
    codes = await listCodes();
  } catch (err) {
    console.error("[redeem-code] blob read failed:", err.message);
    return json(500, { valid: false, message: "Couldn't check the code right now — try again in a moment." });
  }

  const record = codes.find((c) => c.code === codeStr);
  const result = validateCode(record);
  if (!result.valid) {
    return json(200, { valid: false, message: result.reason });
  }

  // Optional price preview — if the caller supplied packagePrice we
  // compute the discounted amount so the frontend can render both.
  let preview = null;
  const price = Number(body.packagePrice);
  if (Number.isFinite(price) && price > 0) {
    const { discountedPrice, discountApplied } = applyDiscount(price, record.percentOff);
    preview = { originalPrice: price, discountedPrice, discountApplied };
  }

  return json(200, {
    valid: true,
    percentOff: record.percentOff,
    message: `${record.percentOff}% off applied.`,
    ...(preview || {}),
  });
};

function json(code, payload) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}
