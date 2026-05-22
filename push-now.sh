#!/bin/bash
# Admin Photos: add a "+ New subject" button so Wendy can create
# new people as she gets new clients, without anyone having to
# touch the codebase.
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
git add admin.html admin.js admin.css push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin Photos: 'New subject' button — onboard new clients

Wendy gets new clients regularly, and previously she had no way
to add a new subject (new person) to a category — only to
reorder, delete, or add photos to subjects that already existed.
A new + New subject button now sits below the subjects list in
the Photos tab.

UX flow:
1. Click '+ New subject' under the Subjects column.
2. Browser prompt asks for the name (e.g., 'Maria Jones').
3. Client-side validation:
   - Non-blank after trim.
   - No path-unfriendly characters (/, \\, :).
   - No duplicate of an existing subject in the same category
     (case-insensitive, ignoring the NN- prefix).
4. New subject is appended to the category with the next
   available NN- prefix (e.g., '04-Maria Jones'), auto-selected,
   and the photo grid shows the + tile so she can immediately
   drop photos in.
5. Pending-changes counter increments by 1 (the new subject)
   plus one per uploaded photo.
6. On Publish, the existing upload pipeline commits each new
   photo blob at photos-web/<cat>/<NN-Subject>/<NN-Subject>.jpg
   in a single GitHub commit. Git materializes the folder
   implicitly via the file paths.

Edge case: if Wendy creates a subject but publishes without
adding any photos, the subject silently vanishes — git can't
track empty folders. The status hint after creation tells her
what to do next ('Click the + tile in the photo grid to add
photos.'), and the pending counter still reflects the empty
subject so she's aware she has unfinished work.

Style: the button is a dashed-bordered, full-width, plum-leaning
teal pill, visually distinct from the photo + tile so the two
add-actions don't read as the same control.

No server-side changes needed — admin-photos-publish.js already
handles subj.originalFolder = null gracefully by falling back
to subj.folder for the upload branch (which is the only branch
that runs for a brand-new subject, since all its photos are
uploads).

Cache buster: admin.css and admin.js bumped to v=2026-05-22-newsubj."
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
