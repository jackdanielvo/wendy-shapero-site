#!/bin/bash
# Admin publish UX: don't auto-reload after publish so the
# admin doesn't briefly show broken images during Netlify's
# 1-3 min deploy window.
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
git commit -m "Admin: don't auto-reload after publish (deploy-lag fix)

After hitting Publish on the Photos or Hero tab, the admin was
re-fetching the manifest from GitHub immediately. The manifest
reflected the just-committed state, so admin rendered photo
URLs with their NEW filenames — but Netlify hadn't rebuilt yet,
so those URLs 404'd against the still-old deployed file tree.
Result: 1-3 minutes of broken images in the admin grid and on
the live site, until the deploy went green.

New behavior:
- Photos tab Publish: don't call loadPhotos(). Zero out the
  pending counter (changes ARE committed, just not deployed),
  show 'Published. Site will redeploy in 1-3 min — click
  Refresh after that to see the latest state.'
- Hero tab Publish: same idea — sync heroOriginal to heroState
  locally so the pending pill goes to zero, but don't refetch.

User clicks the existing Refresh button when the Netlify
deploy is done. By then the live site has the new files and
the admin manifest fetch produces URLs that resolve. No
broken-image window.

Trade-off: if the user wants to verify the publish actually
landed, they need to wait + click Refresh. Worth it to remove
the confusing broken-image state.

Cache buster bumped to v=2026-05-22-deploylag."
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
