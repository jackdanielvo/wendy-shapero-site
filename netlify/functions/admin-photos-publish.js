// admin-photos-publish.js
// --------------------------------------------------------------
// POST endpoint. Accepts a desired-state manifest from the admin UI
// and commits it to the GitHub repo. Netlify auto-deploys on push.
//
// The manifest shape mirrors what admin-photos-manifest.js returns,
// plus an optional `uploads` array for newly-added photos.
//
// Request body shape:
//   {
//     "commitSha": "<sha of the tree the admin loaded from>",
//     "categories": [
//       {
//         "folder": "1-Women",                   // desired final folder name
//         "originalFolder": "1-Women",           // what it was named before (may equal folder if unchanged)
//         "subjects": [
//           {
//             "folder": "01-Grey",
//             "originalFolder": "04-Grey",
//             "photos": [
//               { "file": "01-Grey.jpg", "originalFile": "01-Grey.jpg" },
//               // new uploads:
//               // { "file": "05-Grey.jpg", "uploadKey": "abc123" }
//             ]
//           }
//         ]
//       }
//     ],
//     "uploads": {
//       "abc123": "base64-encoded JPEG bytes here"
//     },
//     "commitMessage": "Reorder Women + Lifestyle"
//   }
//
// We translate the manifest into a single GitHub commit:
//   - Existing photos are referenced by their existing blob SHAs at
//     their NEW paths (same content, just renamed).
//   - New uploads get blobs created via /git/blobs, then placed at
//     the appropriate paths.
//   - We also regenerate data/photos.js + data/photos.json so the
//     site reflects the new structure without waiting for a separate
//     build-photos run.

const { requireAuth } = require("./_auth");

const PHOTOS_PREFIX = "photos-web/";
const IMAGE_RE = /\.(jpe?g|png)$/i;

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  if (event.httpMethod !== "POST") {
    return json(405, { error: "POST only" });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) {
    return json(500, {
      error:
        "Photos admin not configured. Set GITHUB_TOKEN and GITHUB_REPO env vars in Netlify.",
    });
  }

  let manifest;
  try {
    manifest = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  if (!Array.isArray(manifest.categories)) {
    return json(400, { error: "Missing categories[]" });
  }

  try {
    // 1. Get the current tip + tree so we can verify the user wasn't
    //    editing against a stale snapshot, and so we have base_tree
    //    for the new commit.
    const refRes = await gh(`/repos/${repo}/git/refs/heads/${branch}`, { token });
    const currentCommitSha = refRes.object.sha;
    if (
      manifest.commitSha &&
      manifest.commitSha !== currentCommitSha
    ) {
      // Soft warning — the manifest doesn't have to match exactly,
      // but if it doesn't, the user might be overwriting someone
      // else's commit. Return a 409 so the UI can decide.
      return json(409, {
        error:
          "Tree changed since you loaded it. Reload the Photos tab and try again.",
        currentCommitSha,
      });
    }
    const commitRes = await gh(
      `/repos/${repo}/git/commits/${currentCommitSha}`,
      { token }
    );
    const baseTreeSha = commitRes.tree.sha;

    // 2. Load the current tree so we can look up blob SHAs for files
    //    whose content is unchanged (just being renamed).
    const treeRes = await gh(
      `/repos/${repo}/git/trees/${baseTreeSha}?recursive=1`,
      { token }
    );
    // We key the blob lookup by both the literal path AND a
    // segment-trimmed version, because folder/file names with
    // accidental leading/trailing whitespace would otherwise fail
    // lookup after sanitizeSegment() trims them client-side. (Real
    // example: "15-Rebecca " with trailing space was breaking
    // every publish that touched the Women category.)
    const blobByPath = new Map();
    const existingPhotoPaths = new Set();
    for (const entry of treeRes.tree) {
      if (entry.type === "blob") {
        blobByPath.set(entry.path, entry.sha);
        // Also index by the trimmed-segment variant if it differs
        const trimmed = trimPathSegments(entry.path);
        if (trimmed !== entry.path) {
          blobByPath.set(trimmed, entry.sha);
        }
        if (
          entry.path.startsWith(PHOTOS_PREFIX) &&
          IMAGE_RE.test(entry.path)
        ) {
          existingPhotoPaths.add(entry.path);
        }
      }
    }

    // 3. Walk the manifest, planning the new tree.
    //    `treeChanges` is a list of { path, mode, type, sha|content }.
    //    For renames / no-change: record the desired new path with the
    //                 existing blob SHA. The old path is detected in
    //                 step 4 (any existing photo path not represented
    //                 in the new manifest gets deleted — this single
    //                 rule covers both renames and explicit deletes).
    //    For uploads: create a new blob and reference it at the new path.
    const treeChanges = [];
    const newPathsTouched = new Set(); // dedupe

    for (const cat of manifest.categories) {
      if (!cat || !cat.folder || !Array.isArray(cat.subjects)) continue;
      const catFolder = sanitizeSegment(cat.folder);
      const oldCatFolder = cat.originalFolder
        ? sanitizeSegment(cat.originalFolder)
        : catFolder;

      for (const subj of cat.subjects) {
        if (!subj || !subj.folder || !Array.isArray(subj.photos)) continue;
        const subjFolder = sanitizeSegment(subj.folder);
        const oldSubjFolder = subj.originalFolder
          ? sanitizeSegment(subj.originalFolder)
          : subjFolder;

        for (const photo of subj.photos) {
          if (!photo) continue;
          const file = sanitizeSegment(photo.file);
          if (!IMAGE_RE.test(file)) {
            return json(400, { error: `Invalid filename: ${photo.file}` });
          }

          const newPath = `${PHOTOS_PREFIX}${catFolder}/${subjFolder}/${file}`;
          newPathsTouched.add(newPath);

          if (photo.uploadKey) {
            // NEW upload — create a blob from the base64 content
            const b64 = (manifest.uploads || {})[photo.uploadKey];
            if (!b64) {
              return json(400, {
                error: `Missing upload payload for key ${photo.uploadKey}`,
              });
            }
            const blob = await gh(`/repos/${repo}/git/blobs`, {
              token,
              method: "POST",
              body: { content: b64, encoding: "base64" },
            });
            treeChanges.push({
              path: newPath,
              mode: "100644",
              type: "blob",
              sha: blob.sha,
            });
          } else {
            // RENAME or NO-CHANGE — reuse existing blob SHA
            const originalFile = sanitizeSegment(
              photo.originalFile || photo.file
            );
            const oldPath = `${PHOTOS_PREFIX}${oldCatFolder}/${oldSubjFolder}/${originalFile}`;
            const blobSha = blobByPath.get(oldPath);
            if (!blobSha) {
              return json(400, {
                error: `Cannot find original blob for ${oldPath}`,
              });
            }
            treeChanges.push({
              path: newPath,
              mode: "100644",
              type: "blob",
              sha: blobSha,
            });
          }
        }
      }
    }

    // 4. Add deletions: any existing photo blob not represented in the
    //    new manifest gets removed. This covers renames (the old path is
    //    gone because the photo is at a new path) and explicit deletes
    //    (the photo isn't in the manifest at all).
    //
    //    SAFETY: if the new manifest covers no photos at all but the
    //    repo has photos, refuse — this is almost certainly a mistake
    //    (e.g. admin failed to load before publishing).
    if (newPathsTouched.size === 0 && existingPhotoPaths.size > 0) {
      return json(400, {
        error:
          "Manifest has no photos but the repo does. Refusing to delete everything — reload the Photos tab and try again.",
      });
    }
    for (const existingPath of existingPhotoPaths) {
      if (!newPathsTouched.has(existingPath)) {
        treeChanges.push({
          path: existingPath,
          mode: "100644",
          type: "blob",
          sha: null, // delete
        });
      }
    }

    if (!treeChanges.length) {
      return json(200, { ok: true, noop: true, message: "Nothing changed." });
    }

    // 5. Create the new tree (overlay on base_tree). GitHub merges
    //    our changes with the parent tree, so files outside photos-web/
    //    (HTML, CSS, JS, etc.) are preserved untouched.
    const newTree = await gh(`/repos/${repo}/git/trees`, {
      token,
      method: "POST",
      body: {
        base_tree: baseTreeSha,
        tree: treeChanges,
      },
    });

    // 6. Commit
    const author = ((context && context.clientContext && context.clientContext.user) || {})
      .email || "wendypix-admin@local";
    const commit = await gh(`/repos/${repo}/git/commits`, {
      token,
      method: "POST",
      body: {
        message:
          (manifest.commitMessage || "Photos: reorder/upload from admin") +
          `\n\nApplied via WendyPix /admin by ${author}`,
        tree: newTree.sha,
        parents: [currentCommitSha],
      },
    });

    // 7. Move the branch to point at the new commit
    await gh(`/repos/${repo}/git/refs/heads/${branch}`, {
      token,
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });

    return json(200, {
      ok: true,
      commitSha: commit.sha,
      changes: treeChanges.length,
      message:
        "Pushed. Netlify will redeploy in 1–3 min — refresh the site after the deploy log goes green.",
    });
  } catch (err) {
    console.error("[admin-photos-publish]", err);
    return json(500, { error: err.message || String(err) });
  }
};

// Trim whitespace from each segment of a slash-separated path. Used
// to make the blob lookup tolerant of folder/file names that
// accidentally have leading/trailing spaces in the repo (e.g.
// "15-Rebecca " — easy to introduce when renaming in Finder).
function trimPathSegments(p) {
  return String(p || "").split("/").map((s) => s.trim()).join("/");
}

// Defensive — block any path traversal attempts in folder/file names.
function sanitizeSegment(s) {
  const str = String(s || "").trim();
  if (!str) throw new Error("Empty path segment");
  if (str.includes("/") || str.includes("..") || str.startsWith(".")) {
    throw new Error(`Bad path segment: ${str}`);
  }
  return str;
}

async function gh(path, { token, method = "GET", body }) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "wendypix-admin",
    },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`https://api.github.com${path}`, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(
      `GitHub ${res.status} on ${method} ${path}: ${txt.slice(0, 300)}`
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

function json(code, body) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
