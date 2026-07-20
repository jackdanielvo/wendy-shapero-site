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
        push-now.sh index.html styles.css \
        book.html book.js book.css
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin Photos + Site: re-baseline, IG reminder, mobile close, influencer codes

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
- admin.css v=2026-05-26-discounts
- admin.js  v=2026-05-26-discounts"
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
