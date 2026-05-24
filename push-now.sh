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
git commit -m "WENDYPIX wordmark: tighten D-Y kerning

Inter Black gives D a near-flat right edge and Y a diagonal
that converges low-center, so the optical space between
them reads visibly wider than every other letter pair in
WENDYPIX — even with the negative letter-spacing already
applied at the .display level. Looks like a typo gap.

Fix: wrap the Y in its own <span class=\"brand-y\"> in the
HTML, then pull it back with margin-left: -0.06em in CSS.
The fix is a wrapper (not a per-letter targeting hack), so
it applies cleanly to BOTH the big animated hero wordmark
on index.html (where splitTitle further wraps each letter
in a .char span — recursion handles the brand-y wrapper
correctly) and the smaller .pricing__brand wordmark used
on book / pricing / admin / book-success.

Cache busters bumped to v=2026-05-24-dykern on all five
HTML pages."
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
