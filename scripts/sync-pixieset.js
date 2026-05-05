#!/usr/bin/env node
/**
 * sync-pixieset.js
 * --------------------------------------------------------------
 * Reads Wendy's PUBLIC Pixieset homepage and every public collection
 * linked from it, then writes data/photos.json — the file the site
 * loads at runtime.
 *
 * Wendy's workflow becomes:
 *   1. Upload photos to a public Pixieset collection.
 *   2. (Optional) Link that collection on her Pixieset homepage.
 *   3. The site auto-rebuilds via cron (or "Refresh now") and the
 *      shoot appears.
 *
 * No API keys, no logins. Pixieset's public gallery pages embed
 * image URLs directly in the HTML, which is what we parse.
 *
 * Run locally:   node scripts/sync-pixieset.js
 * In CI:         see .github/workflows/sync.yml
 *
 * Configuration: edit pixieset.config.json next to this file, or
 * set PIXIESET_HOME / PIXIESET_COLLECTIONS in the environment.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// -----------------------------------------------------------
// Config
// -----------------------------------------------------------
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "scripts", "pixieset.config.json");
const OUT_PATH = path.join(ROOT, "data", "photos.json");
// Mirror copy as a JS file so the site can load it over file:// (no fetch).
const OUT_JS_PATH = path.join(ROOT, "data", "photos.js");

const DEFAULT_CONFIG = {
  // Wendy's public Pixieset homepage. The script reads every page of
  // this listing (?page=2, ?page=3, ...) and fetches each collection.
  homepage: "https://wendypix.pixieset.com/",
  // Maximum number of homepage pages to read. Pixieset paginates at ~18
  // collections per page, so 20 = 360 collections. Plenty of headroom.
  maxPages: 20,
  // Optional: explicit collection list. Useful when the homepage
  // hides certain collections you still want on your portfolio site.
  // Each entry can be a slug ("kellykellykelly") or a full URL.
  extraCollections: [],
  // Optional: hand-picked shoots for the "Featured Work" section.
  // Empty → that section is hidden and all shoots show in the main grid.
  featured: [],
  // Optional: hand-picked photos for the hero card row (5 cards, fanned at top).
  // Each entry can be:
  //   "slug"           — use that shoot's first photo
  //   "slug#3"         — use the 4th photo (0-indexed) of that shoot
  //   { slug, index }  — same as above, object form
  //   { url: "https://..." } — pin any URL
  // Empty → auto-pick lead photos from up to 5 different categories.
  heroPhotos: [],
  // Optional: allowlist of slugs for the main "All Shoots" grid, in
  // display order. Empty → show every shoot.
  gridShoots: [],
  // Optional: blocklist of slugs to hide from the grid. Filtered out
  // even if listed in gridShoots.
  excludeShoots: [],
  // Optional: per-shoot thumbnail override for the grid.
  // { "slug": 3 }                    → use photo at index 3
  // { "slug": "slug#3" }             → same, string form
  // { "slug": "https://..." }        → pin any URL as the thumbnail
  leadPhotos: {},
  // Per-shoot category overrides: { "slug": "category" }.
  // Beats categoryRules when present.
  categoryOverrides: {},
  // Auto-categorization rules. First match wins.
  categoryRules: [
    // Events / occasions / corporate
    { match: "xmas",         category: "events" },
    { match: "christmas",    category: "events" },
    { match: "wedding",      category: "events" },
    { match: "bday",         category: "events" },
    { match: "birthday",     category: "events" },
    { match: "70th",         category: "events" },
    { match: "80th",         category: "events" },
    { match: "tournament",   category: "events" },
    { match: "fundraising",  category: "events" },
    { match: "fundraiser",   category: "events" },
    { match: "foundation",   category: "events" },
    { match: "tedx",         category: "events" },
    { match: "ewomen",       category: "events" },
    { match: "divas",        category: "events" },
    { match: "angels",       category: "events" },
    { match: "sheangels",    category: "events" },
    { match: "diningdivas",  category: "events" },
    { match: "saba",         category: "events" },
    { match: "ursula",       category: "events" },
    // Headshots — actors and execs
    { match: "headshot",     category: "headshots" },
    { match: "headshots",    category: "headshots" },
    { match: "executive",    category: "headshots" },
    { match: "actor",        category: "headshots" },
    { match: "sagvog",       category: "headshots" },
    { match: "sag-vog",      category: "headshots" },
    { match: "vog",          category: "headshots" },
    { match: "atthelab",     category: "headshots" },
    // Branded / corporate work
    { match: "ameriprise",   category: "corporate" },
    { match: "lifestyle",    category: "corporate" },
    { match: "retouching",   category: "corporate" },
    { match: "bootcamp",     category: "corporate" },
    // Families / kids / multiple-name shoots
    { match: "kid",          category: "families" },
    { match: "kids",         category: "families" },
    { match: "family",       category: "families" },
    { match: "and",          category: "families" },  // "audrey AND evelyn"
    { match: "&",            category: "families" },
    // Animals
    { match: "pet",          category: "animals" },
    { match: "dog",          category: "animals" },
    // Products
    { match: "product",      category: "products" },
    { match: "branding",     category: "products" }
  ],
  defaultCategory: "portraits"   // single named subjects default here
};

function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      cfg = { ...cfg, ...file };
      if (file.categoryRules) cfg.categoryRules = file.categoryRules;
    } catch (e) {
      console.warn(`Could not read ${CONFIG_PATH}: ${e.message}`);
    }
  }
  if (process.env.PIXIESET_HOME) cfg.homepage = process.env.PIXIESET_HOME;
  if (process.env.PIXIESET_COLLECTIONS) {
    cfg.extraCollections = process.env.PIXIESET_COLLECTIONS.split(",").map(s => s.trim()).filter(Boolean);
  }
  return cfg;
}

// -----------------------------------------------------------
// Tiny HTTP fetcher (Node 18+ has fetch, but we want zero deps)
// -----------------------------------------------------------
// Pixieset's edge appears to bot-block requests from cloud IPs that use a
// non-browser user-agent (we hit HTTP 403 from GitHub Actions runners). A
// real Chrome UA + the matching browser headers seems to satisfy whatever
// fingerprinting rule it's applying.
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "identity",   // we don't decompress, so ask for plain
  "sec-fetch-site": "none",
  "sec-fetch-mode": "navigate",
  "sec-fetch-user": "?1",
  "sec-fetch-dest": "document",
  "upgrade-insecure-requests": "1",
};

function get(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { ...BROWSER_HEADERS, ...extraHeaders },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(new URL(res.headers.location, url).toString(), extraHeaders));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}
function getJson(url) {
  return get(url, { "x-requested-with": "XMLHttpRequest", accept: "application/json" })
    .then((t) => JSON.parse(t));
}

// -----------------------------------------------------------
// Parsers
// -----------------------------------------------------------
const COLLECTION_LINK_RE = /href="\/([a-z0-9][a-z0-9-]+)\/?"/gi;
const PIXIESET_IMAGE_RE = /https:\/\/images\.pixieset\.com\/(\d+)\/([a-f0-9]{32})-([a-z]+)\.(?:jpg|jpeg|png)/gi;
const TITLE_RE = /<title[^>]*>([^<]+)<\/title>/i;
const DATE_LINE_RE = /([A-Z]+\s+\d{1,2}(?:ST|ND|RD|TH)?,?\s+\d{4})/;

function parseHomepage(html) {
  const slugs = new Set();
  // Collect anchor hrefs that look like collection paths.
  const denylist = new Set(["", "/", "homepage", "gallery", "store", "favorites", "comments", "downloads", "subscribe"]);
  let m;
  COLLECTION_LINK_RE.lastIndex = 0;
  while ((m = COLLECTION_LINK_RE.exec(html))) {
    const slug = m[1];
    if (denylist.has(slug)) continue;
    if (slug.length < 3 || slug.length > 80) continue;
    slugs.add(slug);
  }
  return Array.from(slugs);
}

// Walk every page of the homepage listing (?page=2, ?page=3, ...) and
// merge slugs until a page yields nothing new.
async function discoverAllSlugs(homepage, maxPages = 20) {
  const seen = new Set();
  for (let p = 1; p <= maxPages; p++) {
    const url = p === 1 ? homepage : `${homepage.replace(/\/$/, "")}/?page=${p}`;
    let html;
    try { html = await get(url); }
    catch (e) { console.warn(`  page ${p}: ${e.message}`); break; }
    const pageSlugs = parseHomepage(html);
    let added = 0;
    for (const s of pageSlugs) if (!seen.has(s)) { seen.add(s); added++; }
    console.log(`  page ${p}: +${added} new (${seen.size} total)`);
    if (!added) break;
  }
  return Array.from(seen);
}

// Parse the collection landing page for the metadata we need to call the
// /client/loadphotos/ JSON API.
const COLLECTION_INIT_RE = /PixiesetClient\.init\(\s*\{[^}]*?'collectionId'\s*:\s*(\d+)[^}]*?'collectionUrlKey'\s*:\s*'([^']+)'/;

function parseCollectionMeta(html) {
  const init = html.match(COLLECTION_INIT_RE);
  const titleMatch = html.match(TITLE_RE);
  const rawTitle = titleMatch ? titleMatch[1].trim() : "";
  const title = rawTitle.replace(/\s+by\s+.*/i, "").trim();
  const dateMatch = html.match(DATE_LINE_RE);
  const date = dateMatch ? prettyDate(dateMatch[1]) : null;
  return {
    collectionId: init ? init[1] : null,
    slug: init ? init[2] : null,
    title,
    date,
  };
}

// Fetch every photo in a collection by paging the loadphotos JSON endpoint.
async function fetchAllPhotos(homepage, slug, collectionId) {
  const photos = [];
  for (let page = 1; page < 100; page++) {
    const u = new URL("/client/loadphotos/", homepage);
    u.searchParams.set("cuk", slug);
    u.searchParams.set("cid", collectionId);
    u.searchParams.set("gs", "highlights");
    u.searchParams.set("page", page);
    u.searchParams.set("size", "200");
    const json = await getJson(u.toString());
    if (json.status !== "success" || !json.content) break;
    let batch;
    try { batch = JSON.parse(json.content); } catch { batch = []; }
    if (!Array.isArray(batch) || !batch.length) break;
    photos.push(...batch);
    if (json.isLastPage) break;
  }
  return photos;
}

function pickPhotoUrl(p) {
  // Pixieset returns relative protocol URLs like "//images.pixieset.com/..."
  const raw = p.pathXlarge || p.pathLarge || p.pathMedium || p.pathSmall || p.pathThumb;
  if (!raw) return null;
  return raw.startsWith("//") ? "https:" + raw : raw;
}

// Pixieset stores files with whatever case the camera uploaded (.jpg / .JPG / .jpeg).
// We must preserve the case — generating .jpg for a file stored as .JPG returns Access Denied.
function extOf(url) {
  const m = (url || "").match(/\.([a-zA-Z]+)$/);
  return m ? m[1] : "jpg";
}

function prettyDate(raw) {
  // Convert "APRIL 25TH, 2026" -> "2026-04-25"
  const months = { JANUARY:1, FEBRUARY:2, MARCH:3, APRIL:4, MAY:5, JUNE:6, JULY:7, AUGUST:8, SEPTEMBER:9, OCTOBER:10, NOVEMBER:11, DECEMBER:12 };
  const m = raw.toUpperCase().match(/^([A-Z]+)\s+(\d{1,2})(?:ST|ND|RD|TH)?,?\s+(\d{4})$/);
  if (!m) return raw;
  const month = months[m[1]];
  if (!month) return raw;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

function categoryFor(slug, title, rules, defaultCat, overrides) {
  if (overrides && overrides[slug]) return overrides[slug];
  const haystack = `${slug} ${title}`.toLowerCase();
  for (const r of rules) {
    const m = r.match.toLowerCase();
    // Use word-boundary-ish match to avoid e.g. "and" inside "anderson"
    const re = new RegExp(`(?:^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i");
    if (re.test(haystack)) return r.category;
  }
  return defaultCat;
}

// -----------------------------------------------------------
// Existing-subjects fallback
//
// When Pixieset blocks the runner (HTTP 403 from cloud IPs is common),
// we still want to rebuild data/photos.* with the CURRENT config baked in
// so that admin.html edits to featured/excluded/hero/etc. flow through to
// the deployed site. To do that without re-fetching from Pixieset, we
// load the subjects array from the previously-committed data file.
//
// Two formats are possible:
//   - data/photos.json — the canonical JSON (written by this script)
//   - data/photos.js   — the JS wrapper the static site loads at runtime.
//                        It's an IIFE that sets window.WENDY_PHOTOS, so we
//                        execute it in a fake `window` to extract subjects.
// -----------------------------------------------------------
function loadExistingSubjects() {
  // 1) Canonical JSON — fastest, simplest.
  try {
    if (fs.existsSync(OUT_PATH)) {
      const j = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
      if (j && Array.isArray(j.subjects)) return j.subjects;
    }
  } catch (e) {
    console.warn("  Couldn't parse data/photos.json: " + e.message);
  }
  // 2) Fall back to data/photos.js — run the IIFE in a sandboxed `window`.
  //    Both compact-format and full-format outputs expose
  //    window.WENDY_PHOTOS.subjects so this works regardless of which one
  //    is currently committed.
  try {
    if (fs.existsSync(OUT_JS_PATH)) {
      const code = fs.readFileSync(OUT_JS_PATH, "utf8");
      const win = {};
      // The wrapper expects a `window` global. We pass our fake one and
      // the IIFE assigns to it, leaving subjects on win.WENDY_PHOTOS.
      new Function("window", code)(win);
      if (win.WENDY_PHOTOS && Array.isArray(win.WENDY_PHOTOS.subjects)) {
        return win.WENDY_PHOTOS.subjects;
      }
    }
  } catch (e) {
    console.warn("  Couldn't parse data/photos.js: " + e.message);
  }
  return [];
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  const cfg = loadConfig();
  console.log(`Pixieset sync — homepage: ${cfg.homepage}`);
  // 1) Decide what slugs to fetch.
  //    EDITORIAL MODE (cfg.categories non-empty): fetch ONLY the listed
  //      category collections, skip homepage scrape. Wendy's other public
  //      Pixieset galleries are intentionally invisible to the site.
  //    LEGACY MODE: scrape the public homepage and fetch every linked
  //      collection, plus any extraCollections.
  const editorialMode =
    Array.isArray(cfg.categories) && cfg.categories.length > 0;
  let slugs = [];
  if (editorialMode) {
    slugs = cfg.categories
      .map((c) => (c && typeof c === "object" ? c.slug : c))
      .filter(Boolean);
    console.log(
      `Editorial mode: fetching ${slugs.length} curated category collections (skipping homepage scrape).`
    );
  } else {
    try {
      slugs = await discoverAllSlugs(cfg.homepage, cfg.maxPages || 20);
      console.log(`  Discovered ${slugs.length} collections across all pages.`);
    } catch (e) {
      console.warn(`  Could not load homepage: ${e.message}`);
    }
    // 2) Add explicit extras (legacy only — editorial mode uses categories)
    for (const x of cfg.extraCollections || []) {
      const slug = x.startsWith("http")
        ? x.replace(/\/$/, "").split("/").pop()
        : x.replace(/\/+|\\+/g, "");
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    }
  }
  // If Pixieset blocked us, keep going — but reuse the subjects that the
  // PREVIOUS sync committed to data/photos.js. We'll still rewrite the
  // output file at the end with the CURRENT config (featured, hero, hidden,
  // ...) baked in, which is what makes admin.html edits flow through to
  // the deployed site even when a runner can't reach Pixieset.
  let pixiesetReachable = slugs.length > 0;
  if (!pixiesetReachable) {
    console.warn(
      "No collections discovered (likely a Pixieset 403 from this runner's IP). " +
      "Reusing previously synced subjects so the current config still bakes into data/photos.*"
    );
  }

  // 3) Build the subjects list. If Pixieset was reachable, fetch each
  //    collection's photos. Otherwise, fall back to the subjects we
  //    committed last time so we can still re-bake the config into output.
  let subjects = [];
  if (!pixiesetReachable) {
    subjects = loadExistingSubjects();
    console.log(`  Reusing ${subjects.length} previously synced subjects.`);
  }
  for (const slug of slugs) {
    const url = new URL(slug + "/", cfg.homepage).toString();
    try {
      const html = await get(url);
      const meta = parseCollectionMeta(html);
      if (!meta.collectionId) {
        console.warn(`  ${slug}: no collectionId in page, skipping`);
        continue;
      }
      const apiPhotos = await fetchAllPhotos(cfg.homepage, slug, meta.collectionId);
      const photoUrls = apiPhotos.map(pickPhotoUrl).filter(Boolean);
      if (!photoUrls.length) {
        console.warn(`  ${slug}: API returned no photos, skipping`);
        continue;
      }
      // Preserve any per-photo extension differences. Most shoots are uniform
      // but if one photo was uploaded with a different extension we keep the
      // exact original URL.
      const exts = photoUrls.map(extOf);
      const uniqExts = Array.from(new Set(exts));
      if (uniqExts.length > 1) {
        console.log(`  ${slug}: mixed extensions ${uniqExts.join(", ")}`);
      }
      const cat = categoryFor(slug, meta.title, cfg.categoryRules, cfg.defaultCategory, cfg.categoryOverrides);
      subjects.push({
        id: slug,
        slug,
        cat,
        title: meta.title || slug.replace(/[-_]+/g, " "),
        date: meta.date,
        url,
        cover: photoUrls[0],
        photos: photoUrls,
      });
      console.log(`  ${slug}: "${meta.title}" — ${photoUrls.length} photos [${cat}]`);
    } catch (e) {
      console.warn(`  ${slug}: ${e.message}`);
    }
  }

  // Editorial mode + every per-slug fetch failed = Pixieset blocked the
  // runner. Don't wipe the editorial data — fall back to what's in
  // data/photos.js so the live site keeps showing the last known categories.
  if (editorialMode && !subjects.length) {
    subjects = loadExistingSubjects();
    console.warn(
      `Editorial mode: all category fetches failed (likely Pixieset 403). ` +
      `Reusing ${subjects.length} previously synced subjects so the live ` +
      `site doesn't lose its editorial sections.`
    );
  }

  // Editorial mode hard guarantee: the OUTPUT subjects array only ever
  // contains subjects whose slugs are listed in cfg.categories. This stops
  // a previous legacy-mode data file from leaking 118 unrelated shoots
  // into an editorial run via the fallback above.
  if (editorialMode) {
    const wanted = new Set(cfg.categories.map((c) => c && c.slug).filter(Boolean));
    const before = subjects.length;
    subjects = subjects.filter((s) => wanted.has(s.id || s.slug));
    if (before !== subjects.length) {
      console.log(
        `Editorial filter: kept ${subjects.length} of ${before} subjects (only those in cfg.categories).`
      );
    }
  }

  // 4) Write photos.json
  // Filter the featured list down to slugs we actually scraped, preserving
  // Wendy's curated order.
  const slugSet = new Set(subjects.map((s) => s.id));
  const featured = (cfg.featured || []).filter((slug) => slugSet.has(slug));
  if (cfg.featured && cfg.featured.length && featured.length !== cfg.featured.length) {
    const missing = cfg.featured.filter((s) => !slugSet.has(s));
    console.warn(`  ⚠ featured slugs not found: ${missing.join(", ")}`);
  }
  // Same treatment for the grid curation knobs: keep them around even if a
  // slug is currently missing — the runtime filters again, and an out-of-
  // date slug just gets silently skipped.
  const gridShoots = (cfg.gridShoots || []).filter((slug) => slugSet.has(slug));
  if (cfg.gridShoots && cfg.gridShoots.length && gridShoots.length !== cfg.gridShoots.length) {
    const missing = cfg.gridShoots.filter((s) => !slugSet.has(s));
    console.warn(`  ⚠ gridShoots slugs not found: ${missing.join(", ")}`);
  }
  const excludeShoots = (cfg.excludeShoots || []).slice();
  // leadPhotos is an object — pass through as-is; runtime resolves each entry.
  const leadPhotos = (cfg.leadPhotos && typeof cfg.leadPhotos === "object") ? { ...cfg.leadPhotos } : {};
  // In editorial mode, pass categories through so the runtime renders one
  // section per category. Null in legacy mode signals the runtime to fall
  // back to the legacy Featured + All Shoots layout.
  const out = {
    generatedAt: new Date().toISOString(),
    source: cfg.homepage,
    featured,
    heroPhotos: cfg.heroPhotos || [],
    gridShoots,
    excludeShoots,
    leadPhotos,
    categories: editorialMode ? cfg.categories.slice() : null,
    subjects
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  // Mirror as JS so file:// loads work without fetch.
  fs.writeFileSync(
    OUT_JS_PATH,
    `/* auto-generated by sync-pixieset.js — do not edit by hand */\n` +
    `window.WENDY_PHOTOS = ${JSON.stringify(out, null, 2)};\n`
  );
  console.log(`\nWrote ${subjects.length} subjects → ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`Wrote mirror → ${path.relative(ROOT, OUT_JS_PATH)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
