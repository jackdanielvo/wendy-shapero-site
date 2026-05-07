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
//   - PNG-safe imagery if any
//
// The visual language matches wendypix.com:
//   WENDYPIX wordmark (Helvetica Bold-ish via system stack +
//   font-weight 900 to approximate Inter Black, WENDY in ink, PIX
//   in plum #b347b9), cream #f1ece2 callout panels with plum left
//   border, heavy sans-serif headlines, plum link color.

const PLUM = "#b347b9";
const PLUM_DEEP = "#8e2c94";
const INK = "#0c0c0c";
const CREAM = "#f1ece2";
const MUTED = "#6b6b6b";
const BG = "#ffffff";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Helvetica", "Arial Black", Arial, sans-serif';

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
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT_STACK};color:${INK};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BG};opacity:0;">${escapeHtml(preheader)}</div>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${BG};">
          <!-- HEADER: WENDYPIX wordmark -->
          <tr>
            <td style="padding:0 8px 32px 8px;text-align:left;">
              <span style="font-family:${FONT_STACK};font-weight:900;font-size:28px;letter-spacing:-0.045em;line-height:1;text-transform:uppercase;">
                <span style="color:${INK};">WENDY</span><span style="color:${PLUM};">PIX</span>
              </span>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:0 8px;">
              ${body}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:48px 8px 0 8px;border-top:1px solid #ececec;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding-top:16px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};font-family:${FONT_STACK};">
                    Wendy Shapero Photography &middot; Los Angeles
                  </td>
                  ${showHomeLink ? `
                  <td align="right" style="padding-top:16px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-family:${FONT_STACK};">
                    <a href="https://wendypix.com" style="color:${MUTED};text-decoration:none;">wendypix.com</a>
                  </td>` : ""}
                </tr>
              </table>
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
 * Big bold display headline matching the site's section titles.
 * Use sparingly — once per email at most.
 */
function headline(text) {
  return `<h1 style="font-family:${FONT_STACK};font-weight:900;font-size:48px;letter-spacing:-0.04em;line-height:0.92;color:${INK};margin:0 0 24px 0;text-transform:uppercase;">${escapeHtml(text)}</h1>`;
}

/**
 * Eyebrow line above a headline — small caps plum.
 */
function eyebrow(text) {
  return `<p style="font-family:${FONT_STACK};font-weight:700;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${PLUM};margin:0 0 14px 0;">${escapeHtml(text)}</p>`;
}

/**
 * Cream callout panel with plum left stripe — for highlighting key info
 * (booking summary, deposit notice, etc.).
 */
function callout(html) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;">
    <tr>
      <td style="padding:18px 22px;background:${CREAM};border-left:4px solid ${PLUM};font-family:${FONT_STACK};font-size:16px;line-height:1.5;color:${INK};">
        ${html}
      </td>
    </tr>
  </table>`;
}

/**
 * Body paragraph — standard reading text.
 */
function paragraph(html) {
  return `<p style="font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${INK};margin:0 0 16px 0;">${html}</p>`;
}

/**
 * Two-button row for the Confirm / Decline buttons in Wendy's email.
 */
function buttonRow(buttons) {
  // buttons: array of { href, label, primary }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
    <tr>
      ${buttons.map((b) => `
        <td style="padding-right:10px;">
          <a href="${escapeAttr(b.href)}"
             style="display:inline-block;background:${b.primary ? INK : "transparent"};color:${b.primary ? BG : INK};font-family:${FONT_STACK};font-weight:700;font-size:13px;letter-spacing:0.16em;text-transform:uppercase;text-decoration:none;padding:14px 24px;border:1px solid ${INK};">
            ${escapeHtml(b.label)}
          </a>
        </td>`).join("")}
    </tr>
  </table>`;
}

/**
 * Small fine-print line under buttons, etc.
 */
function fineprint(html) {
  return `<p style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${MUTED};margin:0 0 4px 0;">${html}</p>`;
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
  // Conservative attribute escape (URLs, etc.)
  return String(s).replace(/"/g, "&quot;").replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;");
}

module.exports = {
  wrap,
  headline,
  eyebrow,
  callout,
  paragraph,
  buttonRow,
  fineprint,
  formatDate,
  escapeHtml,
  // Color constants — exposed so call sites can reuse them
  COLORS: { PLUM, PLUM_DEEP, INK, CREAM, MUTED, BG },
};
