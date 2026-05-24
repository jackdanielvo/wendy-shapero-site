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
git add styles.css index.html book.html pricing.html admin.html book-success.html push-now.sh
echo "    staged"
echo ""

echo "=== 4. Committing ==="
git commit -m "Hero subtitle: drop comma, demote PORTRAITS & MOMENTS

Two-tier subtitle treatment, replacing the flat single-size
'PHOTOGRAPHER, / PORTRAITS & MOMENTS' line:

  PHOTOGRAPHER          <- large, ghost gray, unchanged
    PORTRAITS & MOMENTS <- smaller, brand teal, secondary

This reads as 'role / what she does' rather than a single
comma-separated phrase, which gives PHOTOGRAPHER the
headline weight it earned and lets the descriptors sit
quietly underneath.

Changes:
- index.html: drop the comma after PHOTOGRAPHER, wrap the
  second line in <span class=\"sub__tag\">
- styles.css: new .hero .sub__tag rule — inline-block,
  font-size clamp(20px, 4.2vw, 64px) (~60% of PHOTOGRAPHER),
  color #1d5e62 (brand teal — echoes BOOK in the hero nav),
  margin-top for a touch of breathing room above (parent
  line-height 0.85 would otherwise stack them too tight at
  the size delta)

Cache busters bumped to v=2026-05-24-subtag."
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
