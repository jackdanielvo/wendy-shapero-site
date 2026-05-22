#!/bin/bash
# Admin Photos: cross-list drag — drag a subject onto a different
# category to move it (photos travel with it), drag a photo onto
# a different subject (same category) to move it.
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
        netlify/functions/admin-photos-publish.js \
        push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin Photos: cross-list drag (subject→category, photo→subject)

Wendy can now reorganize across the category boundary without
touching code:

  - Drag a subject from the Subjects pane onto a different
    category in the Categories pane → the whole subject (with
    all its photos) moves to that category. Source/target
    categories renumber their subjects automatically. Active
    selection follows the moved subject so she can see where
    it landed.

  - Drag a photo from the Photos pane onto a different subject
    in the Subjects pane → the photo moves to that subject
    (within the current category for now — cross-category
    photo moves use the subject-move path).

Both are wired via native HTML5 drag-and-drop with custom MIME
types (application/wendypix-subject, application/wendypix-photo)
so SortableJS's within-list reorder is unaffected and the two
drag systems don't compete for events.

The big plumbing change is on the server-side: subjects now
carry an originalCategory pointer that survives cross-category
moves. The publish function uses it to find the old blob path
when computing tree changes (rename via existing blob SHA at
new path + delete the old). Without this, moving a subject
across categories would 'cannot find original blob' on every
photo.

  - admin.js loadPhotos(): each subject record gains
    originalCategory = the category folder it loaded from.
  - admin.js renderPhotos(): native DnD handlers attached to
    category li (drop target for subjects) and subject li (drop
    target for photos, drag source for cross-cat subject move).
  - admin.js recountPending(): cross-category move counts as 1
    change. The kept-original-paths set used for delete-by-
    omission detection uses subj.originalCategory instead of
    cat.originalFolder so original photo paths are matched
    correctly even after a subject move.
  - admin.js publishPhotos(): includes originalCategory per
    subject in the POST payload.
  - admin-photos-publish.js: builds oldCatFolderForSubj from
    subj.originalCategory, then uses it instead of the
    enclosing category's oldCatFolder when constructing each
    photo's source path. Rename detection and deletion logic
    continue to work via newPathsTouched / existingPhotoPaths
    so cross-cat moves clean up the old location automatically.

UI feedback: drop targets get a teal outline + tinted background
(.is-drop-target) while a compatible drag is over them. Drag
source gets .is-dragging for a faded look during the operation.

Cross-category photo move is out of scope for this commit (you
can't see two categories' subjects at once in the current UI).
For now Wendy can move whole subjects to migrate photos
en masse; cross-cat single-photo move can land later if needed.

Cache busters bumped: admin.css and admin.js to
v=2026-05-22-crossdrag."
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
