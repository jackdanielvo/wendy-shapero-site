#!/bin/bash
# Push the photo-editor UX cleanup — replace the obtrusive teal
# "Drop to upload" overlay with a discoverable "+ Add" tile that
# sits at the end of the photo grid. Photos stay fully visible.
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
git commit -m "Admin Photos: '+ Add' tile, drop the overlay

The previous upload flow used a full-grid teal overlay that appeared
when files were dragged onto the photo area. Two problems:
1. A CSS rule (display:flex) was overriding the HTML [hidden]
   attribute, so the overlay was effectively always visible — the
   tile photos were obscured by a translucent teal panel.
2. Even when working correctly, covering the photo grid with an
   opaque overlay during drag-drop hid the photos Wendy wanted to
   see while arranging.

New approach: at the end of the photo grid, render an extra
.admin__photos__tile--add tile with the same dimensions as a photo
tile, a dashed gray border, and a big '+' icon with the label 'Add
photos'. Click it to open a file picker. Drop files directly on
it to upload. The tile flips to solid teal (.is-drop-target) while
a file is being dragged over it, but the rest of the photo grid is
never covered up.

Photos stay fully visible at all times. The drop affordance is
discoverable (sits inline at the end of the grid, matching the
existing visual rhythm) and the click affordance is the same
element (no separate header button competing for attention).

Implementation notes:
- The '+' tile is appended after the photo tiles every render so
  SortableJS sees it as a list child. It's excluded from drag
  via `filter: '.admin__photos__delete, .admin__photos__tile--add'`
  and pinned to the end via an `onMove` rule that returns false
  when a photo would land below it. `onEnd` also caps newIndex at
  photos.length - 1 just in case.
- Drag handlers attach to the '+' tile only, not the grid as a
  whole. dragenter/dragover/dragleave/drop track a depth counter
  to handle child-element bubbling cleanly.
- Mobile-friendly: the tile is a button-sized click target, so
  Wendy can tap it on phone/tablet to upload from camera roll.

Cache buster: admin.css and admin.js bumped to v=2026-05-22-plus-tile."
echo ""

echo "=== 5. Pushing ==="
git push
echo ""

echo "=== DONE - watch Netlify deploy log ==="
