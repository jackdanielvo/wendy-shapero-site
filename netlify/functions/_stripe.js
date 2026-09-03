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

// GET helper — used by the invoice list endpoint. Query params are
// flattened the same way POST bodies are (Stripe uses the same
// bracket syntax for nested query params, e.g. expand[]=data.customer).
async function stripeGet(path, query) {
  const qs = query ? "?" + new URLSearchParams(flatten(query)).toString() : "";
  const res = await fetch(STRIPE_API + path + qs, {
    method: "GET",
    headers: { Authorization: "Bearer " + getKey() },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ------------------------------------------------------------
// INVOICES
//
// Stripe's invoice flow is multi-step and order-sensitive:
//   1. Find or create a Customer (invoices attach to customers, not
//      to bare email addresses).
//   2. Create a DRAFT invoice for that customer with
//      collection_method: "send_invoice" (as opposed to
//      "charge_automatically", which would try to charge a saved card).
//   3. Create one InvoiceItem per line, each explicitly bound to the
//      draft invoice via the `invoice` param. Without that param the
//      item floats on the customer and lands on their *next* invoice,
//      which is a classic footgun.
//   4. Finalize — turns the draft into an issued invoice, assigns the
//      invoice number, and generates the PDF + hosted page.
//   5. Send — emails the client the hosted invoice link.
// ------------------------------------------------------------

// Look up a customer by email; create one if none exists. Stripe
// permits duplicate emails, so we reuse the first match to keep a
// client's invoice history under a single customer record.
async function findOrCreateCustomer({ name, email }) {
  const existing = await stripeGet("/customers", { email, limit: 1 });
  if (existing && Array.isArray(existing.data) && existing.data.length) {
    const cust = existing.data[0];
    // Backfill the name if the customer was auto-created by Checkout
    // (which only captures email) and we now have a real name.
    if (name && !cust.name) {
      try { await stripePost(`/customers/${cust.id}`, { name }); }
      catch (e) { console.warn("[stripe] customer name backfill failed:", e.message); }
    }
    return cust;
  }
  return stripePost("/customers", { name: name || undefined, email });
}

// Create a single-use coupon for an invoice-level discount.
//
// Stripe models invoice discounts as coupons, so a one-off "10% off for
// this invoice" still needs a coupon object. duration:"once" plus
// max_redemptions:1 keeps it from leaking onto other invoices or being
// reused. The `name` is what the client sees on the invoice next to the
// discount amount, so it should read as a reason ("Returning client").
//
// Exactly one of percentOff / amountOffCents must be supplied.
async function createCoupon({ percentOff, amountOffCents, name }) {
  const body = {
    duration: "once",
    max_redemptions: 1,
    name: name || "Discount",
  };
  if (percentOff != null) {
    body.percent_off = percentOff;
  } else if (amountOffCents != null) {
    body.amount_off = amountOffCents;
    body.currency = "usd";
  } else {
    throw new Error("createCoupon needs percentOff or amountOffCents");
  }
  return stripePost("/coupons", body);
}

// Create, finalize, and send an invoice in one call.
// lineItems: [{ description, amountCents, quantity }]
// discount (optional): { type: "percent"|"amount", value, label }
//   - type "percent": value is 1-100
//   - type "amount":  value is DOLLARS (converted to cents here)
// Returns the finalized invoice object (has hosted_invoice_url, invoice_pdf,
// number, status, amount_due).
async function createAndSendInvoice({
  customerName,
  customerEmail,
  lineItems,
  daysUntilDue = 14,
  memo,             // shown near the top of the invoice ("description")
  footer,           // small print at the bottom
  discount,         // optional { type, value, label }
  metadata = {},
}) {
  if (!Array.isArray(lineItems) || !lineItems.length) {
    throw new Error("At least one line item is required.");
  }
  const customer = await findOrCreateCustomer({ name: customerName, email: customerEmail });

  // Build the coupon first (if a discount was requested) so we can pass
  // it into the draft invoice at creation time. Doing it up front means
  // a bad discount fails before we've created a half-built invoice.
  let couponId = null;
  if (discount && discount.type && discount.value != null) {
    const label = String(discount.label || "").trim() || "Discount";
    if (discount.type === "percent") {
      const pct = Number(discount.value);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        throw new Error("Discount percent must be between 1 and 100.");
      }
      const coupon = await createCoupon({
        percentOff: pct,
        name: `${label} (${pct}% off)`,
      });
      couponId = coupon.id;
    } else if (discount.type === "amount") {
      const dollars = Number(discount.value);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        throw new Error("Discount amount must be greater than zero.");
      }
      const coupon = await createCoupon({
        amountOffCents: Math.round(dollars * 100),
        name: label,
      });
      couponId = coupon.id;
    } else {
      throw new Error(`Unknown discount type "${discount.type}".`);
    }
  }

  // Step 2 — draft invoice. auto_advance:false keeps Stripe from
  // finalizing on its own schedule; we finalize explicitly below so
  // we can surface errors synchronously to the admin UI.
  const draft = await stripePost("/invoices", {
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    auto_advance: false,
    description: memo || undefined,
    footer: footer || undefined,
    metadata,
    // Invoice-level discount. Stripe applies this to the subtotal and
    // renders it as its own "Discount" row above the total on both the
    // hosted page and the PDF.
    discounts: couponId ? [{ coupon: couponId }] : undefined,
    // Stripe emails payment reminders on its own cadence for
    // send_invoice collection. Nothing to configure here — it's
    // controlled per-account in Dashboard → Settings → Invoicing.
  });

  // Step 3 — line items bound to this specific draft.
  for (const item of lineItems) {
    await stripePost("/invoiceitems", {
      customer: customer.id,
      invoice: draft.id,
      currency: "usd",
      description: item.description,
      // Stripe wants either `amount` (total for the line) or
      // unit_amount + quantity. We use unit_amount + quantity so the
      // invoice shows "3 × $45.00" rather than a flattened $135.
      unit_amount: item.amountCents,
      quantity: item.quantity || 1,
    });
  }

  // Step 4 — finalize (assigns number, generates PDF + hosted page)
  const finalized = await stripePost(`/invoices/${draft.id}/finalize`, {});

  // Step 5 — send the email
  const sent = await stripePost(`/invoices/${finalized.id}/send`, {});
  return sent;
}

async function listInvoices({ limit = 50 } = {}) {
  // expand customer so the admin list can show the client name without
  // an N+1 lookup per row.
  return stripeGet("/invoices", {
    limit,
    expand: ["data.customer"],
  });
}

async function voidInvoice(invoiceId) {
  return stripePost(`/invoices/${invoiceId}/void`, {});
}

// Re-send the invoice email for an already-finalized invoice.
async function resendInvoice(invoiceId) {
  return stripePost(`/invoices/${invoiceId}/send`, {});
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
  // Invoices
  createAndSendInvoice,
  listInvoices,
  voidInvoice,
  resendInvoice,
  findOrCreateCustomer,
  createCoupon,
};
