// Shared HTML email template — wraps the body content of every
// transactional email in the same WendyPix-branded shell.
//
// Email design constraints aren't web design constraints: many
// clients (Outlook, parts of Gmail) strip modern CSS, ignore
// <style> tags, and don't apply web fonts. So we use:
//   - tables for layout (Outlook needs them)
//   - inline CSS only
//   - system font stack as fallback (Helvetica/Arial)
//   - hex colors with no calc()/min()/var()
//
// Visual language: WENDYPIX wordmark in a full-width plum hero block
// at the top, oversized Inter Black headlines, plum-filled callout
// panels with white text, large readable body type. Goal is to make
// the email feel like an extension of the wendypix.com experience —
// confident, bold, fun.

const PLUM = "#b347b9";
const PLUM_DEEP = "#8e2c94";
const PLUM_DARK = "#5a1a5e";
const INK = "#0c0c0c";
const CREAM = "#f1ece2";
const MUTED = "#6b6b6b";
const BG = "#ffffff";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Helvetica", "Arial Black", Arial, sans-serif';

// Public site URL — used to build absolute URLs for logo images and
// click-through links. Netlify auto-injects URL = the deploy's live URL
// (e.g. https://wendypix.netlify.app), or the custom domain once
// wendypix.com is wired up. Falls back to the netlify subdomain so
// emails still render before the custom domain is set up.
const SITE_URL = (process.env.URL || "https://wendypix.netlify.app").replace(/\/$/, "");

/**
 * Wrap an email body in the WendyPix branded shell.
 *
 * @param {object} opts
 * @param {string} opts.preheader  — short summary shown by inbox previews
 * @param {string} opts.body       — inner HTML (already styled inline)
 * @param {boolean} [opts.showHomeLink]  — show the "wendypix.com" footer link (default true)
 * @returns {string} full HTML document for an email
 */
function wrap({ preheader = "", body, showHomeLink = true }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <!-- Prevent email clients (especially Apple Mail iOS) from auto-
       applying dark mode color inversion, which would mute our
       bright plum + cream brand palette. -->
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <style>:root { color-scheme: light only; supported-color-schemes: light only; }</style>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${FONT_STACK};color:${INK};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};opacity:0;">${escapeHtml(preheader)}</div>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CREAM};">
    <tr>
      <td align="center" style="padding:24px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;width:100%;background:${BG};box-shadow:0 12px 48px -16px rgba(90,26,94,0.18);">

          <!-- HERO: pure-HTML WENDYPIX wordmark + tagline. Image-based
               approach kept failing (Apple Mail ignored width caps and
               rendered the PNG at native size, cropping the wordmark
               in the email column). HTML is more reliable: <h1> with
               inline CSS for modern clients, <font> fallback for
               Outlook 2007-2019 which still respects HTML 4 font tags. -->
          <tr>
            <td bgcolor="${PLUM}" align="center" style="background:${PLUM};padding:60px 24px 40px 24px;text-align:center;">
              <h1 style="margin:0 0 18px 0;padding:0;font-family:${FONT_STACK};font-weight:900;font-size:60px;line-height:60px;letter-spacing:-2.5px;text-transform:uppercase;color:#ffffff;mso-line-height-rule:exactly;">
                <font face="Helvetica Neue, Helvetica, Arial Black, Arial, sans-serif" color="#ffffff" size="7"><strong>WENDY<font color="${CREAM}">PIX</font></strong></font>
              </h1>
              <p style="margin:0;padding:0;font-family:${FONT_STACK};font-size:12px;line-height:16px;letter-spacing:4px;text-transform:uppercase;color:${CREAM};font-weight:600;mso-line-height-rule:exactly;">
                <font face="Helvetica Neue, Helvetica, Arial, sans-serif" color="${CREAM}" size="2"><strong>Wendy Shapero &middot; Los Angeles</strong></font>
              </p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:48px 40px 40px 40px;">
              ${body}
            </td>
          </tr>

          <!-- FOOTER: thin band at the bottom -->
          <tr>
            <td bgcolor="${INK}" style="background:${INK};padding:24px 32px;text-align:center;">
              <div style="font-family:${FONT_STACK};font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${CREAM};font-weight:600;">
                Photographs &copy; ${new Date().getFullYear()} Wendy Shapero
              </div>
              ${showHomeLink ? `
              <div style="margin-top:8px;font-family:${FONT_STACK};font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;">
                <a href="https://wendypix.com" style="color:#ffffff;text-decoration:none;border-bottom:1px solid ${PLUM};padding-bottom:2px;">wendypix.com</a>
              </div>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * BIG bold display headline. The hero of every email — make it count.
 * Uses <h1> rather than <div>/<p> because Outlook respects heading
 * tag styling more reliably. The mso-line-height-rule plus explicit
 * px line-height keep Outlook from collapsing the height.
 */
function headline(text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 32px 0;">
    <tr>
      <td style="padding:0;">
        <h1 style="margin:0;padding:0;font-family:${FONT_STACK};font-weight:900;font-size:78px;letter-spacing:-0.045em;line-height:78px;mso-line-height-rule:exactly;color:${INK};text-transform:uppercase;">
          <font face="Helvetica Neue, Helvetica, Arial Black, Arial, sans-serif" color="${INK}" size="7"><strong>${escapeHtml(text)}</strong></font>
        </h1>
      </td>
    </tr>
  </table>`;
}

/**
 * Eyebrow line above the headline — small caps in plum, generous
 * letter-spacing so it reads as a confident pre-title. Wrapped in a
 * table for Outlook spacing reliability.
 */
function eyebrow(text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;">
    <tr>
      <td style="padding:0;">
        <p style="margin:0;padding:0;font-family:${FONT_STACK};font-weight:800;font-size:14px;letter-spacing:0.28em;line-height:1.3;text-transform:uppercase;color:${PLUM};">
          <font face="Helvetica Neue, Helvetica, Arial, sans-serif" color="${PLUM}"><strong>${escapeHtml(text)}</strong></font>
        </p>
      </td>
    </tr>
  </table>`;
}

/**
 * Plum-filled callout panel for highlighting the key info — the
 * date, the package, the deposit. White text on plum, big and proud.
 * Uses <font> tags as the inner wrapper so Outlook respects color
 * and size on the contained text (Outlook ignores `color` set on
 * the <td> for inline content children).
 */
function callout(html) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:32px 0;">
    <tr>
      <td bgcolor="${PLUM}" style="background:${PLUM};padding:32px 36px;">
        <font face="Helvetica Neue, Helvetica, Arial, sans-serif" color="#ffffff">
          <div style="font-family:${FONT_STACK};font-size:24px;line-height:1.4;color:#ffffff;font-weight:700;">
            ${html}
          </div>
        </font>
      </td>
    </tr>
  </table>`;
}

/**
 * Subtler cream callout — for secondary info that shouldn't compete
 * with the main plum callout.
 */
function softCallout(html) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;">
    <tr>
      <td bgcolor="${CREAM}" style="background:${CREAM};padding:22px 26px;border-left:4px solid ${PLUM};font-family:${FONT_STACK};font-size:17px;line-height:1.5;color:${INK};">
        ${html}
      </td>
    </tr>
  </table>`;
}

/**
 * Body paragraph — large reading type so emails actually feel like
 * a letter, not a confirmation receipt.
 */
function paragraph(html) {
  return `<p style="font-family:${FONT_STACK};font-size:19px;line-height:1.65;color:${INK};margin:0 0 22px 0;">
    <font face="Helvetica Neue, Helvetica, Arial, sans-serif" color="${INK}" size="4">${html}</font>
  </p>`;
}

/**
 * Sign-off paragraph — slightly larger, so "— Wendy" reads as a
 * personal closing, not a footer afterthought.
 */
function signoff(html) {
  return `<p style="font-family:${FONT_STACK};font-size:22px;line-height:1.4;color:${INK};margin:36px 0 0 0;font-weight:700;">
    <font face="Helvetica Neue, Helvetica, Arial, sans-serif" color="${INK}" size="5"><strong>${html}</strong></font>
  </p>`;
}

/**
 * Bulletproof button — survives Outlook 2007-2019 mangling. Use the
 * `primary` flag for the heavy plum-filled variant; the default is
 * outlined.
 */
function buttonRow(buttons) {
  const cells = buttons.map((b) => {
    const bg = b.primary ? PLUM : BG;
    const fg = b.primary ? "#ffffff" : INK;
    const border = b.primary ? PLUM : INK;
    return `
      <td style="padding-right:14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td bgcolor="${bg}" style="border:2px solid ${border};mso-padding-alt:18px 32px 18px 32px;">
              <a href="${escapeAttr(b.href)}"
                 style="display:inline-block;padding:18px 32px;background:${bg};color:${fg};font-family:${FONT_STACK};font-weight:800;font-size:14px;line-height:1;letter-spacing:0.20em;text-transform:uppercase;text-decoration:none;mso-line-height-rule:exactly;">
                ${escapeHtml(b.label)}
              </a>
            </td>
          </tr>
        </table>
      </td>`;
  }).join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:36px 0 16px 0;">
    <tr>${cells}</tr>
  </table>`;
}

/**
 * Smaller fine-print line, for explanatory text under buttons or
 * disclaimers at the bottom of an email.
 */
function fineprint(html) {
  return `<p style="font-family:${FONT_STACK};font-size:13px;line-height:1.55;color:${MUTED};margin:0 0 8px 0;">${html}</p>`;
}

/**
 * Plum divider — a thin horizontal rule between sections of the body.
 */
function divider() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:32px 0;">
    <tr><td style="border-top:2px solid ${PLUM};font-size:0;line-height:0;height:0;">&nbsp;</td></tr>
  </table>`;
}

/**
 * Format a date for the body of an email — full weekday + LA timezone.
 */
function formatDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;").replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;");
}

module.exports = {
  wrap,
  headline,
  eyebrow,
  callout,
  softCallout,
  paragraph,
  signoff,
  buttonRow,
  fineprint,
  divider,
  formatDate,
  escapeHtml,
  COLORS: { PLUM, PLUM_DEEP, PLUM_DARK, INK, CREAM, MUTED, BG },
};
