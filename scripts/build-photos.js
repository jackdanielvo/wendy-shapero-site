#!/usr/bin/env node
/**
 * build-photos.js
 * --------------------------------------------------------------
 * Walks the local `photos/` directory tree and writes data/photos.js,
 * which the runtime loads at page load.
 *
 * Folder convention (per Wendy's editorial-mode portfolio):
 *   photos/
 *     <category-slug>/                ← e.g. "headshots-men"
 *       <NN-person-slug>/             ← e.g. "01-craig-shoemaker" (NN = order)
 *         <NN-name>.jpg               ← alphabetical order within the folder
 *         …
 *       <NN-person-slug>/
 *         _title.txt                  ← (optional) overrides the auto-titled name
 *         …
 *
 * Within each person folder, the FIRST file alphabetically is treated as
 * the lead/cover (shown in the category carousel). The remaining files
 * appear in the fullscreen shoot view when a viewer clicks the lead.
 *
 * Category labels come from scripts/pixieset.config.json's `categories`
 * field if present; otherwise they're auto-derived from the folder slug.
 *
 * Run locally:   node scripts/build-photos.js
 * In CI:         see .github/workflows/sync.yml
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PHOTOS_DIR = path.join(ROOT, "photos");
const CONFIG_PATH = path.join(ROOT, "scripts", "pixieset.config.json");
const OUT_JSON_PATH = path.join(ROOT, "data", "photos.json");
const OUT_JS_PATH = path.join(ROOT, "data", "photos.js");

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/** Pretty-up a folder slug for display. e.g. "alec-and-zoe-walker" → "Alec & Zoe Walker" */
function titleFromSlug(slug) {
  // Hyphens become spaces; words capitalize. "and" lowercases unless first word.
  const words = slug.split("-").map((w, i) => {
    if (!w) return w;
    if (i > 0 && w === "and") return "&";  // friendlier than "And"
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
  return words.join(" ");
}

/** Strip a leading "NN-" prefix used for ordering. "01-craig-shoemaker" → "craig-shoemaker" */
function stripOrderPrefix(name) {
  return name.replace(/^\d+-/, "");
}

/** Read a sibling text file as a single trimmed line, or return null. */
function readMetaFile(filepath) {
  try {
    return fs.readFileSync(filepath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.warn(`Could not read ${CONFIG_PATH}: ${e.message}`);
    return {};
  }
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((f) => IMAGE_RE.test(f) && !f.startsWith("."))
    .sort();
}

function main() {
  console.log(`Building photos data from ${path.relative(ROOT, PHOTOS_DIR)}/`);
  const cfg = loadConfig();
  const cfgCategories = Array.isArray(cfg.categories) ? cfg.categories : [];
  const cfgByslug = Object.fromEntries(
    cfgCategories.filter((c) => c && c.slug).map((c) => [c.slug, c])
  );

  // Walk category folders. Sort alphabetically; the order in pixieset.config.json
  // wins if specified (so editors can reorder categories without renaming folders).
  const folderCats = listDirs(PHOTOS_DIR);
  const orderedCats = cfgCategories.length
    ? cfgCategories.map((c) => c.slug).filter((slug) => folderCats.includes(slug))
    : folderCats;
  // Add any folder categories that weren't in the config, at the end.
  for (const slug of folderCats) {
    if (!orderedCats.includes(slug)) orderedCats.push(slug);
  }

  const categories = [];
  const subjects = [];

  for (const catSlug of orderedCats) {
    const catDir = path.join(PHOTOS_DIR, catSlug);
    const cfgEntry = cfgByslug[catSlug] || {};
    const catLabel = cfgEntry.label || titleFromSlug(catSlug);
    const catSubtitle = cfgEntry.subtitle || "";

    // For each person folder inside this category
    const personDirs = listDirs(catDir);
    let personCount = 0;
    for (const personFolder of personDirs) {
      const personPath = path.join(catDir, personFolder);
      const personSlug = stripOrderPrefix(personFolder);
      // Title: explicit _title.txt > auto from slug
      const titleOverride = readMetaFile(path.join(personPath, "_title.txt"));
      const title = titleOverride || titleFromSlug(personSlug);

      const images = listImages(personPath);
      if (!images.length) {
        console.warn(`  ${catSlug}/${personFolder}: no images, skipping`);
        continue;
      }

      // Relative URLs (the deployed site serves the photos/ tree as static assets)
      const photos = images.map(
        (name) => `photos/${catSlug}/${personFolder}/${encodeURIComponent(name)}`
      );

      subjects.push({
        id: personSlug,
        slug: personSlug,
        cat: catSlug,
        title,
        date: null,
        url: null,
        cover: photos[0],
        photos,
      });
      personCount++;
      console.log(`  ${catSlug}/${personFolder}: "${title}" — ${images.length} photos`);
    }

    if (personCount) {
      categories.push({ slug: catSlug, label: catLabel, subtitle: catSubtitle });
    } else {
      console.warn(`  ${catSlug}: no people with photos, skipping category`);
    }
  }

  if (!subjects.length) {
    console.error("No photos found. Nothing to write.");
    process.exit(1);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "local",
    featured: [],
    heroPhotos: cfg.heroPhotos || [],
    gridShoots: [],
    excludeShoots: [],
    leadPhotos: {},
    categories,
    subjects,
  };

  fs.mkdirSync(path.dirname(OUT_JS_PATH), { recursive: true });
  fs.writeFileSync(OUT_JSON_PATH, JSON.stringify(out, null, 2));
  fs.writeFileSync(
    OUT_JS_PATH,
    `/* auto-generated by scripts/build-photos.js — do not edit by hand */\n` +
    `window.WENDY_PHOTOS = ${JSON.stringify(out, null, 2)};\n`
  );

  console.log(
    `\nWrote ${subjects.length} subjects across ${categories.length} categor${
      categories.length === 1 ? "y" : "ies"
    } → ${path.relative(ROOT, OUT_JS_PATH)}`
  );
}

main();
