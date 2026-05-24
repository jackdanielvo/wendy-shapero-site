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
        // If the subject was dragged across categories in admin, its
        // originalCategory points back at the SOURCE category folder,
        // and the file blobs live under that path. Fall back to the
        // current category's old folder if no cross-category move
        // happened.
        const oldCatFolderForSubj = subj.originalCategory
          ? sanitizeSegment(subj.originalCategory)
          : oldCatFolder;

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
            // RENAME or NO-CHANGE or CROSS-CATEGORY MOVE — reuse the
            // existing blob SHA from its source path. The source path
            // uses oldCatFolderForSubj (which respects originalCategory
            // if the subject was dragged between categories).
            const originalFile = sanitizeSegment(
              photo.originalFile || photo.file
            );
            const oldPath = `${PHOTOS_PREFIX}${oldCatFolderForSubj}/${oldSubjFolder}/${originalFile}`;
            let blobSha = blobByPath.get(oldPath);
            if (!blobSha) {
              // Belt-and-suspenders fallback: if the client's
              // originalFile pointer is stale (e.g. a prior publish in
              // this session already moved the photo to newPath but the
              // client didn't re-baseline), look the blob up at the
              // NEW path. If it's already there with the same content,
              // we can still reuse the SHA — this becomes a no-op.
              blobSha = blobByPath.get(newPath);
            }
            if (!blobSha) {
              return json(400, {
                error: `Cannot find original blob for ${oldPath}`,
              });
            }
            // Skip no-ops: if the photo is at the SAME path with the
            // SAME content, GitHub doesn't need a tree entry. Sending
            // hundreds of identical entries on every publish was
            // bloating the request and occasionally tripping GitHub
            // 502s on the /git/trees endpoint.
            if (oldPath === newPath) {
              continue;
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

    // 8. Instagram reminder email — if this publish added any brand-new
    //    subjects (originalFolder is null = client tag for "freshly
    //    created in this session"), email Wendy a "ready to post on IG?"
    //    note with the lead photo attached. Best-effort: any failure
    //    here is logged but does NOT fail the publish — the commit is
    //    already done at this point.
    try {
      await sendInstagramReminders(manifest);
    } catch (err) {
      console.error("[admin-photos-publish] ig reminder failed:", err.message);
    }

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
  // Retry transient 5xx errors with exponential backoff. GitHub
  // occasionally 502s on the trees endpoint and a quick retry
  // usually succeeds. We don't retry 4xx since those are our bug.
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, opts);
    } catch (netErr) {
      // Network-level failure (DNS, connection reset, etc.)
      lastErr = netErr;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw netErr;
    }
    if (res.ok) {
      if (res.status === 204) return null;
      return res.json();
    }
    const txt = await res.text();
    const err = new Error(
      `GitHub ${res.status} on ${method} ${path}: ${txt.slice(0, 300)}`
    );
    // Only retry on transient 5xx (502, 503, 504) or 429 (rate limited).
    // 4xx errors are our bug and won't change on retry.
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

// ============================================================
// Instagram reminder emails.
//
// When Wendy publishes a new subject (added via the admin's "+ New
// subject" button), we email her the lead photo + a suggested caption
// so she can post it on Instagram from her phone. Trigger: any subject
// in the manifest with originalFolder falsy AND at least one photo.
// Path C from the design discussion — no Meta API integration, no
// Zapier dependency, just an email she can act on from her phone.
// ============================================================
async function sendInstagramReminders(manifest) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("[ig-reminder] RESEND_API_KEY not set, skipping");
    return;
  }
  const wendyEmail = process.env.WENDY_EMAIL || "wendy@wendypix.com";

  // Collect brand-new subjects with photos. (originalFolder is null/
  // empty only for subjects the client just created via "+ New subject".
  // An existing subject that was renamed has originalFolder set to the
  // load-time folder, so it correctly doesn't trigger a reminder.)
  const newSubjects = [];
  for (const cat of manifest.categories || []) {
    for (const subj of cat.subjects || []) {
      const isNew = !subj.originalFolder;
      const hasPhotos = Array.isArray(subj.photos) && subj.photos.length > 0;
      if (isNew && hasPhotos) newSubjects.push({ cat, subj });
    }
  }
  if (newSubjects.length === 0) return;

  for (const { cat, subj } of newSubjects) {
    const subjName = stripFolderPrefix(subj.folder);
    const catName = stripFolderPrefix(cat.folder);
    const leadPhoto = subj.photos[0];
    // The lead photo of a brand-new subject is virtually always a
    // pending upload (the subject didn't exist before this publish, so
    // its photos came from drag-drop uploads in this session). Pull
    // the base64 bytes from manifest.uploads to attach.
    const leadKey = leadPhoto && leadPhoto.uploadKey;
    const leadB64 = leadKey && (manifest.uploads || {})[leadKey];
    if (!leadB64) {
      console.log(
        `[ig-reminder] no lead photo bytes for new subject "${subjName}", skipping`
      );
      continue;
    }

    const caption = buildIgCaption(subjName, catName);
    const html = buildIgEmailHtml(subjName, catName, caption);
    const attachmentName =
      subjName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() +
      "-for-instagram.jpg";

    try {
      await resendSend(resendKey, {
        from: "WendyPix Admin <wendy@wendypix.com>",
        to: [wendyEmail],
        subject: `New client added: ${subjName} — ready to post on Instagram?`,
        html,
        attachments: [
          {
            filename: attachmentName,
            content: leadB64,
          },
        ],
      });
      console.log(`[ig-reminder] sent for new subject "${subjName}"`);
    } catch (err) {
      console.error(
        `[ig-reminder] resend failed for "${subjName}":`,
        err.message
      );
    }
  }
}

// Strip the NN- numeric prefix and trim leftover whitespace from a
// folder name. "06-Susan " → "Susan", "1-Women" → "Women".
function stripFolderPrefix(name) {
  return String(name || "")
    .replace(/^\d+-\s*/, "")
    .trim();
}

// Suggested caption Wendy can copy/paste/tweak. Kept friendly but
// generic — she'll know her client and can personalize from there.
// Hashtags pull in a small category-specific set on top of the
// always-on WendyPix tags.
function buildIgCaption(subjName, catName) {
  const baseTags = [
    "#LAPhotographer",
    "#WendyPix",
    "#LosAngelesPhotographer",
    "#PortraitPhotography",
  ];
  const catLower = String(catName || "").toLowerCase();
  const catTags = [];
  if (catLower.includes("women") || catLower.includes("men")) {
    catTags.push("#Headshots", "#ActorHeadshots", "#ExecutiveHeadshots");
  } else if (catLower.includes("kid") || catLower.includes("teen")) {
    catTags.push("#KidsPhotography", "#FamilyPortraits", "#LAKids");
  } else if (catLower.includes("lifestyle")) {
    catTags.push("#LifestylePhotography", "#BrandPhotography", "#OnLocation");
  } else if (catLower.includes("event")) {
    catTags.push("#EventPhotography", "#LAEvents", "#CorporateEvents");
  }
  const allTags = [...baseTags, ...catTags].join(" ");
  return `Welcome ${subjName} to the WendyPix family ✨

A favorite from a recent session — so much fun working together.
New portraits always landing at wendypix.com.

${allTags}`;
}

function buildIgEmailHtml(subjName, catName, caption) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f1ea;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:32px;font-weight:900;letter-spacing:-0.02em;margin:0;">
        <span style="color:#1a1a1a">WENDY</span><span style="color:#b347b9">PIX</span>
      </h1>
    </div>

    <h2 style="font-size:24px;font-weight:900;letter-spacing:-0.01em;color:#1d5e62;margin:0 0 16px;">
      📸 New client added: ${escapeHtmlIg(subjName)}
    </h2>
    <p style="font-size:16px;line-height:1.6;color:#444;margin:0 0 28px;">
      You just published <strong>${escapeHtmlIg(subjName)}</strong> under <strong>${escapeHtmlIg(catName)}</strong>.
      The lead photo is attached to this email — save it to your camera roll,
      then post it to Instagram with the suggested caption below
      (tweak however you like).
    </p>

    <div style="background:#fff;border-left:4px solid #1d5e62;padding:20px 24px;margin:0 0 24px;border-radius:4px;">
      <p style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#1d5e62;margin:0 0 12px;">
        Suggested caption — copy, paste, tweak
      </p>
      <pre style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;white-space:pre-wrap;word-wrap:break-word;margin:0;">${escapeHtmlIg(
        caption
      )}</pre>
    </div>

    <p style="font-size:14px;line-height:1.6;color:#666;margin:0 0 32px;">
      📎 The lead photo is attached below. On your phone, tap it once to preview,
      then tap the share icon to save to your camera roll — or "Save Image."
      From there, open Instagram and post like any other photo.
    </p>

    <p style="font-size:12px;color:#999;margin:32px 0 0;border-top:1px solid #e0d8c8;padding-top:16px;">
      You're getting this because a new client was added at
      <a href="https://wendypix.com/admin" style="color:#1d5e62;text-decoration:none">wendypix.com/admin</a>.
      The email fires automatically on Publish.
    </p>
  </div>
</body></html>`;
}

function escapeHtmlIg(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function resendSend(apiKey, payload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`resend ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}
