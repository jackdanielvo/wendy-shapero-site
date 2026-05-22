// admin-hero.js
// --------------------------------------------------------------
// GET + PUT endpoint for the 5 hero photo slots on the home page.
//
// GET   /api/admin-hero
//   Returns the current heroPhotos array from scripts/pixieset.config.json
//   along with the commitSha of the loaded config (for optimistic
//   concurrency on PUT).
//   Response: { heroPhotos: [...], commitSha: "..." }
//
// PUT   /api/admin-hero
//   Body: { heroPhotos: ["valentina","everett",...], commitSha: "...",
//           commitMessage?: "Custom message" }
//   Commits the new array to scripts/pixieset.config.json via the
//   GitHub API and returns the new commit SHA. Validates length (must
//   be 5) and that each slug exists in photos-web/ (or is a valid
//   URL/slug#N reference).
//
// Required env vars (same as the photos endpoints):
//   GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH (default "main")
//
// All requests require a Netlify Identity JWT (Bearer token) — see _auth.js.

const { requireAuth } = require("./_auth");

const CONFIG_PATH = "scripts/pixieset.config.json";
const PHOTOS_PREFIX = "photos-web/";
const IMAGE_RE = /\.(jpe?g|png)$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:#\d+)?$/i;
const URL_OBJ_RE = /^https?:\/\//i;

exports.handler = async (event, context) => {
  const authError = requireAuth(context);
  if (authError) return authError;

  const method = (event.httpMethod || "").toUpperCase();
  if (method !== "GET" && method !== "PUT" && method !== "POST") {
    return json(405, { error: "GET or PUT only" });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) {
    return json(500, {
      error:
        "Hero admin not configured. Set GITHUB_TOKEN and GITHUB_REPO env vars in Netlify.",
    });
  }

  try {
    if (method === "GET") {
      return await handleGet({ token, repo, branch });
    } else {
      // PUT/POST
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }
      return await handlePut({ token, repo, branch, body, context });
    }
  } catch (err) {
    console.error("[admin-hero]", err);
    return json(500, { error: err.message || String(err) });
  }
};

async function handleGet({ token, repo, branch }) {
  // 1. Branch tip → tree SHA
  const refRes = await gh(`/repos/${repo}/git/refs/heads/${branch}`, { token });
  const commitSha = refRes.object.sha;

  // 2. Get the config file's content directly via the contents API
  const contentRes = await gh(
    `/repos/${repo}/contents/${encodeURIComponent(CONFIG_PATH)}?ref=${branch}`,
    { token }
  );

  // GitHub returns content as base64-encoded
  let config;
  try {
    const raw = Buffer.from(contentRes.content || "", "base64").toString("utf8");
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error("Couldn't parse pixieset.config.json: " + e.message);
  }

  return json(200, {
    heroPhotos: Array.isArray(config.heroPhotos) ? config.heroPhotos : [],
    commitSha,
    configBlobSha: contentRes.sha,
  });
}

async function handlePut({ token, repo, branch, body, context }) {
  if (!Array.isArray(body.heroPhotos)) {
    return json(400, { error: "Missing heroPhotos[] in body" });
  }
  if (body.heroPhotos.length !== 5) {
    return json(400, { error: "heroPhotos must have exactly 5 entries" });
  }

  // Validate each entry — either a slug, slug#N, or { url }
  for (let i = 0; i < body.heroPhotos.length; i++) {
    const entry = body.heroPhotos[i];
    if (typeof entry === "string") {
      if (!SLUG_RE.test(entry)) {
        return json(400, { error: `Slot ${i + 1}: invalid slug "${entry}"` });
      }
    } else if (entry && typeof entry === "object" && typeof entry.url === "string") {
      if (!URL_OBJ_RE.test(entry.url)) {
        return json(400, { error: `Slot ${i + 1}: URL must start with http(s)://` });
      }
    } else {
      return json(400, { error: `Slot ${i + 1}: must be a slug or { url }` });
    }
  }

  // 1. Branch tip → check concurrency
  const refRes = await gh(`/repos/${repo}/git/refs/heads/${branch}`, { token });
  const currentCommitSha = refRes.object.sha;
  if (body.commitSha && body.commitSha !== currentCommitSha) {
    return json(409, {
      error:
        "Config changed since you loaded it. Reload the Hero tab and try again.",
      currentCommitSha,
    });
  }

  // 2. Load current config (we need to round-trip ALL the other fields too)
  const contentRes = await gh(
    `/repos/${repo}/contents/${encodeURIComponent(CONFIG_PATH)}?ref=${branch}`,
    { token }
  );
  const raw = Buffer.from(contentRes.content || "", "base64").toString("utf8");
  const config = JSON.parse(raw);

  // 3. Replace heroPhotos and re-serialize with the existing key order
  //    preserved (so the diff is clean and small).
  config.heroPhotos = body.heroPhotos;
  const newContent = JSON.stringify(config, null, 2) + "\n";
  const newContentB64 = Buffer.from(newContent, "utf8").toString("base64");

  // 4. Commit via PUT /repos/.../contents/{path}
  const author =
    ((context && context.clientContext && context.clientContext.user) || {})
      .email || "wendypix-admin@local";
  const commitMessage =
    body.commitMessage ||
    `Hero photos updated via /admin: ${describeHeroes(body.heroPhotos)}`;

  const putRes = await gh(`/repos/${repo}/contents/${encodeURIComponent(CONFIG_PATH)}`, {
    token,
    method: "PUT",
    body: {
      message:
        commitMessage +
        `\n\nApplied via WendyPix /admin by ${author}`,
      content: newContentB64,
      sha: contentRes.sha,
      branch,
    },
  });

  return json(200, {
    ok: true,
    commitSha: putRes.commit && putRes.commit.sha,
    heroPhotos: body.heroPhotos,
    message:
      "Pushed. Netlify will redeploy in 1–3 min — refresh the home page after the deploy log goes green.",
  });
}

function describeHeroes(arr) {
  return arr
    .map((e) => (typeof e === "string" ? e : e && e.url ? "url" : "?"))
    .join(", ");
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
