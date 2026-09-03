// Admin endpoint for invoices. All methods require a Netlify Identity JWT.
//
//   GET   /api/admin-invoices                 → list recent invoices
//   POST  /api/admin-invoices                 → create + finalize + send
//   POST  /api/admin-invoices?action=void     → void an open invoice
//   POST  /api/admin-invoices?action=resend   → re-send the invoice email
//
// Invoices live in Stripe, not in our Blobs store — Stripe is the
// system of record for billing. That means no sync problems, and
// Wendy can also manage the same invoices from the Stripe Dashboard
// if she prefers. We just provide a lighter-weight UI for the common
// case (create, send, check status).

const { requireAuth } = require("./_auth");
const {
  createAndSendInvoice,
  listInvoices,
  voidInvoice,
  resendInvoice,
} = require("./_stripe");

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(503, {
      error:
        "Stripe isn't configured. Add STRIPE_SECRET_KEY in Netlify → " +
        "Site configuration → Environment variables, then redeploy.",
    });
  }

  try {
    const params = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      const list = await listInvoices({ limit: 50 });
      // Trim the Stripe payload down to what the admin table needs —
      // the raw objects are enormous and we don't want to ship all of
      // that over the wire on every tab click.
      const invoices = (list.data || []).map(summarize);
      return json(200, { invoices });
    }

    if (event.httpMethod === "POST") {
      if (params.action === "void") return await handleVoid(event);
      if (params.action === "resend") return await handleResend(event);
      return await handleCreate(event);
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-invoices] error:", err);
    return json(500, { error: err.message });
  }
};

// ---------- POST (create + send) ----------
async function handleCreate(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const customerName = String(body.customerName || "").trim();
  const customerEmail = String(body.customerEmail || "").trim().toLowerCase();
  if (!customerName) return json(400, { error: "Client name is required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return json(400, { error: "A valid client email is required." });
  }

  if (!Array.isArray(body.lineItems) || !body.lineItems.length) {
    return json(400, { error: "Add at least one line item." });
  }
  const lineItems = [];
  for (const raw of body.lineItems) {
    const description = String((raw && raw.description) || "").trim();
    const amount = Number(raw && raw.amount);
    const quantity = Number((raw && raw.quantity) || 1);
    if (!description) return json(400, { error: "Every line item needs a description." });
    if (!Number.isFinite(amount) || amount <= 0) {
      return json(400, { error: `Line "${description}": amount must be greater than zero.` });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return json(400, { error: `Line "${description}": quantity must be a whole number of 1 or more.` });
    }
    lineItems.push({
      description,
      // Dollars from the form → cents for Stripe. Rounding guards
      // against float drift on values like 45.10.
      amountCents: Math.round(amount * 100),
      quantity,
    });
  }

  let daysUntilDue = 14;
  if (body.daysUntilDue != null && body.daysUntilDue !== "") {
    const n = Number(body.daysUntilDue);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      return json(400, { error: "Due in (days) must be a whole number between 0 and 365." });
    }
    daysUntilDue = n;
  }

  const invoice = await createAndSendInvoice({
    customerName,
    customerEmail,
    lineItems,
    daysUntilDue,
    memo: String(body.memo || "").trim() || undefined,
    footer:
      String(body.footer || "").trim() ||
      "Thank you! — Wendy Shapero · wendy@wendypix.com · (818) 383-0102",
    metadata: {
      source: "wendypix-admin",
      createdBy: "admin",
    },
  });

  return json(200, { ok: true, invoice: summarize(invoice) });
}

// ---------- POST ?action=void ----------
async function handleVoid(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const id = String(body.invoiceId || "").trim();
  if (!id) return json(400, { error: "invoiceId required" });
  const voided = await voidInvoice(id);
  return json(200, { ok: true, invoice: summarize(voided) });
}

// ---------- POST ?action=resend ----------
async function handleResend(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const id = String(body.invoiceId || "").trim();
  if (!id) return json(400, { error: "invoiceId required" });
  const sent = await resendInvoice(id);
  return json(200, { ok: true, invoice: summarize(sent) });
}

// Reduce a Stripe invoice object to the fields the admin table shows.
function summarize(inv) {
  if (!inv) return null;
  const cust = inv.customer && typeof inv.customer === "object" ? inv.customer : null;
  return {
    id: inv.id,
    number: inv.number || null,
    status: inv.status, // draft | open | paid | uncollectible | void
    customerName: (cust && cust.name) || inv.customer_name || null,
    customerEmail: (cust && cust.email) || inv.customer_email || null,
    amountDue: (inv.amount_due || 0) / 100,
    amountPaid: (inv.amount_paid || 0) / 100,
    currency: inv.currency || "usd",
    created: inv.created ? inv.created * 1000 : null,
    dueDate: inv.due_date ? inv.due_date * 1000 : null,
    hostedInvoiceUrl: inv.hosted_invoice_url || null,
    invoicePdf: inv.invoice_pdf || null,
    description: inv.description || null,
  };
}

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
