#!/usr/bin/env node
/**
 * optimize-photos.js
 * --------------------------------------------------------------
 * Walks the source `photos/` tree and writes web-optimized copies
 * to `photos-web/`, mirroring the folder structure.
 *
 *   photos/1-Women/01-Valentina/01-Valentina.jpg   (camera original, ~25MB)
 *     ↓
 *   photos-web/1-Women/01-Valentina/01-Valentina.jpg  (1600px long edge, ~250KB)
 *
 * Why:
 *   Wendy's master JPEGs out of the camera are 6720x4480 and can be
 *   25-30 MB each. The site only ever displays them up to ~1600px on
 *   the long edge (hero cards, shoot-view fullscreen). Shipping the
 *   originals would balloon the deploy from ~50MB to multiple GB.
 *
 * What we do:
 *   - ImageMagick `convert` with -resize '1600x1600>' (only shrink, don't
 *     enlarge — second `>` means "only if larger")
 *   - JPEG quality 82, -strip removes EXIF / color profiles
 *   - Auto-orient based on EXIF rotation flag before stripping
 *   - Sampling factor 4:2:0 + interlace Plane for smaller files
 *
 * Incremental:
 *   Skip files where the destination exists and is newer than the
 *   source. Pass --force to rebuild everything.
 *
 * Folder structure is preserved verbatim — including spaces and
 * ampersands ("3-Kids & Teens/", "01-Adam & Michelle/"). The runtime
 * URL generator (build-photos.js) URL-encodes each path segment so
 * the browser fetches them correctly.
 *
 * Run locally:
 *   node scripts/optimize-photos.js          # incremental
 *   node scripts/optimize-photos.js --force  # rebuild all
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "photos");
const DST_DIR = path.join(ROOT, "photos-web");

const MAX_EDGE = 1600;
const JPEG_QUALITY = 82;
const IMAGE_RE = /\.(jpe?g|png)$/i;

const force = process.argv.includes("--force");

// Stats we print at the end
let processed = 0;
let skipped = 0;
let errors = 0;
let totalSrcBytes = 0;
let totalDstBytes = 0;

function isImage(name) {
  return IMAGE_RE.test(name) && !name.startsWith(".");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function needsRebuild(src, dst) {
  if (force) return true;
  if (!fs.existsSync(dst)) return true;
  const s = fs.statSync(src);
  const d = fs.statSync(dst);
  return s.mtimeMs > d.mtimeMs;
}

function optimize(src, dst) {
  // ImageMagick's `convert` command. The `>` after dimensions means
  // "only shrink, never enlarge". -auto-orient bakes in the EXIF
  // rotation before -strip drops EXIF.
  execFileSync(
    "convert",
    [
      src,
      "-auto-orient",
      "-resize", `${MAX_EDGE}x${MAX_EDGE}>`,
      "-strip",
      "-sampling-factor", "4:2:0",
      "-interlace", "Plane",
      "-quality", String(JPEG_QUALITY),
      dst,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
}

function processDir(srcDir, dstDir) {
  ensureDir(dstDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // .DS_Store etc.
    const srcPath = path.join(srcDir, e.name);
    const dstPath = path.join(dstDir, e.name);

    if (e.isDirectory()) {
      processDir(srcPath, dstPath);
      continue;
    }
    if (!e.isFile() || !isImage(e.name)) continue;

    // Force .jpg output for png sources too (smaller, consistent).
    // But keep the same basename so URLs are predictable; just swap
    // the extension on png inputs.
    let outPath = dstPath;
    if (/\.png$/i.test(e.name)) {
      outPath = dstPath.replace(/\.png$/i, ".jpg");
    } else {
      // Normalize .jpeg → .jpg for clean URLs
      outPath = dstPath.replace(/\.jpeg$/i, ".jpg");
    }

    if (!needsRebuild(srcPath, outPath)) {
      skipped++;
      // Still count bytes so the final summary is accurate
      totalSrcBytes += fs.statSync(srcPath).size;
      totalDstBytes += fs.statSync(outPath).size;
      continue;
    }

    try {
      optimize(srcPath, outPath);
      processed++;
      const srcBytes = fs.statSync(srcPath).size;
      const dstBytes = fs.statSync(outPath).size;
      totalSrcBytes += srcBytes;
      totalDstBytes += dstBytes;
      const rel = path.relative(ROOT, outPath);
      console.log(
        `  ${rel}  ${formatBytes(srcBytes)} → ${formatBytes(dstBytes)} (${pct(
          dstBytes / srcBytes
        )})`
      );
    } catch (err) {
      errors++;
      console.error(`  ✗ ${e.name}: ${err.message.split("\n")[0]}`);
    }
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function pct(r) {
  return `${(r * 100).toFixed(0)}%`;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`No photos/ directory at ${SRC_DIR}`);
    process.exit(1);
  }
  console.log(
    `Optimizing photos: photos/ → photos-web/  (max ${MAX_EDGE}px, q${JPEG_QUALITY}${
      force ? ", force" : ""
    })`
  );
  console.log("");
  processDir(SRC_DIR, DST_DIR);
  console.log("");
  console.log(
    `Done. processed=${processed}  skipped=${skipped}  errors=${errors}`
  );
  if (totalSrcBytes) {
    console.log(
      `Source: ${formatBytes(totalSrcBytes)}  →  Output: ${formatBytes(
        totalDstBytes
      )}  (${pct(totalDstBytes / totalSrcBytes)} of original)`
    );
  }
  if (errors) process.exit(1);
}

main();
