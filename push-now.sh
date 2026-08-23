#!/bin/bash
# Admin Photos: smooth out drag UX + add subject delete.
set -uo pipefail

cd "$(dirname "$0")" || exit 1

echo "=== Working in: $(pwd) ==="
echo ""

echo "=== 1. Removing stale .git/index.lock (if any) ==="
if [ -e .git/index.lock ]; then
  if rm -f .git/index.lock 2>/dev/null; then
    echo "    ok"
  else
    sudo rm -f .git/index.lock || { echo "    sudo failed - STOP"; exit 2; }
    sudo chown -R "$(whoami):staff" .git
  fi
else
  echo "    (no lock - fine)"
fi
echo ""

echo "=== 2. Current state ==="
git status --short
echo ""

echo "=== 3. Staging files ==="
git add admin.js admin.html admin.css \
        netlify/functions/admin-photos-publish.js \
        netlify/functions/admin-codes.js \
        netlify/functions/redeem-code.js \
        netlify/functions/_codes.js \
        netlify/functions/book.js \
        netlify/functions/stripe-webhook.js \
        netlify/functions/packages.js \
        netlify/functions/_addons.js \
        netlify/functions/addons.js \
        netlify/functions/admin-addons.js \
        push-now.sh index.html styles.css \
        book.html book.js book.css \
        pricing.html
echo "    staged"
echo ""

echo "=== 4. Committing ==="
# Heredoc with SINGLE-QUOTED delimiter ('EOF') disables ALL bash
# expansion inside the message. Without this, dollar-sign prices like
# "$4,800" get interpreted as positional param $4 and error out under
# `set -u` with "$4: unbound variable". Piped into `git commit -F -`
# so git reads the message straight from stdin — no shell escaping
# needed for apostrophes, backticks, quotes, dollars, or anything else.
git commit -F - <<'EOF'
Admin Photos + Site: re-baseline, IG reminder, mobile close, influencer codes

Four changes:

A) RE-BASELINE STATE AFTER PUBLISH (fix 'Tree changed')

Wendy was hitting 'Tree changed since you loaded it' on
multi-edit sessions and her changes weren't taking effect.

ROOT CAUSE: photosState.commitSha was set once at load
time and never updated after a successful publish. So:

- First publish in a session → SHA matches → 200 OK.
- The publish creates a new commit on GitHub, but the
  client keeps holding the OLD commitSha.
- Second publish → server compares manifest SHA to ref
  HEAD → mismatch → 409 'Tree changed'.

Plus a deeper issue: originalFolder/originalFile pointers
also reference load-time paths. After a publish, blobs
on GitHub are at NEW paths, so the next publish's blob
lookup ('find blob at originalFile path') would fail
with 'Cannot find original blob' even if commitSha
were fixed.

FIX: after a successful publish, walk photosState and
re-baseline every pointer to match what was just
published — commitSha, originalFolder, originalFile,
originalCategory. Uploads get their uploadKey cleared
since the bytes are now a real GitHub blob. photosOriginal
is reset so recountPending() reads 0 against the new
baseline.

DISPLAY: introduced displayFolder/displayCategory/displayUrl
pointers that snapshot the LOAD-TIME tree paths and are
NEVER mutated mid-session. The admin grid's <img src> uses
displayUrl so it keeps showing photos from the still-live
Netlify deploy (the rebuild takes 1-3 min after a publish).
Wendy refreshes manually to re-snapshot.

SAFETY NET: also added a server-side fallback — if the
blob lookup at originalFile-path fails, try the newPath.
Covers any edge case where client pointers don't match
server reality (e.g. session interrupted mid-publish).

Cache busters: admin.js + admin.css v=2026-05-24-rebaseline.

B) INSTAGRAM REMINDER EMAIL ON NEW SUBJECT

After publishing any brand-new subject (added via the
admin's '+ New subject' button), Wendy gets an email with
the lead photo attached + a category-aware suggested
caption + hashtag set. She saves the attachment to her
camera roll and posts to IG manually — Path C from the
design discussion: no Meta API setup, no Zapier dependency,
no token refresh tax. The email fires from
netlify/functions/admin-photos-publish.js after the
GitHub commit lands. Best-effort: a Resend failure logs
but doesn't fail the publish response. Detection signal:
subj.originalFolder is null for a freshly-added subject
(client convention) — renames don't trigger this. Reuses
RESEND_API_KEY and WENDY_EMAIL env vars that the inquiry
form already needs.

C) PROMINENT MOBILE CLOSE BUTTON ON SHOOT VIEW

Users on phones were complaining that the X-only close
button at the top-left of the photo-set takeover was too
easy to miss against bright photos. The desktop circular X
is fine, but on mobile we now morph the button into a solid
filled pill that reads '× CLOSE' in white on accent — bigger
(44pt min touch target), with a soft shadow for separation,
and bold uppercase Inter so it reads as the takeover's
clear exit. Achieved without an HTML restructure: the
markup gained a hidden 'Close' span (desktop hides it) plus
a wrapped X glyph so the existing rotate-on-hover stays
intact. styles.css cache buster bumped to v=2026-05-25-closebtn.

D) INFLUENCER DISCOUNT CODES

Wendy can now assign percentage-off codes to specific
influencers from Admin -> Discounts. Each code:

- Is auto-generated (7 chars, unambiguous alphabet — no O/0
  or I/1) and unique.
- Applies to the FULL package price (not just deposit) so
  the influencer promises a real 20% off, not a nominal one.
  Deposit is 25% of the discounted total, balance follows.
- Has an optional term limit (good through date) and
  optional usage cap (good for the first N bookings).
- On create, we auto-email the influencer via Resend with
  the code text + an inline QR code (image via public
  api.qrserver.com, no npm dep) that points to
  wendypix.com/book?promo=CODE. Followers who scan the QR
  land on the booking page with the code pre-applied.
- Records a full audit log per code (who booked, when,
  what package, dollar discount) — visible in admin.
- Deactivate keeps the audit log but blocks future use;
  Delete purges the record entirely.

Client-side flow:
- book.html gains a Promo code field in step 3 with Apply
  button. ?promo=CODE URL param auto-fills + validates.
- book.js calls /api/redeem-code to preview the discount
  BEFORE submit, updates the deposit note in real time.
- book.js (server) revalidates the code at submit time
  (server-side source of truth is Netlify Blobs), applies
  discount to Stripe Checkout deposit + booking metadata.

Wendy notifications:
- Every redemption fires a dedicated 'Code X used by client
  Y' email showing sticker-vs-paid price + uses remaining +
  which influencer drove the booking. Fires on both the
  Stripe (webhook) and manual paths.

New files:
- netlify/functions/_codes.js      shared storage + validation
- netlify/functions/admin-codes.js CRUD + welcome email
- netlify/functions/redeem-code.js public price-preview endpoint

Modified:
- netlify/functions/book.js         validates + applies + logs
- netlify/functions/stripe-webhook.js records redemption on paid
- admin.html, admin.js, admin.css   new Discounts tab + QR modal
- book.html, book.js, book.css      promo input + preview UI

Env vars: no new secrets — reuses RESEND_API_KEY and
NETLIFY_API_TOKEN. QR generation uses the public
api.qrserver.com service (no key needed).

Cache busters bumped:
- book.css v=2026-05-26-promo
- book.js  v=2026-05-26-promo
- admin.css v=2026-05-26-discounts2
- admin.js  v=2026-05-26-discounts2

Follow-up 1: influencer email is OPTIONAL. Blank email means
no welcome email fires and the Resend button is hidden on
that row.

Follow-up 2: QR CODES REMOVED. Turned out to be confusing
for followers scanning them. Replaced with:
- Plain-text codes (unchanged from before — Wendy shares
  by texting/DMing/posting to IG).
- Two row actions: Copy code (grabs 'SARAH20') and Copy
  link (grabs 'wendypix.com/book?promo=SARAH20', which
  auto-fills the code when tapped).
- Welcome email simplified to just the code text + the
  direct link — no image attachment.
- Removed the QR modal, api.qrserver.com fetch, related
  CSS. No new external service dependency.

Cache busters bumped to v=2026-05-27-noqr on admin.css +
admin.js.

Follow-up 3: /pricing PAGE NOW HONORS ADMIN EDITS.

Bug report: 'Wendy is trying to update prices on Admin,
hits save, gets a confirmation, but nothing changes on
the actual website.' Root cause: the three headshot rate
cards on /pricing were hardcoded HTML. Admin writes to
/api/packages (used by /book) but /pricing never read
that endpoint — so admin edits updated /book correctly
but /pricing kept showing the old numbers.

Fix:
- pricing.html: wrapped the three headshot rate cards in
  an id'd container. Static markup stays as a fallback
  so the page always shows prices even if JS/network is
  down. An inline script at the bottom fetches
  /api/packages?t=<ms> with cache: no-store and rebuilds
  the cards from admin data. Filters on id starting with
  'headshot-' and inquiry:false so lifestyle/event
  packages don't try to render here.
- netlify/functions/packages.js: cache TTL dropped from
  60s to 10s so admin verification loops are snappier.
- book.js: matching ?t=<ms> cache-buster on its
  /api/packages fetch so /book reflects edits on the
  very next reload too.

STILL HARDCODED on /pricing (not managed by admin):
- Add-ons ledger under Headshots (retouched image $45,
  additional half-hour $150, HMUA $200, usage license
  $250-$750).
- Lifestyle & commercial ledger ($1,500 / $2,800 /
  $4,800+).
- Event coverage ledger ($350/hr / $400/hr / half-day
  $1,800 / full day $3,800).
- Travel ledger (mileage $0.85/mi, travel time $175/hr,
  same-day previews $250).

These sections aren't in the admin data model (only the
5 top-level packages are). Editing them requires opening
pricing.html directly. If Wendy needs an admin form for
them too, that's a separate follow-up.

Cache busters bumped:
- book.js  v=2026-05-27-pkgcache
- book.css v=2026-05-27-pkgcache
- (pricing.html isn't fingerprinted — served fresh by
  Netlify's default HTML cache headers)

Follow-up 4: ADD-ONS ARE NOW ADMIN-EDITABLE.

The Add-ons ledger under Headshots on /pricing was
hardcoded HTML (4 rows: extra image, half-hour, HMUA,
usage license) and the HMUA checkbox on /book was
hardcoded with a fixed $200 price. Any edit required
touching the HTML directly.

New: Admin -> Add-ons tab lists every add-on with
editable label, price, optional display override (for
ranges like $250-$750 or non-numeric like "Included"),
and a Bookable toggle. Rows can be added, edited,
deleted; a Reset-to-defaults button restores the original
four. All changes go live on /pricing and /book within
seconds of saving.

Any row with Bookable ticked becomes a checkbox on the
/book details form. Client sends the ticked add-on ids;
server looks up each id in the addon store to get the
authoritative price (client-supplied prices are ignored,
so a manipulated payload can't lie about how much HMUA
costs). Prices sum into the effectivePrice used for the
Stripe deposit + all confirmation emails + the calendar
event body. Add-ons are added AFTER any promo-code
discount, so influencer codes discount the package only
(not the add-ons) - matches typical influencer-marketing
intent.

New files:
- netlify/functions/_addons.js         data model + helpers
- netlify/functions/addons.js          public GET
- netlify/functions/admin-addons.js    auth CRUD

Modified:
- admin.html, admin.js, admin.css      new Add-ons tab
- pricing.html                         live ledger fetch
- book.html                            generic addons row
- book.js                              fetch + render checkboxes
- netlify/functions/book.js            resolve prices + emails

Cache busters bumped:
- admin.css v=2026-05-28-addons
- admin.js  v=2026-05-28-addons
- book.js   v=2026-05-28-addons
- book.css  v=2026-05-28-addons
EOF
echo ""

echo "=== 5. Pulling latest from origin ==="
git pull --rebase origin main || {
  echo "    pull failed - resolve conflicts then re-run"
  exit 3
}
echo ""

echo "=== 6. Pushing ==="
git push
echo ""

echo "=== DONE - watch Netlify deploy log ==="
