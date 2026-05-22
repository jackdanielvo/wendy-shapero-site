#!/bin/bash
# Fix the Rebecca/Shari trailing-space bug — admin publish was
# failing on the Women category because two folder names had
# stray trailing spaces that sanitizeSegment() trimmed but the
# blob lookup couldn't reconcile. Also makes the publish function
# tolerant of future stray-whitespace cases.
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
git add -A photos-web/ \
        netlify/functions/admin-photos-publish.js \
        scripts/build-photos.js \
        index.html \
        data/photos.js data/photos.json \
        push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Fix admin publish failing on Women — trailing-space folder names

Symptom: trying to delete a Rene photo in /admin Publish returned
  'Cannot find original blob for photos-web/1-Women/15-Rebecca/01-Rebecca.jpg'
even though Rene's edit had nothing to do with Rebecca. Same
error would happen for any Women-category change — the first
blob the publish function couldn't resolve was Rebecca's.

Root cause: two folders in photos-web/1-Women had accidental
trailing spaces in their names:
  photos-web/1-Women/15-Rebecca <-- trailing space
  photos-web/1-Women/16-Shari   <-- trailing space
The admin UI displayed them trimmed (because the admin's
sanitizeSegment() trims input). When the manifest came back to
the publish function, sanitizeSegment trimmed again, but the
GitHub blob path map keyed by the LITERAL (untrimmed) path. So
every Women publish hit a 'Cannot find original blob for ...'
on the first attempt to reference a Rebecca or Shari file.

Two-part fix:

1. Rename the offending folders to drop trailing spaces:
     photos-web/1-Women/15-Rebecca <space> -> 15-Rebecca
     photos-web/1-Women/16-Shari <space>   -> 16-Shari
   Did this via git mv so history is preserved as a rename, not
   a delete+add.

2. Belt-and-suspenders: admin-photos-publish.js now indexes the
   blob lookup map by BOTH the literal path AND a segment-trimmed
   variant. So any future stray whitespace anywhere in the tree
   won't break publishes. New helper trimPathSegments() handles
   the normalization.

Also fixed a small regex bug in scripts/build-photos.js that
prevented the cache-buster substitution on subsequent runs:
the original regex required the timestamp to contain a literal
'T' separator, but the .replace() that produces the timestamp
strips T along with - and :. Switched to a looser
'?v=[\\w-]+' match so any previous token (BUILDTIME, with-T, or
without-T timestamps) gets substituted on every build.

Effect: Women-category publishes work again. Future folder
typos won't surface as cryptic blob-lookup errors. And the
data/photos.js cache buster updates reliably on every deploy."
echo ""

echo "=== 5. Pulling latest from origin (admin endpoints commit directly via the GitHub API, so the remote may have moved on without us) ==="
git pull --rebase origin main || {
  echo "    pull failed - resolve conflicts then re-run"
  exit 3
}
echo ""

echo "=== 6. Pushing ==="
git push
echo ""

echo "=== DONE - watch Netlify deploy log ==="
