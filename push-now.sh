#!/bin/bash
# Catch-up push: the home-page buildHero() change (heroPhotos
# drives card order) never got committed, and the cross-list
# drag commit never made it to origin. This script commits the
# stragglers and pushes everything.
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

# If script.js is dirty, commit the hero-order change. Otherwise skip.
if git diff --quiet -- script.js; then
  echo "=== 3. script.js already clean — skipping commit ==="
else
  echo "=== 3. Committing the missed hero-order change in script.js ==="
  git add script.js
  git commit -m "Home hero: card order now follows heroPhotos array

The home page's buildHero() was still iterating the categories
array in fixed order — so even after the admin Hero tab gained
drag-to-reorder, the live page kept rendering the cards in
Women / Men / Kids & Teens / Lifestyle / Events order
regardless of what Wendy did in /admin.

Rewrote the resolution logic: when heroPhotosConfig is
non-empty (the admin-driven flow), iterate it IN ORDER. Each
entry resolves to a { url, subjectId }; the subject's category
determines the card's label and scroll target. Fall back to
the original categories-array iteration only when
heroPhotosConfig is empty.

Category sections below the hero still render in
categories-array order — that decoupling stays intentional.

This was supposed to ship with the admin Hero reorder commit
but the file never got staged in the original push-now.sh.
Committing it now alongside the cross-list-drag commit so the
admin reorder actually has an effect on the live page."
fi
echo ""

echo "=== 4. Pulling latest from origin ==="
git pull --rebase origin main || {
  echo "    pull failed — resolve conflicts, then 'git rebase --continue' and re-run"
  exit 3
}
echo ""

echo "=== 5. Pushing everything that's local-only ==="
git push
echo ""

echo "=== DONE — watch Netlify deploy log ==="
echo "    Expect TWO commits to appear on origin:"
echo "      - Admin Photos: cross-list drag (subject→category, photo→subject)"
echo "      - Home hero: card order now follows heroPhotos array"
