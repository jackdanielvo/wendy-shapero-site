# Wendy Shapero — Photography Portfolio

A static photography portfolio site for Wendy Shapero, inspired by the editorial layout of [spencergabor.work](https://spencergabor.work) and tuned for photography. Auto-syncs from Wendy's Pixieset.

## Files

```
wendy-shapero-site/
├── index.html                   ← page structure
├── styles.css                   ← all styling, light + dark themes
├── script.js                    ← hero animation, grid, filters, shoot view
├── refresh.html                 ← one-click "Refresh now" tool
├── admin.html                   ← visual editor: pick featured shoots, hide shoots
├── wendy-portrait.jpg           ← (you add this — bio photo of Wendy)
├── data/
│   └── photos.js                ← auto-synced from Pixieset
├── scripts/
│   ├── sync-pixieset.js         ← the sync script
│   └── pixieset.config.json     ← which Pixieset URL + category rules
└── .github/workflows/
    └── sync.yml                 ← cron + workflow_dispatch + GitHub Pages deploy
```

## Run it locally

Open `index.html` in any browser. No build step.

```bash
open index.html        # macOS
```

## How the auto-sync works

Wendy uploads photos to a public Pixieset collection — that's it. Within hours, the new shoot appears on the site:

1. **GitHub Actions cron** (`sync.yml`) runs every 4 hours.
2. The action fetches `wendypix.pixieset.com`, discovers every public collection, hits Pixieset's `/client/loadphotos/` JSON API for each, and writes the result to `data/photos.js`.
3. If anything changed, it commits the file. GitHub Pages (or your hosting platform) auto-deploys the new build.
4. The site loads `data/photos.js` on page load — fully static, no runtime API calls.

If `data/photos.js` is missing, the site silently falls back to a built-in dataset (Wendy's existing wendypix.com Krop photos), so it never breaks.

### Run the sync manually

```bash
node scripts/sync-pixieset.js
```

That regenerates `data/photos.js` from Pixieset. Commit and push to deploy.

### "Refresh now" — one-click manual sync

Open `refresh.html` in your browser. The first time, you enter:
- The GitHub repo (e.g., `wendyshapero/portfolio-site`)
- A fine-grained Personal Access Token from `github.com/settings/tokens?type=beta` with **Actions: write** permission on this repo only.

Both are stored in your browser only (localStorage). After that, you bookmark the page and click one button to trigger an immediate rebuild — the site is live again in about 2 minutes.

The cron also keeps things current automatically, so this is just for when you can't wait.

### `admin.html` — the visual editor (no JSON required)

For day-to-day curation, open `admin.html` instead of editing `pixieset.config.json` by hand. It loads every synced shoot with thumbnails and gives you two simple controls:

- **Featured Work carousel** — search the shoot library, click any shoot to add it to the carousel. Reorder with up/down arrows. Click ✕ to remove. The list at the top of the page is the live order.
- **Hide from main grid** — click any shoot to hide it from the "All Shoots" grid. Click again to bring it back. Hidden shoots stay synced from Pixieset, they just don't appear on the home page.

A sticky bar at the bottom shows what changed; click **Save & rebuild** and the page commits the change to `pixieset.config.json` in your repo and triggers the sync workflow. Site is live in about two minutes.

Setup is the same as `refresh.html` — repo + GitHub PAT in localStorage — but the token needs **two** fine-grained permissions on this repo:
- **Contents: write** (so admin.html can commit config changes)
- **Actions: write** (so it can trigger the rebuild after saving)

If you already have a `refresh.html` token, just edit it on GitHub and tick "Contents: write" — the same token then works for both pages. The token never leaves your browser; admin.html only sends it to api.github.com.

## The Pixieset bio photo

The About section expects a photo of Wendy at `wendy-portrait.jpg` in this folder. While it's missing, the site shows a friendly "Drop wendy-portrait.jpg in this folder" placeholder. To add the photo:

1. Drag a JPG of Wendy (4:5 portrait works best) into this folder.
2. Rename it to exactly `wendy-portrait.jpg`.
3. Refresh the browser. Done.

To change the path or filename, edit the `<img id="aboutPhoto" src="...">` line in `index.html`.

## Picking the hero photos (the 5 cards at the top)

The 5 cards floating at the top of the page default to lead photos from up to 5 different categories. To **hand-pick** them, edit `heroPhotos` in `scripts/pixieset.config.json`:

```json
{
  "heroPhotos": [
    "kellykellykelly",
    "audreyandevelynbernie",
    "dylangrace#2",
    "anissahickey",
    { "url": "https://images.pixieset.com/.../some-photo-xlarge.jpg" }
  ]
}
```

Each entry can be:
- `"slug"` — uses the **first** photo of that shoot (Wendy's hero shot for Kelly Kelly Kelly, etc.)
- `"slug#3"` — uses the **4th photo** (0-indexed) of that shoot, when the lead photo isn't the strongest one
- `{ "slug": "...", "index": 3 }` — the same thing in object form
- `{ "url": "https://..." }` — pin any URL directly (useful if Wendy wants a portrait that's not in the public Pixieset feed)

Order in the array = order on screen, left to right. The list can be 3 to 5 entries; if fewer than 5, the auto-picker fills the rest.

After editing, click **Refresh now** (or run `node scripts/sync-pixieset.js`) and the new heroes are live.

## Picking which shoots are in the grid (and which photo is the thumbnail)

The main "All Shoots, Take a Look" grid defaults to showing **every** synced Pixieset shoot, in a stable shuffled order, with each shoot's first photo as the thumbnail. Three optional knobs in `scripts/pixieset.config.json` give you full control:

```json
{
  "gridShoots": ["kellykellykelly", "audreyandevelynbernie", "dylangrace"],
  "excludeShoots": ["old-test-shoot"],
  "leadPhotos": {
    "kellykellykelly": 4,
    "audreyandevelynbernie": "audreyandevelynbernie#2",
    "dylangrace": { "url": "https://images.pixieset.com/.../dylan-portrait-xlarge.jpg" }
  }
}
```

- **`gridShoots`** — allowlist of slugs in the order they should appear in the grid. Empty array (the default) means "show every synced shoot, shuffled". Slugs that aren't in the synced data are silently skipped, so you can prep the list before a shoot lands.
- **`excludeShoots`** — blocklist of slugs to hide. Applied *after* `gridShoots`, so it works whether you're in allowlist mode or showing everything. Useful for "all shoots except a few".
- **`leadPhotos`** — per-shoot thumbnail override. Each value can be:
  - a **number** (`4`) → use the photo at that zero-based index in the shoot
  - a **`"slug#N"`** string → same thing in string form
  - a **`{ "url": "..." }`** object or a bare URL string → pin any image as the thumbnail

After editing, click **Refresh now** (or run `node scripts/sync-pixieset.js`) and the changes are live in about two minutes.

## Picking which shoots are "Featured"

By default, the Featured Work section is **hidden** and every shoot flows into the main "All Shoots, Take a Look" grid below — that's the "show all the galleries" behavior.

To **curate a Featured Work section** (a few standout shoots that get the editorial treatment up top), edit `scripts/pixieset.config.json`:

```json
{
  "featured": ["kellykellykelly", "audreyandevelynbernie", "dylangrace"]
}
```

The slugs are the URL keys from Pixieset (the part after `wendypix.pixieset.com/`). Up to three render in a row at desktop sizes, with subtle rotated tiles. The order in the array is the order they appear. Re-run the sync (or click "Refresh now") and the change goes live.

Leaving `featured` empty means the Featured section stays hidden — Wendy just uploads to Pixieset and everything appears below.

## Tweaking the Pixieset config

`scripts/pixieset.config.json` controls how Pixieset content is mapped into site categories:

```json
{
  "homepage": "https://wendypix.pixieset.com/",
  "extraCollections": ["a-collection-not-on-the-homepage"],
  "defaultCategory": "events",
  "categoryRules": [
    { "match": "headshot",  "category": "headshots" },
    { "match": "kid",       "category": "kids" },
    { "match": "wedding",   "category": "events" }
  ]
}
```

Each rule's `match` is a substring tested against the slug + title (case-insensitive). The first match wins; if nothing matches, the subject gets `defaultCategory`. Add new rules whenever you want a new collection style to land in a specific filter.

## Design notes

- **Hero** mirrors Spencer Gabor's structure: tiny bold-caps location/email at top, massive uppercase name, a row of fanned portrait cards, a light-grey display subtitle, and an "Available for" service line. The cards have a continuous Spencer-style floating motion driven by a `requestAnimationFrame` loop — each card's `--ox`, `--oy`, `--rot` CSS variables are updated every frame and consumed by CSS `translate` / `rotate` properties.
- **About** is a two-column layout: portrait on the left, italic Instrument-Serif bio on the right. Stacks on mobile.
- **Featured Work** — Spencer-style click-to-rotate carousel. The focal tile sits centered with a label pill below it; flanking tiles peek in from each side, slightly rotated. Click a flank to rotate it into focus; click the focal tile to open the shoot. Arrow keys navigate. Dots underneath show position. Hidden when `featured` in `pixieset.config.json` is empty.
- **All Work** — uniform 4:5 grid (3 columns desktop, 2 tablet, 1 mobile) with category filters auto-built from whatever categories the loaded data contains. Tiles do a continuous gentle bob (staggered phase per tile) and lift with a slight rotation on hover, echoing the hero cards' rubbery feel. Click any thumbnail and you get a full-screen **shoot view** (top bar, large image(s), prev/next subject navigation, booking CTA), URL-routed via `#/shoot/{slug}` so each shoot is shareable.
- **Contact** ends with a giant outlined "CONTACT" word, mirroring Spencer's footer.
- **Theme toggle** in the top right — light / dark — saved to localStorage.

## Brand colors

- Black ink: `#0c0c0c`
- Off-white background: `#ffffff` / `#f3f3f1`
- Coral pink accent: `#ff6b6b` (matches Wendy's existing branding)

## Deploy

The workflow auto-deploys to **GitHub Pages**. To use it:

1. Push this folder to a GitHub repo.
2. In repo Settings → Pages, set Source to "GitHub Actions".
3. Add a custom domain (e.g., `wendypix.com`) in the Pages settings.

Other one-click options:

| Platform | How |
|---|---|
| **Netlify** | Drag this folder onto [app.netlify.com/drop](https://app.netlify.com/drop). Netlify also has a "Build hook" URL you can replace `refresh.html`'s GitHub call with — even simpler. |
| **Vercel** | `npx vercel` from this folder |
| **Cloudflare Pages** | Connect the repo, no build command needed |
