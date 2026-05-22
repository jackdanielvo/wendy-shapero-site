#!/bin/bash
# Fix cross-category drag — replace SortableJS on the subjects list
# with pure native HTML5 drag-and-drop. SortableJS was preventDefaulting
# the dragstart event when the source wasn't the grip handle, which
# killed cross-list drag before our handler could set the dataTransfer.
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
git add admin.html admin.js push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin Photos: native DnD for cross-list drag

The previous commit added cross-category drag wiring but it
didn't actually work — SortableJS calls event.preventDefault()
on dragstart when the user starts dragging from outside its
configured handle, which killed our native dragstart handler
before it could set the dataTransfer. Result: dragging a
subject from anywhere but the grip looked like nothing
happened.

Fix: remove SortableJS from the subjects list entirely and
re-implement both within-list reorder AND cross-category drop
with pure native HTML5 DnD. We now have full control: no other
library is calling preventDefault on our dragstart.

How it works:
  - Subject li: draggable=true, dragstart stashes
    JSON.stringify({catIdx, subjIdx}) into the custom MIME
    type application/wendypix-subject.
  - Subject li is also a drop target: accepts
    'wendypix-subject' (for within-list reorder) and
    'wendypix-photo' (for moving a photo into this subject).
  - Category li: dragover/drop accept 'wendypix-subject' and
    move the dragged subject between categories.

Reorder semantics: the receiving subject's index is adjusted
down by one if the dragged subject was BEFORE it (standard
splice-correction). Tested both same-cat reorder and
cross-cat moves; both work end-to-end including renumbering
and follow-the-moved-item active selection.

Photos still use SortableJS for in-grid reorder — that one
doesn't conflict because photos are dragged from anywhere on
the tile (no handle), so SortableJS doesn't preventDefault.
The photo dragstart we attach co-exists and the
'wendypix-photo' MIME makes it through to the subject drop
target.

Cache buster bumped to v=2026-05-22-crossdrag2."
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
