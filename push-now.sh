#!/bin/bash
# Push the new Hero picker tab on /admin so Wendy can swap the 5
# home-page hero photos herself without editing config files.
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
git add admin.html admin.js admin.css \
        netlify/functions/admin-hero.js \
        push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin: Hero picker tab (5 home-page card slots)

Adds a 5th admin tab — 'Hero' — that lets Wendy swap the five
photos that lead the home page (WOMEN / MEN / KIDS & TEENS /
LIFESTYLE / EVENTS) without any code edits or asking Jack.

UI: Five labelled slots in a row, each showing the current hero
photo as a 3:4 thumbnail with the subject's name underneath plus
a 'Change' button. Clicking Change opens a modal picker:
  - Category tabs across the top (Women, Men, Kids & Teens,
    Lifestyle, Events)
  - Subject thumbnails grid below, drawn from the same photos-web/
    manifest the Photos tab uses (so newly-added subjects appear
    automatically here too)
  - Click a thumbnail → modal closes, slot updates, pending-count
    increments

Publishes via PUT /api/admin-hero, which:
  - Identity-gates the call via requireAuth (same as the other
    admin endpoints)
  - Loads scripts/pixieset.config.json from GitHub
  - Updates only the heroPhotos array (other config keys preserved
    so the commit diff is minimal)
  - Commits via the GitHub Contents API (single PUT vs the
    Trees-API gymnastics of the Photos publish — config is one
    small file, no need for atomic multi-file overlays)
  - Returns the new commit SHA so the UI can reload from a fresh
    snapshot

Safety net:
  - Concurrency: the GET response includes the loaded commit SHA;
    PUT rejects with 409 if the branch has moved on since.
  - Validation: heroPhotos must be exactly 5 entries; each must be
    a slug, slug#N, or { url: 'https://...' }. Path-traversal-style
    inputs get a 400.

The picker preserves all three entry formats the build pipeline
already supports — plain slugs ('valentina'), slug#N for picking a
specific photo within a subject ('valentina#3'), and { url }
overrides for pinning arbitrary images. The picker UI only
generates plain slugs (defaults to the lead photo); the other
formats stay reachable for me when needed.

Cache buster: admin.css and admin.js bumped to v=2026-05-22-hero."
echo ""

echo "=== 5. Pushing ==="
git push
echo ""

echo "=== DONE - watch Netlify deploy log ==="
