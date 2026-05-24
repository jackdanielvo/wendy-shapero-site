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
git add styles.css index.html book.html pricing.html admin.html book-success.html push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Mobile home: stop hero cards from overlapping RATES.CALL.BOOK.

On desktop, .hero__mid uses a negative top margin
(clamp(-40px, -4vh, -10px)) to tuck the photo card row
up under the WENDYPIX wordmark — a deliberate editorial
overlap that reads as one composed block.

On mobile that backfires. The RATES.CALL.BOOK. hero nav
sits BETWEEN the wordmark and the card row, so the same
-4vh pull lifts the cards up into the nav row and the
two collide. From a phone you see photos sitting on top
of the colored RATES / CALL / BOOK words.

Override .hero__mid margin-top inside the existing
@media (max-width: 640px) block — clamp(12px, 3vh, 28px)
gives the cards positive breathing room below the nav
without making the home page feel airy. Desktop layout
is untouched (the override only fires below 640px).

Cache busters bumped to v=2026-05-24-mobnav on all five
HTML pages so phones with the previous CSS cached pick
up the fix on next visit."
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
