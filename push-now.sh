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
git add admin.html admin.js admin.css push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin Photos: kill drag flicker + add subject delete

Two improvements based on user feedback after the
cross-category drag landed:

1) DRAG TARGET FLICKER FIX

When dragging a subject onto a category, the teal outline
would flash on and off as the cursor moved across the inner
spans (name, count badge). Cause: HTML5 dragleave fires on
the parent any time the cursor crosses INTO a child element,
because the cursor logically 'leaves' the parent for the
child. Then dragenter fires when over the child. Quick blink
ensues.

Standard fix: depth counter. Each dragenter increments a
counter, each dragleave decrements. The drop-target class
only gets removed when the counter reaches zero, meaning the
cursor has actually left the entire element (including all
descendants). Applied to both category drop targets (which
accept subject drops) and subject drop targets (which accept
both subject reorders and photo cross-subject moves). drop
explicitly resets the counter to 0 to handle the case where
the user releases over a child.

2) SUBJECT DELETE BUTTON

Wendy needs to remove clients who leave/age out as new ones
come in. Each subject row in the Subjects pane now has a
small circular X button on the right, hover-revealed on
desktop and always-visible on mobile (matching the existing
photo-tile delete pattern). Click → confirm dialog spelling
out the subject name and photo count → subject is removed
from working state. Any in-flight upload blob URLs in the
subject are revoked so we don't leak memory. Active selection
adjusts to stay in-bounds when the last subject is removed.

The publish endpoint already handles subject deletion
correctly via diff-by-omission: when the subject's photos
aren't in newPathsTouched, the existing-vs-new comparison
generates DELETE tree entries for all of them. So a subject
delete becomes 'N photo deletes' on commit, which is exactly
right — Git doesn't track empty folders, so the folder
disappears once its contents are gone.

Cache busters bumped to v=2026-05-22-subjdel."
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
