// Thin wrapper around Stripe API calls. Direct fetch() against the
// Stripe REST API rather than pulling in the official SDK — keeps
// the function bundle small and avoids version compatibility surprises.
//
// All amounts in CENTS (Stripe's convention). Frontend uses dollars.

const STRIPE_API = "https://api.stripe.com/v1";

function getKey() {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("STRIPE_SECRET_KEY env var missing");
  return k;
}

// POST helpers — Stripe wants application/x-www-form-urlencoded with
// nested keys flattened (`metadata[foo]=bar`).
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") {
          Object.assign(out, flatten(item, `${key}[${i}]`));
        } else {
          out[`${key}[${i}]`] = String(item);
        }
      });
    } else if (v && typeof v === "object") {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

async function stripePost(path, body) {
  const params = new URLSearchParams(flatten(body));
  const res = await fetch(STRIPE_API + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + getKey(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Create a Stripe Checkout session for the deposit.
// Returns { id, url } — frontend redirects to `url`.
async function createCheckoutSession({
  packageName,
  amountCents,           // deposit cents (DEPOSIT_PERCENT % of price)
  depositLabel,          // e.g. "25% deposit" — shown on Stripe Checkout
  customerEmail,
  metadata,              // { eventId, packageId, name, ... } — we read this back in the webhook
  successUrl,
  cancelUrl,
}) {
  return stripePost("/checkout/sessions", {
    mode: "payment",
    customer_email: customerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_intent_data: {
      // Stripe shows this on the customer's card statement
      description: `WendyPix deposit — ${packageName}`,
      metadata,
      // Lets us refund automatically later if Wendy declines
      capture_method: "automatic",
    },
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name: `${packageName} — ${depositLabel || "deposit"}`,
          description: "Non-refundable retainer to hold your session date.",
        },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    metadata,
    // Stripe auto-collects a billing address — fine for invoicing
    billing_address_collection: "auto",
    allow_promotion_codes: false,
  });
}

// Verify a webhook signature. Stripe signs the raw request body with
// the webhook secret; we recompute the HMAC and constant-time compare.
const crypto = require("crypto");
function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  // Stripe-Signature header looks like:
  // t=1696000000,v1=hex...,v0=hex...
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=").map((s) => s.trim()))
  );
  if (!parts.t || !parts.v1) return false;
  const signed = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  // Constant-time compare
  const a = Buffer.from(parts.v1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  createCheckoutSession,
  verifyWebhookSignature,
};
