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
git add admin.js admin.html netlify/functions/admin-photos-publish.js push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin Photos: re-baseline state after publish (fix 'Tree changed' on repeat edits)

Wendy was hitting 'Tree changed since you loaded it' on
multi-edit sessions and her changes weren't taking effect.

ROOT CAUSE: photosState.commitSha was set once at load
time and never updated after a successful publish. So:

- First publish in a session → SHA matches → 200 OK.
- The publish creates a new commit on GitHub, but the
  client keeps holding the OLD commitSha.
- Second publish → server compares manifest SHA to ref
  HEAD → mismatch → 409 'Tree changed'.

Plus a deeper issue: originalFolder/originalFile pointers
also reference load-time paths. After a publish, blobs
on GitHub are at NEW paths, so the next publish's blob
lookup ('find blob at originalFile path') would fail
with 'Cannot find original blob' even if commitSha
were fixed.

FIX: after a successful publish, walk photosState and
re-baseline every pointer to match what was just
published — commitSha, originalFolder, originalFile,
originalCategory. Uploads get their uploadKey cleared
since the bytes are now a real GitHub blob. photosOriginal
is reset so recountPending() reads 0 against the new
baseline.

DISPLAY: introduced displayFolder/displayCategory/displayUrl
pointers that snapshot the LOAD-TIME tree paths and are
NEVER mutated mid-session. The admin grid's <img src> uses
displayUrl so it keeps showing photos from the still-live
Netlify deploy (the rebuild takes 1-3 min after a publish).
Wendy refreshes manually to re-snapshot.

SAFETY NET: also added a server-side fallback — if the
blob lookup at originalFile-path fails, try the newPath.
Covers any edge case where client pointers don't match
server reality (e.g. session interrupted mid-publish).

Cache busters: admin.js + admin.css v=2026-05-24-rebaseline."
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
