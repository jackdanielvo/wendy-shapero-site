#!/bin/bash
# One-shot script to push the admin Photos upload + delete feature.
# Run with:
#   bash push-now.sh
set -uo pipefail

cd "$(dirname "$0")" || exit 1

echo "=== Working in: $(pwd) ==="
echo ""

echo "=== 1. Removing stale .git/index.lock (if any) ==="
if [ -e .git/index.lock ]; then
  if rm -f .git/index.lock 2>/dev/null; then
    echo "    ok"
  else
    echo "    rm failed - trying sudo (may prompt for password)"
    sudo rm -f .git/index.lock || { echo "    sudo failed too - STOP"; exit 2; }
    echo "    ok via sudo"
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
        netlify/functions/admin-photos-publish.js \
        push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin Photos: upload + delete photos from /admin

The Photos tab in /admin gained two missing operations: deleting a
photo, and adding new photos (with automatic client-side resize).
Combined with the existing drag-to-reorder, Wendy now has the full
manage-portfolio toolkit in-browser — no Finder, no git, no me.

DELETE
  Every photo tile in the admin photo grid gets a small circular
  X button in the top-right corner (hover-revealed on desktop, always
  visible on mobile). Click → confirm → the photo is removed from
  state, the pending-changes counter increments, and the remaining
  photos in the subject renumber so 01-02-03 stays contiguous.
  Removing a still-unpublished upload also revokes its blob URL so
  we don't leak memory.

UPLOAD
  Two ways to add new photos to a subject:
  - Click '+ Add photos' next to the column header to pick files.
  - Drag JPEG/PNG files anywhere onto the photo grid. A teal
    'Drop to upload' overlay appears while the file is over the
    grid.
  Each dropped file is resized client-side via a hidden canvas to
  match Wendy's web spec (1600px long edge, JPEG q82, transparency
  flattened to white). Resulting bytes are stored as base64 in an
  in-memory map, keyed by an uploadKey that's attached to the new
  photo entry. The tile shows a teal NEW badge and the file uses
  the local blob URL for the preview so Wendy sees exactly what
  will land in the repo.

PUBLISH (server-side, netlify/functions/admin-photos-publish.js)
  Two behavior changes on the publish endpoint:
  1. Deletion is now diff-by-omission: it builds a set of every
     photo blob currently under photos-web/ in the repo, and any
     existing path that isn't represented in the new manifest gets
     a deletion entry (sha: null) in the tree commit. This single
     rule subsumes both rename-with-old-path-removal AND explicit
     deletes. The old code only tracked oldPathsTouched for photos
     it saw in the manifest with originalFile pointers, so an
     actually-deleted photo (absent from the manifest) was being
     orphaned.
  2. Safety check: if the manifest has zero photos but the repo
     has photos, the endpoint refuses with a 400 instead of
     deleting everything. Guards against an admin that failed to
     load mid-edit.

COMMIT MESSAGE
  Generated client-side from the diff:
  'Photos: 3 reorders, 2 uploads, 1 delete (Women, Lifestyle)'
  Counts each kind of change and lists the categories touched, so
  the GitHub history reads cleanly.

UI POLISH
  - Tile gains a NEW badge (teal) when it carries an uploadKey, plus
    a dashed teal outline so pending adds are visually distinct from
    already-published photos.
  - Photo grid is now relatively positioned, with the drop-zone
    overlay absolute-positioned inside it.
  - Mobile: delete button is always partially visible (no hover state
    on touch, so opacity 0.9 instead of fading in on hover).
  - Sortable filter excludes the delete button so clicking X doesn't
    initiate a drag.

CACHE BUSTERS
  admin.css and admin.js bumped to v=2026-05-22-uploads so
  returning admins re-fetch the updated assets."
echo ""

echo "=== 5. Pushing ==="
git push
echo ""

echo "=== DONE - watch Netlify deploy log ==="
