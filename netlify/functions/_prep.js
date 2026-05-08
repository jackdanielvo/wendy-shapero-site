// Sends the WendyPix Session Prep Guide as a follow-up email — fired
// ~10 minutes AFTER a booking is confirmed (either via Stripe payment
// or via Wendy clicking the manual Confirm button). Sent as a separate
// email rather than as an attachment on the confirmation email so:
//
//   1. The confirmation email lands fast and clean — no chance the
//      attachment trips a spam filter or makes the user miss the
//      core "you're booked" message.
//   2. The PDF lives at wendypix.com/shoot-prep.pdf, so the email is
//      a small HTML letter with a download link, not a 56KB
//      attachment that some corporate filters strip.
//   3. We can iterate on the prep guide PDF without redeploying any
//      code — just replace shoot-prep.pdf in the site root.
//
// Resend's `scheduled_at` API parameter handles the 10-minute delay
// server-side, so we don't need a queue or scheduled function.

const tpl = require("./_email");

// Public site URL (mirrors _email.js). Used to build the absolute
// download link for the prep guide PDF.
const SITE_URL = (process.env.URL || "https://wendypix.netlify.app").replace(/\/$/, "");
const PREP_PDF_URL = `${SITE_URL}/shoot-prep.pdf`;

// How long after the confirmation we wait before sending the prep
// email. 10 minutes feels like the right beat — long enough that the
// confirmation has clearly landed first, short enough that the client
// is still riding the post-booking glow.
const PREP_DELAY_MS = 10 * 60 * 1000;

/**
 * Send the prep guide email to a client. Idempotent at the call-site
 * level: the caller is expected to invoke this once per confirmation,
 * and we don't track sent state — Resend's idempotency is good enough
 * for this volume, and a duplicate prep email is a much smaller harm
 * than a missing one.
 *
 * @param {object} opts
 * @param {string} opts.to            — client email address
 * @param {string} [opts.name]        — client's full name (we use first name only)
 * @param {string} [opts.packageName] — package booked (used in copy)
 * @returns {Promise<void>} resolves on Resend 2xx; throws otherwise
 */
async function sendPrepEmail({ to, name, packageName }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[prep] RESEND_API_KEY missing — skipping prep email");
    return;
  }
  if (!to) {
    console.warn("[prep] no recipient — skipping prep email");
    return;
  }

  const firstName = (name || "there").split(" ")[0];
  const pkg = packageName || "your session";
  const scheduledAt = new Date(Date.now() + PREP_DELAY_MS).toISOString();

  const body = buildPrepBodyHtml({ firstName, packageName: pkg });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Wendy Shapero <wendy@wendypix.com>",
      to: [to],
      subject: `Prep for your shoot — wardrobe, hair, makeup`,
      // Resend handles the delay server-side. ISO 8601, UTC, max 30 days
      // out — we're nowhere near the limit.
      scheduled_at: scheduledAt,
      html: tpl.wrap({
        preheader: "Wardrobe, hair, makeup — everything you need before shoot day.",
        body,
      }),
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`resend prep ${res.status}: ${txt.slice(0, 200)}`);
  }
}

/**
 * Build the inner HTML body for the prep email — uses the shared
 * tpl helpers (headline / eyebrow / callout / paragraph / signoff)
 * so the look matches every other transactional WendyPix email.
 */
function buildPrepBodyHtml({ firstName, packageName }) {
  return (
    tpl.eyebrow("Pre-shoot prep") +
    tpl.headline("Let's prep.") +
    tpl.paragraph(`Hey <strong>${tpl.escapeHtml(firstName)}</strong>,`) +
    tpl.paragraph(
      `A great portrait starts long before the shutter clicks. Below are the ` +
      `wardrobe, hair, and makeup notes for your <strong>${tpl.escapeHtml(packageName)}</strong> — ` +
      `give them a skim now, and a closer read a day or two before we shoot.`
    ) +

    // Teal callout card — describes what's behind the button below
    tpl.callout(
      `The full guide.<br/>` +
      `<span style="font-size:17px;font-weight:600;opacity:0.95;line-height:24px;display:inline-block;margin-top:8px;">` +
      `Wardrobe, hair, and makeup — broken out by session type ` +
      `(business, actor, lifestyle, kids).</span>`
    ) +

    // Hero CTA — full-width plum button, oversized type, can't be missed
    tpl.bigButton({
      label: "Open the prep guide",
      href: PREP_PDF_URL,
    }) +

    tpl.divider() +

    // Wardrobe quick-hits — works for any session type
    tpl.eyebrow("Wardrobe — quick rules") +
    tpl.paragraph(
      `&bull; <strong>Vibrant primary colors</strong> photograph beautifully.<br/>` +
      `&bull; <strong>Skip</strong> whites, pastels, pinstripes, and large patterns ` +
      `(unless layering over them).<br/>` +
      `&bull; <strong>Iron or steam</strong> clothes the night before.<br/>` +
      `&bull; <strong>Bring options</strong> — two to three outfits per look. We'll edit ` +
      `down together when you arrive.<br/>` +
      `&bull; <strong>On hangers, not in a suitcase.</strong> Shoes and accessories ` +
      `in bags so we can swap looks fast.`
    ) +

    // Hair & makeup quick-hits — eyebrow text is escaped, so use a
    // literal ampersand here, not the &amp; entity (which would
    // double-escape and render as the text "&amp;").
    tpl.eyebrow("Hair & makeup") +
    tpl.paragraph(
      `Wear your hair the way you wear it 90% of the time. If hair and makeup ` +
      `are <em>included</em> with your package, come fresh-faced — our artist ` +
      `will get you camera-ready and stay for touch-ups. If they're not included, ` +
      `<strong>The Dry Bar</strong> (thedrybar.com) and <strong>Blushington</strong> ` +
      `(blushington.com) are both excellent.`
    ) +

    // Soft callout: the personal "ask me anything" note
    tpl.softCallout(
      `<strong>Stuck on wardrobe?</strong> Email or text me a few full-body ` +
      `photos of options and I'll help you finalize. Especially helpful for ` +
      `lifestyle sessions — I'd love a week's notice so we can plan together.`
    ) +

    tpl.paragraph(
      `Questions before shoot day? Text <strong>818.383.0102</strong> or email ` +
      `<a href="mailto:wendy@wendypix.com" style="color:${tpl.COLORS.TEAL};text-decoration:underline;">` +
      `wendy@wendypix.com</a>. I'm always happy to talk things through.`
    ) +

    tpl.signoff("&mdash; Wendy") +

    tpl.fineprint(
      `Can't open the link above? Paste this into your browser: ` +
      `<a href="${tpl.escapeHtml(PREP_PDF_URL)}" style="color:${tpl.COLORS.TEAL};">${tpl.escapeHtml(PREP_PDF_URL)}</a>`
    )
  );
}

module.exports = {
  sendPrepEmail,
  PREP_PDF_URL,
  PREP_DELAY_MS,
};
