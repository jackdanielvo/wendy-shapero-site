// admin-photos-manifest.js
// --------------------------------------------------------------
// GET endpoint that returns the current photos-web/ tree shape to
// the admin UI — with the *real* folder names (including their
// numeric prefixes like "1-Women", "04-Valentina"), not the cleaned
// slugs that the public data/photos.json uses.
//
// We read from GitHub directly (not the local filesystem) so the
// admin sees exactly what's about to be deployed — same source of
// truth as the publish endpoint.
//
// Required env vars:
//   GITHUB_TOKEN  — PAT with "repo" scope (read access is enough for
//                   this endpoint; the publish endpoint also writes)
//   GITHUB_REPO   — "owner/repo" (e.g., "jackdanielvo/wendypix-site")
//   GITHUB_BRANCH — defaults to "main"

const { requireAuth } = require("./_auth");

const PHOTOS_PREFIX = "photos-web/";
const IMAGE_RE = /\.(jpe?g|png)$/i;

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) {
    return json(500, {
      error:
        "Photos admin not configured. Set GITHUB_TOKEN and GITHUB_REPO env vars in Netlify.",
    });
  }

  try {
    // 1. Resolve the branch tip → tree SHA
    const refRes = await gh(`/repos/${repo}/git/refs/heads/${branch}`, { token });
    const commitSha = refRes.object.sha;
    const commitRes = await gh(`/repos/${repo}/git/commits/${commitSha}`, { token });
    const rootTreeSha = commitRes.tree.sha;

    // 2. Recursive tree listing — gives us every path under the repo
    const treeRes = await gh(
      `/repos/${repo}/git/trees/${rootTreeSha}?recursive=1`,
      { token }
    );
    if (treeRes.truncated) {
      // Very unlikely for our repo size but worth surfacing.
      console.warn("[admin-photos-manifest] GitHub tree was truncated");
    }

    // 3. Group photos-web/<cat>/<subj>/<file> into a nested manifest
    const cats = new Map(); // folder → { folder, subjects: Map(folder → {folder, photos:[]}) }
    for (const entry of treeRes.tree) {
      if (entry.type !== "blob") continue;
      if (!entry.path.startsWith(PHOTOS_PREFIX)) continue;
      const rel = entry.path.slice(PHOTOS_PREFIX.length);
      const parts = rel.split("/");
      if (parts.length !== 3) continue; // expect <cat>/<subj>/<file>
      const [catFolder, subjFolder, file] = parts;
      if (!IMAGE_RE.test(file)) continue;
      if (catFolder.startsWith(".")) continue; // skip hidden trash dirs

      if (!cats.has(catFolder)) {
        cats.set(catFolder, { folder: catFolder, subjects: new Map() });
      }
      const cat = cats.get(catFolder);
      if (!cat.subjects.has(subjFolder)) {
        cat.subjects.set(subjFolder, { folder: subjFolder, photos: [] });
      }
      cat.subjects.get(subjFolder).photos.push({ file, sha: entry.sha });
    }

    // 4. Materialize, natural-sort each level
    const naturalCmp = (a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

    const manifest = {
      branch,
      commitSha,
      categories: [...cats.values()]
        .sort((a, b) => naturalCmp(a.folder, b.folder))
        .map((c) => ({
          folder: c.folder,
          subjects: [...c.subjects.values()]
            .sort((a, b) => naturalCmp(a.folder, b.folder))
            .map((s) => ({
              folder: s.folder,
              photos: s.photos
                .sort((a, b) => naturalCmp(a.file, b.file))
                .map((p) => p.file),
            })),
        })),
    };

    return json(200, manifest);
  } catch (err) {
    console.error("[admin-photos-manifest]", err);
    return json(500, { error: err.message || String(err) });
  }
};

async function gh(path, { token }) {
  const opts = {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "wendypix-admin",
    },
  };
  // Retry transient 5xx / 429 with exponential backoff.
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, opts);
    } catch (netErr) {
      lastErr = netErr;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw netErr;
    }
    if (res.ok) return res.json();
    const txt = await res.text();
    const err = new Error(
      `GitHub ${res.status} on ${path}: ${txt.slice(0, 250)}`
    );
    if (res.status >= 500 || res.status === 429) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
    }
    throw err;
  }
  throw lastErr || new Error("GitHub call failed");
}

function json(code, body) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
