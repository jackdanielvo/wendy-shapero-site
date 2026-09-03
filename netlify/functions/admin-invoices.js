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
  finalizeAndSendInvoice,
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
      if (params.action === "send") return await handleSendDraft(event);
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

  // Optional invoice-level discount. Validated here as well as in
  // _stripe.js so the admin gets a clean message rather than a raw
  // Stripe API error.
  let discount;
  const dType = String(body.discountType || "").trim();
  if (dType && dType !== "none") {
    const dValue = Number(body.discountValue);
    if (!Number.isFinite(dValue) || dValue <= 0) {
      return json(400, { error: "Enter a discount amount greater than zero, or set the discount to None." });
    }
    if (dType === "percent") {
      if (dValue > 100) {
        return json(400, { error: "A percentage discount can't exceed 100%." });
      }
    } else if (dType === "amount") {
      // A flat discount larger than the subtotal would make the invoice
      // total negative, which Stripe rejects. Catch it here with a
      // message that tells Wendy the actual subtotal.
      const subtotal = lineItems.reduce(
        (sum, l) => sum + (l.amountCents * l.quantity) / 100,
        0
      );
      if (dValue > subtotal) {
        return json(400, {
          error:
            `The $${dValue.toFixed(2)} discount is larger than the ` +
            `$${subtotal.toFixed(2)} subtotal. Lower the discount or add more line items.`,
        });
      }
    } else {
      return json(400, { error: `Unknown discount type "${dType}".` });
    }
    discount = {
      type: dType,
      value: dValue,
      label: String(body.discountLabel || "").trim() || "Discount",
    };
  }

  const memo = String(body.memo || "").trim() || undefined;
  const footer =
    String(body.footer || "").trim() ||
    "Thank you! — Wendy Shapero · wendy@wendypix.com · (818) 383-0102";

  // ---- Split deposit / balance path ----
  //
  // Rather than one invoice for the full amount, issue two:
  //   1. Deposit  — finalized + sent now, due before the shoot
  //   2. Balance  — created as a DRAFT; Wendy sends it after delivery
  //     via the "Send now" button in the admin list.
  //
  // Both carry a shared splitGroup id in metadata so the admin list can
  // pair them visually. Amounts are computed from the post-discount
  // total and the discount is baked into those figures (rather than
  // attaching the coupon to both invoices, which would double-apply
  // it). The memo spells out the breakdown so the client can see it.
  if (body.split && body.split.enabled) {
    const pct = Number(body.split.depositPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      return json(400, { error: "Deposit percent must be between 1 and 99." });
    }

    const subtotal = lineItems.reduce(
      (sum, l) => sum + (l.amountCents * l.quantity) / 100,
      0
    );
    let discountAmount = 0;
    if (discount) {
      discountAmount =
        discount.type === "percent"
          ? (subtotal * discount.value) / 100
          : discount.value;
    }
    const total = subtotal - discountAmount;
    if (total <= 0) {
      return json(400, { error: "Invoice total must be greater than zero." });
    }
    // Round the deposit to cents, then derive the balance by
    // subtraction so the two always sum exactly to the total — never
    // a stray cent from rounding both independently.
    const depositCents = Math.round(total * 100 * (pct / 100));
    const balanceCents = Math.round(total * 100) - depositCents;
    if (depositCents <= 0 || balanceCents <= 0) {
      return json(400, {
        error: "That deposit percentage leaves nothing for one of the two invoices. Adjust it.",
      });
    }

    const splitGroup = `split_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const jobLabel = memo || lineItems[0].description;
    // Itemization repeated on both invoices so the client can see what
    // they're paying toward on either one.
    const breakdown =
      lineItems
        .map((l) => `${l.description} — $${((l.amountCents * l.quantity) / 100).toFixed(2)}`)
        .join(" · ") +
      (discountAmount > 0
        ? ` · ${discount.label}: −$${discountAmount.toFixed(2)}`
        : "") +
      ` · Total $${total.toFixed(2)}`;

    // 1. Deposit — sent immediately
    const depositInvoice = await createAndSendInvoice({
      customerName,
      customerEmail,
      daysUntilDue,
      send: true,
      lineItems: [
        {
          description: `Deposit (${pct}%) — ${jobLabel}`,
          amountCents: depositCents,
          quantity: 1,
        },
      ],
      memo: `Deposit invoice 1 of 2. ${breakdown}`,
      footer,
      metadata: {
        source: "wendypix-admin",
        splitGroup,
        splitRole: "deposit",
        splitTotal: total.toFixed(2),
      },
    });

    // 2. Balance — draft, sent after the shoot
    const balanceInvoice = await createAndSendInvoice({
      customerName,
      customerEmail,
      daysUntilDue,
      send: false,
      lineItems: [
        {
          description: `Balance (${100 - pct}%) — ${jobLabel}`,
          amountCents: balanceCents,
          quantity: 1,
        },
      ],
      memo: `Balance invoice 2 of 2. ${breakdown}`,
      footer,
      metadata: {
        source: "wendypix-admin",
        splitGroup,
        splitRole: "balance",
        splitTotal: total.toFixed(2),
      },
    });

    return json(200, {
      ok: true,
      split: true,
      invoice: summarize(depositInvoice),
      balanceInvoice: summarize(balanceInvoice),
    });
  }

  // ---- Single-invoice path ----
  const invoice = await createAndSendInvoice({
    customerName,
    customerEmail,
    lineItems,
    daysUntilDue,
    discount,
    memo,
    footer,
    metadata: {
      source: "wendypix-admin",
      createdBy: "admin",
    },
  });

  return json(200, { ok: true, invoice: summarize(invoice) });
}

// ---------- POST ?action=send (finalize + send a draft) ----------
async function handleSendDraft(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const id = String(body.invoiceId || "").trim();
  if (!id) return json(400, { error: "invoiceId required" });
  const sent = await finalizeAndSendInvoice(id);
  return json(200, { ok: true, invoice: summarize(sent) });
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
  const md = inv.metadata || {};
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
    // Split deposit/balance pairing — null on ordinary single invoices.
    splitGroup: md.splitGroup || null,
    splitRole: md.splitRole || null,   // "deposit" | "balance"
    splitTotal: md.splitTotal ? Number(md.splitTotal) : null,
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
