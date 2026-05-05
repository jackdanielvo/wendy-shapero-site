# CLAUDE.md — context for any future Claude session

This file exists so a fresh Cowork session can pick up where the last one left off without re-deriving everything from scratch. **Read this first** before making changes. Keep it updated when you complete major work.

---

## Project at a glance

A static photography portfolio for **Wendy Shapero** (LA-based photographer), branded as **WendyPix**. Modeled visually on [spencergabor.work](https://spencergabor.work) (editorial layout, hero card row, big display type). Site lives at:

- **Repo**: `https://github.com/jackdanielvo/wendy-shapero-site`
- **Live**: `https://jackdanielvo.github.io/wendy-shapero-site/` (custom domain `wendypix.com` planned)

## Who's who

- **Wendy** is the client — she'll use the site day-to-day to show off her work.
- **Jack** (`jack@voiceofjack.com`, GitHub `jackdanielvo`) is implementing the site on her behalf via Cowork. He's not a developer, so commands need to be spelled out clearly. He hates JSON editing.
- Wendy hasn't touched the code directly. She edits in Pixieset (currently being deprecated — see below).

## Where the project lives locally

Probably moving to `/Volumes/Hub SSD 2TB/Wendypix photo folders/wendy-shapero-site/`. If Cowork's working folder is somewhere else, the user moved it again — just adapt.

---

## ⚠️ CURRENT STATE OF PLAY (the most important section)

**We're mid-refactor: dropping Pixieset, switching to local photo storage.**

### Why we're abandoning Pixieset

After dozens of hours fighting it:

- Pixieset's `/client/loadphotos/` API works from a browser but **403s any cloud IP** (GitHub Actions runners, server-side scrapes). Browser User-Agent spoofing didn't help — it's TLS fingerprinting.
- Pixieset's "Highlights" filter caps the public API at the highlighted subset (~8 photos per shoot in our tests), even when the gallery has hundreds.
- Result: every workflow run was a fresh battle. Scraping kept overwriting editorial data with legacy 118-shoot data, requiring repeated `-X ours` rebases.

### The new plan

**Photos live in the repo**, in folders named after category slugs:

```
photos/
├── headshots/
│   ├── 01-craig.jpg
│   ├── 02-anissa.jpg
│   └── ...
├── headshots-men/
├── lifestyle/
├── kids-and-families/
├── events/
├── portraits/
└── products/
```

A small `scripts/build-photos.js` walks the `photos/` tree, lists each folder's image files (alphabetical), and writes `data/photos.js` — same format the runtime already understands. The workflow runs the build script on every push instead of the Pixieset sync.

**No more network calls in the build pipeline. Everything is deterministic from the file tree.**

### What's done

- Editorial-mode runtime (`script.js`) renders one Spencer-style carousel section per category. Tap any photo → opens the full set in the existing fullscreen shoot viewer.
- `categories` field in `data/photos.js` gates editorial mode (non-empty array → editorial; null → legacy "all shoots" grid).
- `pixieset.config.json` has the `categories` schema in place.
- Design language (Helvetica + grayscale + plum-accented WENDYPIX) is locked in.

### What's NEXT (start here)

1. **Strip Pixieset**: delete `scripts/sync-pixieset.js` and the editorial-mode branches inside it. Remove the workflow's "Sync from Pixieset" step.
2. **Create folder structure**: `photos/<slug>/` for each category in `pixieset.config.json` → `categories`.
3. **Move the `headshotsmen` test photos** out of `data/photos.js` (they're hand-scraped, hard-coded URLs). Wendy should download those originals from her Pixieset and drop them into `photos/headshots-men/`.
4. **Write `scripts/build-photos.js`** — walks `photos/`, alphabetical sort, writes `data/photos.js`. ~30 lines.
5. **Update workflow** to run `node scripts/build-photos.js` instead of the sync.
6. **Update README** with the new "drop photos in folder, run `git shipit`" workflow.
7. **Decide image sizing**: manual (Wendy resizes before drop) vs auto (build script uses `sharp` to resize). Default to manual for simplicity; add auto later if she asks.
8. **Decide what to do with `admin.html`** — it edits Pixieset config (featured slugs, hidden shoots, hero photo picker). In local-photo mode some of that becomes redundant. Easiest: keep it for now, use only for hero photo picker (still useful — lets Wendy pick which photos appear in the hero card row from any of her local photo folders).

---

## Design decisions (locked in unless the user asks)

- **Title**: "WENDYPIX" wordmark, uppercase, **Helvetica regular weight 400** (not bold). Letter-spacing -0.03em, line-height 0.82. WENDY in `var(--ink)` (#0c0c0c), PIX in plum `#b347b9`. Same proportions as JACK DANIEL on jackdanielvo.com.
- **Section headers**: Helvetica regular, ALL CAPS, -0.02em tracking. Same look across "FEATURED WORK", "ALL SHOOTS, TAKE A LOOK", "CONTACT".
- **Body**: Inter for everything; Instrument Serif italic for the bio passages.
- **Color palette**: blacks and grays only, plus the plum accent. NO coral, NO multicolor SVG title (Wendy explicitly asked to revert from those — she wants restraint so the photos carry the color).
- **Hero card row**: 5 fanned photo cards under the title with continuous wander animation + spring-to-mouse on desktop. On mobile (≤640px) it converts to a horizontal scroll-snap carousel that swipes. Each card is tappable (opens the corresponding shoot OR a fullscreen lightbox if it's a URL-pinned card).
- **Featured Work carousel pattern** (Spencer-style): focal tile centered with a label pill below, flanking tiles peek in from each side rotated, far tiles are off-screen and faded. Click a flank rotates it in; click center opens the shoot. Mouse wheel, drag, swipe, arrow keys all advance. Edge passthrough so wheel-scrolling at the end of the carousel falls through to page scroll.
- **In editorial mode**: each category section uses the same carousel. Click any tile (focal or flank) → opens the category's full set in the existing fullscreen shoot viewer.
- **Contact**: scroll-revealed huge "CONTACT" word at the bottom, anchored at the bottom edge, scaleY animates with scroll progress. Same trick as jackdanielvo.com.
- **Page order**: Hero → (was: Featured) → About → Category sections → Contact.

## Tooling conventions

- **`git shipit`** is a per-repo alias: `git stash; git pull --rebase && git push`. Use it for every push. The stash absorbs auto-regenerated `data/photos.*` files; the rebase handles bot commits.
- **`-X ours`** on rebases: the workflow's `wendy-pix-bot` user keeps committing fresh `data/photos.js` (in the old Pixieset world). When local has a known-good editorial version, `-X ours` ensures rebase keeps local on conflict. **Don't use this casually** — only when you specifically know your version should win.
- **Never use `git stash drop` in instructions to the user** — it permanently discards stashed changes. We did this once and lost the WENDYPIX rebrand edits. Use `git stash pop` to restore, or just leave the stash sitting.
- **Don't put `# comments` in copy-paste command blocks** — Jack's terminal sometimes doesn't strip them and they get treated as args. Use prose to explain.
- **Cowork's outputs/** is scratch only — nothing the user can see. The selected workspace folder (where the repo lives) is what they actually see. Always save final files there.

## Repo files

```
wendy-shapero-site/
├── CLAUDE.md                    ← this file (you're reading it)
├── README.md                    ← user-facing docs
├── index.html                   ← page structure
├── styles.css                   ← all styling, light + dark themes
├── script.js                    ← hero motion, carousels, shoot view, lightbox
├── refresh.html                 ← one-click GitHub workflow trigger (PAT-based)
├── admin.html                   ← visual editor (featured/hero/excluded picker)
├── wendy-portrait.jpg           ← Wendy's bio photo
├── photos/                      ← (NEW) local photo categories — being set up
│   ├── headshots/
│   ├── headshots-men/
│   ├── ...
├── data/
│   ├── photos.js                ← runtime data file (auto-generated by build)
│   └── photos.json              ← legacy mirror (might be removed in refactor)
├── scripts/
│   ├── build-photos.js          ← (NEW, TODO) walks photos/, builds data/photos.js
│   ├── sync-pixieset.js         ← legacy, to be deleted in refactor
│   └── pixieset.config.json     ← categories list + display labels
└── .github/workflows/
    └── sync.yml                 ← cron + workflow_dispatch + GitHub Pages deploy
```

## GitHub setup

- Repo is `jackdanielvo/wendy-shapero-site`, public.
- GitHub Pages enabled, Source = "GitHub Actions" (Settings → Pages).
- The workflow has a `concurrency: pages-sync-and-deploy` group so admin saves serialize and don't collide.
- Jack's PAT (fine-grained) has Contents:write + Actions:write + Workflows:write, all on this repo only. Stored in his browser's localStorage on `refresh.html` and `admin.html`.

## What `admin.html` does

It's a visual editor that talks to GitHub's Contents API + workflow_dispatch endpoint. Lets Wendy:
- Curate the Featured Work carousel (drag list, add from thumbnail pool)
- Hide shoots from the main grid (toggle per shoot)
- Pick the 5 hero card photos (with cycle-through-photos-of-shoot UI + Pin-by-URL escape hatch)
- Save & rebuild → commits the config change + triggers the workflow

In editorial-mode + local-photos mode, most of this is redundant (no Featured carousel, no main grid). The hero photo picker is still useful. Decide during the refactor whether to slim admin.html down or leave it as-is.

## Recent gotchas (so you don't repeat them)

- **Don't suggest `git stash drop`** — it permanently deletes stashed work.
- **The bot commits** (`wendy-pix-bot` writing `chore(sync): refresh from Pixieset [skip ci]`) keep racing with manual edits to `data/photos.js`. The skip-ci tag prevents recursion but doesn't stop the race itself. After the local-photos refactor this disappears.
- **Pixieset 403s the runners** even with browser User-Agent. Don't waste time trying to fix that.
- **macOS sandbox** can't always delete `.git/HEAD.lock` due to permission constraints. Tell Jack to `rm -f .git/HEAD.lock` himself if it lingers.
- **The `# comment in command block` paste problem** — see the conventions section above.

## Next session jumpstart

1. Read this file and `README.md`.
2. `git log --oneline -20` to see recent commit messages — they describe each step.
3. Look at `pixieset.config.json` → `categories` for the agreed category list.
4. Check `photos/` directory state — is it set up yet, populated, etc?
5. Pick up at the "What's NEXT" list above.

---

*Last updated by Claude on 2026-05-05, just before Jack moved the project to its new external-drive home and started the local-photos refactor.*
