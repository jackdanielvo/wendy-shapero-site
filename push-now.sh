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
git add styles.css script.js index.html book.html pricing.html admin.html book-success.html push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Home polish: drop category subheadings + subtitle / kerning / mobile fixes

Several home-page typography refinements bundled into one
commit since they're all sitting uncommitted:

1) CATEGORY SUBHEADINGS REMOVED
   The per-category subtitle line under WOMEN, MEN, etc.
   (e.g. 'Headshots — actors, executives, voiceover') was
   repetitive across categories and added little beyond
   what the headline + photos already say. Removed the
   render path in script.js; the subtitle data stays in
   pixieset.config.json for now in case it's wanted back.

2) HERO SUBTITLE TWO-TIER
   'PHOTOGRAPHER, / PORTRAITS & MOMENTS' → drop the comma,
   wrap PORTRAITS & MOMENTS in <span class=\"sub__tag\">.
   New CSS .hero .sub__tag rule: ~60% size, brand teal,
   letter-spacing reset (parent .display's -0.045em was
   cramping at the smaller size), and word-spacing 0.12em
   so the & has clear gaps around it.

3) WENDYPIX D-Y KERNING
   Inter Black's near-flat D right edge + Y's empty upper
   left made the D-Y pair read with a visible typo gap.
   Wrapped Y in <span class=\"brand-y\"> and pulled it back
   with margin-left: -0.06em. Applies to both the hero
   wordmark and the smaller .pricing__brand wordmark on
   book / pricing / admin / book-success.

4) MOBILE HERO NAV CLEARANCE
   .hero__mid's negative top margin (-4vh) was pulling the
   photo cards up into the RATES.CALL.BOOK. row on phones.
   Added a mobile-only override (margin-top: clamp(12px,
   3vh, 28px)) inside the existing @media (max-width: 640px)
   block. Desktop unchanged.

Cache busters: styles.css v=2026-05-24-subtag2,
script.js v=2026-05-24-nosub."
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
