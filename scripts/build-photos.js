#!/usr/bin/env node
/**
 * build-photos.js
 * --------------------------------------------------------------
 * Walks the web-optimized `photos-web/` directory tree and writes
 * data/photos.js, which the runtime loads at page load.
 *
 * Wendy's editorial naming convention:
 *
 *   photos-web/
 *     <N-CategoryName>/                  ← e.g. "1-Women", "3-Kids & Teens"
 *       <NN-SubjectName>/                ← e.g. "01-Valentina", "03-Audrey & Evelyn"
 *         <NN-name>.jpg                  ← position-numbered photos
 *         …
 *
 * Ordering:
 *   - The leading "N-" prefix on category folders controls the order
 *     categories appear in the nav (numeric, not alphabetic — so "10-X"
 *     comes after "9-X").
 *   - The "NN-" prefix on subject folders controls the order subjects
 *     appear inside each category carousel.
 *   - Within a subject folder, the FIRST image alphabetically (which
 *     is "01-Name.jpg") is the lead/cover shown in the grid. The rest
 *     appear in the shoot-view fullscreen when clicked.
 *
 * Slug normalization:
 *   "1-Women"           → cat slug "women"
 *   "3-Kids & Teens"    → cat slug "kids-and-teens"
 *   "01-Valentina"      → subject slug "valentina"
 *   "02-Adam & Michelle"→ subject slug "adam-and-michelle"
 *
 * Category labels and subtitles come from scripts/pixieset.config.json
 * (looked up by the normalized slug). If a folder doesn't have a
 * config entry the script falls back to the cleaned-up folder name.
 *
 * Run locally:   node scripts/build-photos.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PHOTOS_DIR = path.join(ROOT, "photos-web"); // ← scans optimized tree
const CONFIG_PATH = path.join(ROOT, "scripts", "pixieset.config.json");
const OUT_JSON_PATH = path.join(ROOT, "data", "photos.json");
const OUT_JS_PATH = path.join(ROOT, "data", "photos.js");

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/** Strip a leading "NN-" / "N-" prefix used for ordering. */
function stripOrderPrefix(name) {
  return name.replace(/^\d+-\s*/, "");
}

/**
 * Convert a folder name to a URL-friendly slug.
 * "Kids & Teens"      → "kids-and-teens"
 * "Adam & Michelle"   → "adam-and-michelle"
 * "Robert P"          → "robert-p"
 * "Valentina"         → "valentina"
 */
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Pretty display name from the stripped folder name. */
function titleFromName(name) {
  // The name is already in human form (e.g. "Adam & Michelle"), so
  // just normalize whitespace.
  return name.replace(/\s+/g, " ").trim();
}

/** Numeric/natural sort — so "01", "02", ..., "10" comes out in order. */
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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
    .sort(naturalSort);
}

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((f) => IMAGE_RE.test(f) && !f.startsWith("."))
    .sort(naturalSort);
}

/** Build the runtime URL for a photo, URL-encoding each path segment. */
function buildPhotoUrl(catFolder, subjectFolder, fileName) {
  return [
    "photos-web",
    encodeURIComponent(catFolder),
    encodeURIComponent(subjectFolder),
    encodeURIComponent(fileName),
  ].join("/");
}

function main() {
  console.log(`Building photos data from ${path.relative(ROOT, PHOTOS_DIR)}/`);
  const cfg = loadConfig();
  const cfgCategories = Array.isArray(cfg.categories) ? cfg.categories : [];
  const cfgBySlug = Object.fromEntries(
    cfgCategories.filter((c) => c && c.slug).map((c) => [c.slug, c])
  );

  // Walk category folders. The leading "N-" prefix gives natural
  // ordering — "1-Women" before "2-Men" — which the naturalSort in
  // listDirs already handles.
  const catFolders = listDirs(PHOTOS_DIR);

  const categories = [];
  const subjects = [];

  for (const catFolder of catFolders) {
    const catDir = path.join(PHOTOS_DIR, catFolder);
    const cleanCatName = stripOrderPrefix(catFolder);
    const catSlug = slugify(cleanCatName);

    const cfgEntry = cfgBySlug[catSlug] || {};
    const catLabel = cfgEntry.label || titleFromName(cleanCatName);
    const catSubtitle = cfgEntry.subtitle || "";

    // For each person folder inside this category
    const personDirs = listDirs(catDir);
    let personCount = 0;
    for (const personFolder of personDirs) {
      const personPath = path.join(catDir, personFolder);
      const cleanPersonName = stripOrderPrefix(personFolder);
      const personSlug = slugify(cleanPersonName);

      // Title: explicit _title.txt > auto from folder name
      const titleOverride = readMetaFile(path.join(personPath, "_title.txt"));
      const title = titleOverride || titleFromName(cleanPersonName);

      const images = listImages(personPath);
      if (!images.length) {
        console.warn(`  ${catFolder}/${personFolder}: no images, skipping`);
        continue;
      }

      // Each image gets a runtime URL. Folder/file names may contain
      // spaces or & — URL-encoding each segment handles that.
      const photos = images.map((name) =>
        buildPhotoUrl(catFolder, personFolder, name)
      );

      subjects.push({
        id: personSlug,
        slug: personSlug,
        cat: catSlug,
        title,
        date: null,
        url: null,
        cover: photos[0], // first image alphabetically = lead
        photos,
      });
      personCount++;
      console.log(`  ${catFolder}/${personFolder}: "${title}" — ${images.length} photos`);
    }

    if (personCount) {
      categories.push({ slug: catSlug, label: catLabel, subtitle: catSubtitle });
    } else {
      console.warn(`  ${catFolder}: no people with photos, skipping category`);
    }
  }

  if (!subjects.length) {
    console.error("No photos found. Nothing to write.");
    process.exit(1);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "local",
    featured: Array.isArray(cfg.featured) ? cfg.featured : [],
    heroPhotos: cfg.heroPhotos || [],
    gridShoots: Array.isArray(cfg.gridShoots) ? cfg.gridShoots : [],
    excludeShoots: Array.isArray(cfg.excludeShoots) ? cfg.excludeShoots : [],
    leadPhotos: cfg.leadPhotos || {},
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

  // Cache-bust the <script src="data/photos.js?v=BUILDTIME"> reference in
  // index.html so visitors' browsers re-fetch the data file every time
  // the build runs. Without this, an admin Hero publish (or Photos
  // publish) would update the deployed file but visitors would keep
  // seeing the old version from HTTP cache.
  const stamp =
    new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .replace(/\..+$/, ""); // e.g. "20260522T180530"
  const indexPath = path.join(ROOT, "index.html");
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, "utf8");
    const before = html;
    // Match both the BUILDTIME placeholder (template state) and any
    // previously substituted timestamp, so re-running the build always
    // produces a fresh value.
    html = html.replace(
      /(data\/photos\.js\?v=)(?:BUILDTIME|\d{8}T\d{6})/g,
      `$1${stamp}`
    );
    if (html !== before) {
      fs.writeFileSync(indexPath, html);
      console.log(`Cache-busted data/photos.js → ?v=${stamp}`);
    } else {
      console.log(
        `No ?v=BUILDTIME/timestamp placeholder found in index.html — ` +
        `cache buster not updated.`
      );
    }
  }

  console.log(
    `\nWrote ${subjects.length} subjects across ${categories.length} categor${
      categories.length === 1 ? "y" : "ies"
    } → ${path.relative(ROOT, OUT_JS_PATH)}`
  );
}

main();
