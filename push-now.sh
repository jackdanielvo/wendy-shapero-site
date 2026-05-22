#!/bin/bash
# Push the hero category label refresh — bigger and bolder so visitors
# can actually read WOMEN / MEN / KIDS & TEENS / LIFESTYLE / EVENTS
# below the hero cards.
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
git add styles.css index.html pricing.html book.html book-success.html admin.html push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Home hero: larger, bolder category labels

The labels under each hero card (WOMEN, MEN, KIDS & TEENS,
LIFESTYLE, EVENTS) were 11px / weight 700 — visually small and
easy to miss, which buried the nav affordance the cards rely on.

Bumped to:
- font-weight: 900 (Inter Black, matching the WENDYPIX wordmark)
- font-size: clamp(14px, 1.4vw, 18px) — scales from 14px on small
  desktops up to 18px on big screens
- letter-spacing: 0.12em (tightened from 0.18em so the larger
  letters don't sprawl)
- line-height: 1.1 so the label sits tight as one line
- bottom offset: -34px to -42px so it doesn't crowd the card

The container around the cards (.hero__mid) needed a bigger
bottom margin to keep the new labels from crashing into the
'PHOTOGRAPHER' subtitle below: clamp(40, 6vh, 70) →
clamp(60, 8vh, 90).

Mobile (<640px) carousel container bumped its padding-bottom
from 56px to 74px so the heavier label still fits inside the
clipped scroll area instead of getting chopped off.

Cache buster bumped to v=2026-05-22-biglabels on all five HTML
pages that load styles.css."
echo ""

echo "=== 5. Pushing ==="
git push
echo ""

echo "=== DONE - watch Netlify deploy log ==="
