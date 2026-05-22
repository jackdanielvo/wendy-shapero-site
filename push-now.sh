#!/bin/bash
# Fix the GitHub 502 on /git/trees during admin publish:
#  - Shrink the request by skipping no-op tree entries
#  - Retry transient 5xx / 429 errors with backoff
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
git add netlify/functions/admin-photos-publish.js \
        netlify/functions/admin-hero.js \
        netlify/functions/admin-photos-manifest.js \
        push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Admin publish: skip no-op tree entries + retry on GitHub 5xx

Two related fixes for the 'GitHub 502 on POST /git/trees' error
that hit when trying to delete a Rene photo in /admin Publish:

1) The publish function was emitting a tree entry for every
photo in the new manifest, including those whose path didn't
change at all. With ~340 photos in the catalog, even a
single-photo delete sent ~340 tree entries to GitHub. Skip the
ones where oldPath === newPath — those are no-ops and GitHub
doesn't need to know about them. Reduces the typical payload by
1-2 orders of magnitude.

2) Wrap the gh() helper in admin-photos-publish.js,
admin-photos-manifest.js, and admin-hero.js with retry-on-5xx
logic: 3 attempts total with exponential backoff (500ms, 1s),
re-trying only on 5xx and 429. 4xx errors are our bug and don't
get retried. Network-level failures (DNS, connection reset)
also trigger a retry.

Net effect: small edits in /admin should commit fast and
reliably. Even when GitHub's tree endpoint is having a moment,
a single 502 won't fail the user-facing publish."
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
