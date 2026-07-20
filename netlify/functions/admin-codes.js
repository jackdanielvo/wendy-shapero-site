// Admin endpoint for discount codes.
//
// Endpoints (auth-gated via Netlify Identity):
//   GET    /api/admin-codes                    → list all codes
//   POST   /api/admin-codes                    → create a new code + email influencer
//   POST   /api/admin-codes?action=resend      → resend welcome email for existing code
//   PATCH  /api/admin-codes                    → toggle active flag
//   DELETE /api/admin-codes?code=XXX           → delete a code entirely
//
// Code generation is auto (see _codes.js). Wendy provides the influencer
// name/email, percent off, optional expiry date, optional max uses. On
// create we generate the code, save it, and email the influencer with:
//   - the code itself (they can share the string)
//   - a big QR code image that points to /book?promo=<code> (auto-fills)
// so followers can scan and land on the discounted booking page in one tap.

const { requireAuth } = require("./_auth");
const {
  listCodes,
  saveCodes,
  generateCode,
  normalizeCode,
} = require("./_codes");
const tpl = require("./_email");

const WENDY_EMAIL = process.env.WENDY_EMAIL || "wendy@wendypix.com";
const SITE_URL = (process.env.URL || "https://wendypix.netlify.app").replace(/\/$/, "");

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  try {
    if (event.httpMethod === "GET") return await handleList();
    if (event.httpMethod === "POST") {
      const params = event.queryStringParameters || {};
      if (params.action === "resend") return await handleResend(event);
      return await handleCreate(event);
    }
    if (event.httpMethod === "PATCH") return await handlePatch(event);
    if (event.httpMethod === "DELETE") return await handleDelete(event);
    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-codes] error:", err);
    return json(500, { error: err.message });
  }
};

// ---------- GET ----------
async function handleList() {
  const codes = await listCodes();
  // Sort newest first so the admin table's "just created" codes surface.
  const sorted = codes
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return json(200, { codes: sorted });
}

// ---------- POST (create) ----------
async function handleCreate(event) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const percentOff = Number(body.percentOff);
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
    return json(400, { error: "percentOff must be a number between 1 and 100." });
  }
  const influencerName = String(body.influencerName || "").trim();
  if (!influencerName) return json(400, { error: "influencerName required." });
  const influencerEmail = String(body.influencerEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(influencerEmail)) {
    return json(400, { error: "influencerEmail must be a valid email." });
  }
  let expiresAt = null;
  if (body.expiresAt) {
    const str = String(body.expiresAt).slice(0, 10); // trim any time part
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return json(400, { error: "expiresAt must be YYYY-MM-DD." });
    }
    // Reject dates already in the past (interpret in LA timezone).
    const expiryEnd = new Date(str + "T23:59:59-08:00");
    if (!Number.isFinite(expiryEnd.getTime()) || expiryEnd.getTime() < Date.now()) {
      return json(400, { error: "expiresAt is already in the past." });
    }
    expiresAt = str;
  }
  let maxUses = null;
  if (body.maxUses !== null && body.maxUses !== undefined && body.maxUses !== "") {
    const n = Number(body.maxUses);
    if (!Number.isInteger(n) || n < 1) {
      return json(400, { error: "maxUses must be a positive integer, or blank for unlimited." });
    }
    maxUses = n;
  }

  const codes = await listCodes();
  const newRecord = {
    code: generateCode(codes),
    percentOff: Math.round(percentOff),
    influencerName,
    influencerEmail,
    expiresAt,
    maxUses,
    usedCount: 0,
    redemptions: [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  codes.push(newRecord);
  await saveCodes(codes);

  // Fire-and-remember the welcome email. If Resend fails or the API key
  // isn't set, the code is still created — Wendy can hit "Resend email"
  // from the admin later.
  let emailed = false;
  let emailError = null;
  try {
    await sendInfluencerWelcome(newRecord);
    emailed = true;
  } catch (err) {
    console.error("[admin-codes] welcome email failed:", err.message);
    emailError = err.message;
  }

  return json(200, { code: newRecord, emailed, emailError });
}

// ---------- POST ?action=resend ----------
async function handleResend(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const codeStr = normalizeCode(body.code);
  if (!codeStr) return json(400, { error: "code required" });
  const codes = await listCodes();
  const record = codes.find((c) => c.code === codeStr);
  if (!record) return json(404, { error: "code not found" });
  try {
    await sendInfluencerWelcome(record);
    return json(200, { ok: true, emailed: true });
  } catch (err) {
    return json(502, { error: "Email send failed: " + err.message });
  }
}

// ---------- PATCH (toggle active, update expiry / maxUses) ----------
async function handlePatch(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const codeStr = normalizeCode(body.code);
  if (!codeStr) return json(400, { error: "code required" });
  const codes = await listCodes();
  const idx = codes.findIndex((c) => c.code === codeStr);
  if (idx === -1) return json(404, { error: "code not found" });
  const record = codes[idx];

  if (typeof body.active === "boolean") record.active = body.active;
  if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) {
    if (body.expiresAt === null || body.expiresAt === "") {
      record.expiresAt = null;
    } else {
      const s = String(body.expiresAt).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return json(400, { error: "expiresAt must be YYYY-MM-DD or null." });
      record.expiresAt = s;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "maxUses")) {
    if (body.maxUses === null || body.maxUses === "") {
      record.maxUses = null;
    } else {
      const n = Number(body.maxUses);
      if (!Number.isInteger(n) || n < 1) return json(400, { error: "maxUses must be a positive integer, or blank." });
      record.maxUses = n;
    }
  }

  await saveCodes(codes);
  return json(200, { code: record });
}

// ---------- DELETE ----------
async function handleDelete(event) {
  const codeStr = normalizeCode((event.queryStringParameters || {}).code);
  if (!codeStr) return json(400, { error: "code query param required" });
  const codes = await listCodes();
  const next = codes.filter((c) => c.code !== codeStr);
  if (next.length === codes.length) return json(404, { error: "code not found" });
  await saveCodes(next);
  return json(200, { ok: true });
}

// ------------------------------------------------------------
// Influencer welcome email
// ------------------------------------------------------------
async function sendInfluencerWelcome(record) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set — email skipped.");

  const bookingUrl = `${SITE_URL}/book?promo=${encodeURIComponent(record.code)}`;
  const qrPngUrl =
    "https://api.qrserver.com/v1/create-qr-code/?" +
    new URLSearchParams({
      size: "500x500",
      data: bookingUrl,
      margin: "10",
      // Dark plum foreground on white — matches the WendyPix accent so
      // scanned codes still feel on-brand. Falls back cleanly to black
      // if the QR service ever changes its color params.
      color: "5A1A5E",
      bgcolor: "FFFFFF",
    }).toString();

  // Fetch the QR as bytes so we can attach it inline and as a downloadable
  // file. Failing gracefully if the QR service is temporarily down —
  // the email still ships with the code text + booking URL.
  let qrBase64 = null;
  try {
    const qrRes = await fetch(qrPngUrl);
    if (qrRes.ok) {
      const buf = await qrRes.arrayBuffer();
      qrBase64 = Buffer.from(buf).toString("base64");
    } else {
      console.warn("[admin-codes] QR service returned", qrRes.status);
    }
  } catch (err) {
    console.warn("[admin-codes] QR fetch failed:", err.message);
  }

  const firstName = record.influencerName.split(" ")[0];
  const expiryLine = record.expiresAt
    ? `Good through <strong>${formatFriendlyDate(record.expiresAt)}</strong>.`
    : "No expiration date.";
  const usesLine = record.maxUses
    ? `Good for the first <strong>${record.maxUses}</strong> bookings.`
    : "No cap on uses.";

  const body =
    tpl.eyebrow("Your discount code is ready") +
    tpl.headline("You're in.") +
    tpl.paragraph(`Hey <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
    tpl.paragraph(
      `Here's your discount code to share — anyone who books with WendyPix using ` +
      `this code gets <strong>${record.percentOff}% off</strong> their session.`
    ) +
    tpl.callout(
      `<div style="font-family:monospace;font-size:34px;font-weight:800;letter-spacing:0.12em;">` +
        tpl.escapeHtml(record.code) +
      `</div>` +
      `<div style="margin-top:10px;font-size:14px;opacity:0.9;">${record.percentOff}% off any package</div>`
    ) +
    tpl.paragraph(
      `${expiryLine}<br/>${usesLine}`
    ) +
    (qrBase64
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;">
           <tr><td align="center" style="padding:20px;">
             <img src="cid:wendypix-promo-qr" alt="QR code for booking" width="240" height="240"
                  style="display:block;width:240px;height:240px;border:1px solid #eee;padding:12px;background:#fff;" />
             <div style="margin-top:10px;font-size:12px;color:#6b6b6b;letter-spacing:0.12em;text-transform:uppercase;">
               Scan or share this QR
             </div>
           </td></tr>
         </table>`
      : "") +
    tpl.paragraph(
      `Or share the direct link — it auto-fills the code so your followers just pick a package and pay:`
    ) +
    tpl.buttonRow([
      { href: bookingUrl, label: `wendypix.com/book?promo=${record.code}`, primary: true },
    ]) +
    tpl.paragraph(
      `Thanks so much for the love. Every booking that comes through your code, ` +
      `I'll get a heads-up so I can thank you properly.`
    ) +
    tpl.signoff("&mdash; Wendy");

  const emailPayload = {
    from: "Wendy Shapero <wendy@wendypix.com>",
    to: [record.influencerEmail],
    subject: `Your WendyPix discount code — ${record.percentOff}% off`,
    html: tpl.wrap({
      preheader: `Code ${record.code} — ${record.percentOff}% off any WendyPix session`,
      body,
    }),
  };
  // Attach the QR as an inline image (referenced by cid: above) so it
  // renders in the email body. Resend supports both `attachments` and
  // Content-ID for inline references — we set `content_id` matching the
  // cid: URI used in the <img src>.
  if (qrBase64) {
    emailPayload.attachments = [
      {
        filename: `wendypix-${record.code}-qr.png`,
        content: qrBase64,
        content_id: "wendypix-promo-qr",
      },
    ];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`resend ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function formatFriendlyDate(isoDate) {
  const d = new Date(isoDate + "T12:00:00-08:00");
  if (!Number.isFinite(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
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
