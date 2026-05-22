#!/bin/bash
# Inline inquiry form on /book — replaces the mailto: flow for
# event + lifestyle packages so clients never see the
# "Open Chrome.app?" macOS dialog.
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
git add book.html book.js \
        netlify/functions/inquiry.js \
        push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "/book: inline inquiry form for event + lifestyle packages

Previously, clicking an inquiry-only package (Lifestyle / Event
Coverage) fired a mailto: link, which on macOS spawned an
'Open Google Chrome.app?' app-launch dialog and required the
user to have an email client configured. Half-broken on mobile.

Replaced with an inline form rendered as a new step
([data-step='2-inquiry']) that visitors see right after picking
a quote-based package. Fields:
  - Name (required)
  - Email (required, validated)
  - Phone (optional)
  - Event / shoot date
  - Guest count / scope (shown only when package id/name
    matches /event/i)
  - Notes (required, the heart of the inquiry)

Submit POSTs JSON to /api/inquiry (new Netlify Function
netlify/functions/inquiry.js), which:
  - Validates server-side
  - Uses Resend (already in use for booking confirmations)
    to send a formatted email to wendy@wendypix.com with a
    Reply-To set to the client's email so she can reply
    directly from her inbox
  - Sends an automatic 'we got it' confirmation back to the
    client so they know it landed
  - Returns a friendly success message; book.js then routes
    the visitor to the existing 'You're on the list' done
    step so the visual flow is consistent with the booking
    completion path

step-navigation tweak: gotoStep() now compares step IDs as
strings instead of Number-coercing them, so the named
'2-inquiry' step plays nicely with the existing 1/2/3/4
numeric flow.

Required Netlify env: RESEND_API_KEY (already set, same key
booking uses). Optional: WENDY_EMAIL override (defaults to
wendy@wendypix.com).

book.js cache buster bumped to v=2026-05-22-inquiry."
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
