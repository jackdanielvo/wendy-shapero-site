/* ============================================================
   Wendy Shapero — Site script
   - Hero photo row with continuous Spencer-style floating motion.
   - Photos open as a full-screen "shoot" takeover (URL-routed via
     hash so each shoot is shareable).
   - Subjects load from data/photos.json (auto-synced from Pixieset)
     and gracefully fall back to a hardcoded Krop dataset if that
     file isn't present yet.
   ============================================================ */

// ============================================================
// LEGACY KROP FALLBACK — used when data/photos.json isn't there.
// You normally won't need to edit any of this; the Pixieset sync
// produces the live data.
// ============================================================
const KROP = (h) => `https://album.krop.com/${h}/850w.jpg`;

const LEGACY_PHOTOS = {
  women: [
    "ea9e93cc0b8046c0","2ec1758036ea4aac","024c0d8ee39a4482","9c5147a6725f42c1",
    "f2215b05ee5444ec","f86b3e722e4e489f","3a6fcee1ba2b489a","015720e6750246eb",
    "5994e85576704141","8f290eff6df64df7","931681e5eeac4e2c","bd3fa8eaeb0c49b8",
    "fac8decd562144af","61a6600bda164c3b","021f102a537f4273","a3b89cc466b348b0",
    "92f658c0c2d04e34","36794aa9191f4a71","153946089a7b4123","790a0722f93f4d3f",
    "02332563844c49bc","c0e016f2f43848a5","1fea9041c0a14c75","d337f98890ce46f1",
    "fe896d4cc2f54061","d232ac5ed84048f7","b12549d8b9f14e24","520ebc4689104e7f"
  ],
  men: [
    "47dd7c07ee664567","b651c2a8af6b4a92","54c20933a2064b0e","1c999e3be1d345e6",
    "965f7e1c6abb4a51","3488b2b1ec6c4a6b","d5ca4a994b8d4d81","1197f19514544be1",
    "fbd743d33afb4432","f848a5ebdcf44d11","694dfa75af4d49f3","60112774dbda4ffa",
    "f7c661dca4564827","36d37dd7abac42db","b82ae8da04614a52","d0df13477589426f",
    "7f4032b5a0fb41da","f657586f87f846a0","a2a59d4b6b144d83"
  ],
  kids: [
    "bbe3464b1c664d6f","8a121179eeda4ddf","7ac372850acb4ffc","cc4a2674df984438",
    "e87d478866b64a52","ffd366f6c4824449","27fb9eb35b224f7a","b81fb4de9621470a",
    "b37aac1c58724c73","ef1cd3ecb708486a"
  ],
  animals: [
    "c36c324a069e4ebe","a0e68e208d524aae","4bdcb7f7304c4732","30bb66a92fef436b",
    "51b508db15d340e6","df1b253f12a844be","81027d403e1f41c2","887da5fea29245b4",
    "2edae965276446f0"
  ],
  products: [
    "6316e849ec3c4ff7","032ed84d336f43ed","1dceb0b1bb5d4831","fc2841e2a5ba43d2",
    "7c9b441c128c4624","00167304773b477b","77abd05f15164288"
  ]
};

const CAT_LABEL = {
  women:    "Women",
  men:      "Men",
  kids:     "Kids & Families",
  animals:  "Animals",
  products: "Products",
  events:   "Events",
  headshots:"Headshots"
};

// ============================================================
// Subject loading — Pixieset JSON first, Krop fallback.
// ============================================================
function loadSubjects() {
  // 1) Auto-synced Pixieset data is loaded as a sibling <script src="data/photos.js">
  //    that sets window.WENDY_PHOTOS — works over file:// too (no fetch).
  const synced = window.WENDY_PHOTOS;
  if (synced && Array.isArray(synced.subjects) && synced.subjects.length) {
    return {
      source: "pixieset",
      generatedAt: synced.generatedAt,
      featured: Array.isArray(synced.featured) ? synced.featured.slice() : null,
      heroPhotos: Array.isArray(synced.heroPhotos) ? synced.heroPhotos.slice() : null,
      // Grid curation: allowlist of slugs (in order), blocklist of slugs,
      // and per-shoot thumbnail overrides. All optional.
      gridShoots: Array.isArray(synced.gridShoots) ? synced.gridShoots.slice() : null,
      excludeShoots: Array.isArray(synced.excludeShoots) ? synced.excludeShoots.slice() : null,
      leadPhotos: (synced.leadPhotos && typeof synced.leadPhotos === "object") ? { ...synced.leadPhotos } : null,
      // Editorial mode: when categories is non-null, the home page renders
      // one carousel section per category instead of Featured + grid.
      categories: Array.isArray(synced.categories) ? synced.categories.slice() : null,
      subjects: synced.subjects.map((s, i) => ({
        id: s.id || s.slug,
        cat: s.cat || "events",
        label: s.title || s.label,
        date: s.date || null,
        num: i + 1,
        photoUrls: (s.photos || []).map((p) =>
          typeof p === "string" ? p : (p.url || p)
        ),
      })),
    };
  }
  // 2) Fallback: build from the hardcoded Krop dataset
  const subjects = [];
  for (const cat of Object.keys(LEGACY_PHOTOS)) {
    let idx = 1;
    for (const hash of LEGACY_PHOTOS[cat]) {
      subjects.push({
        id: `${cat}-${String(idx).padStart(2, "0")}`,
        cat,
        date: null,
        num: idx,
        photoUrls: [KROP(hash)],
      });
      idx++;
    }
  }
  return { source: "legacy", subjects };
}

// ============================================================
// Util
// ============================================================
function seededShuffle(arr, seed = 7) {
  const a = arr.slice();
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function catLabel(cat) {
  return CAT_LABEL[cat] || (cat ? cat[0].toUpperCase() + cat.slice(1) : "Other");
}

// ============================================================
// State
// ============================================================
let SUBJECTS = [];
let SUBJECT_BY_ID = {};

// ============================================================
// HERO — Spencer-style floating photo row
// ============================================================
function buildHero(subjects, categories, heroPhotosConfig) {
  const row = document.getElementById("heroImages");
  if (!row) return;
  row.innerHTML = "";
  // Each hero card represents a CATEGORY rather than a single shoot.
  // Click a card to scroll to that category's section on the page.
  // The card photo is auto-picked as the first photo of the first
  // subject in the category — but heroPhotos config can override this
  // per category by listing a specific subject slug (or "slug#index").
  const overrides = buildHeroOverrideMap(subjects, heroPhotosConfig);
  (categories || []).slice(0, 5).forEach((cat) => {
    const subjectsInCat = subjects.filter((s) => s.cat === cat.slug);
    if (!subjectsInCat.length) return;
    const override = overrides[cat.slug];
    const photoUrl = override || subjectsInCat[0].photoUrls[0];
    const label = cat.label || cat.slug;

    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className = "hero__image";
    wrap.dataset.targetSlug = cat.slug;
    wrap.setAttribute("aria-label", `Browse ${label}`);

    const img = document.createElement("img");
    img.src = photoUrl;
    img.alt = "";
    img.loading = "eager";
    img.decoding = "async";
    wrap.appendChild(img);

    // Always-visible category label below the photo. We keep it inside
    // the same .hero__image button so the entire card (photo + label)
    // is one click target — no risk of taps falling through.
    const labelEl = document.createElement("span");
    labelEl.className = "hero__image__label caps";
    labelEl.textContent = label;
    wrap.appendChild(labelEl);

    // Click a card → smooth-scroll to that category's <section>.
    wrap.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.querySelector(
        `.category-section[data-slug="${cat.slug}"]`
      );
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    row.appendChild(wrap);
  });
  startHeroDrift(row);
}

// Walk heroPhotos config and build a map of category-slug → photo URL,
// so any explicit picks in the config win over the auto-default ("first
// photo of first subject in the category"). The first entry that
// resolves into a category fills that category's slot; later entries
// for the same category are ignored. Useful when Wendy wants a
// specific shot to represent a category in the hero row.
function buildHeroOverrideMap(subjects, heroPhotosConfig) {
  const map = {};
  if (!Array.isArray(heroPhotosConfig)) return map;
  const byId = Object.fromEntries(subjects.map((s) => [s.id, s]));
  for (const entry of heroPhotosConfig) {
    const resolved = resolveHeroEntry(entry, byId);
    if (!resolved) continue;
    // Find which category this photo's subject belongs to.
    const subj = resolved.subjectId ? byId[resolved.subjectId] : null;
    const cat = subj ? subj.cat : null;
    if (!cat || map[cat]) continue;  // already filled
    map[cat] = resolved.url;
  }
  return map;
}

// Resolve a single heroPhotos config entry into a photo URL.
// An entry can be:
//   - a string slug          → that subject's lead (first) photo
//   - "slug#3"                → that subject's photo at index 3 (zero-based)
//   - { slug, index }         → same as above
//   - { url: "https://..." }  → use this URL directly (lets Wendy pin a
//                                specific image even if the slug isn't on the
//                                Pixieset homepage yet)
function resolveHeroEntry(entry, byId) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const m = entry.match(/^([\w-]+)(?:#(\d+))?$/);
    if (!m) return null;
    const subj = byId[m[1]];
    if (!subj) return null;
    const idx = m[2] ? parseInt(m[2], 10) : 0;
    return {
      url: subj.photoUrls[idx] || subj.photoUrls[0],
      subjectId: subj.id,
    };
  }
  if (typeof entry === "object") {
    // URL-pinned: we have no shoot association, so subjectId stays null.
    if (entry.url) return { url: entry.url, subjectId: null };
    if (entry.slug) {
      const subj = byId[entry.slug];
      if (!subj) return null;
      return {
        url: subj.photoUrls[entry.index || 0] || subj.photoUrls[0],
        subjectId: subj.id,
      };
    }
  }
  return null;
}

function pickHeroes(subjects, heroPhotosConfig, n) {
  if (!subjects.length) return [];
  // 1) Wendy's explicit curation wins.
  if (Array.isArray(heroPhotosConfig) && heroPhotosConfig.length) {
    const byId = Object.fromEntries(subjects.map((s) => [s.id, s]));
    const picks = heroPhotosConfig
      .map((e) => resolveHeroEntry(e, byId))
      .filter(Boolean);
    if (picks.length) return picks.slice(0, n);
  }
  // 2) Auto: lead photo from up to n distinct categories, then fill with the rest.
  const byCat = new Map();
  for (const s of subjects) {
    if (!byCat.has(s.cat)) byCat.set(s.cat, { url: s.photoUrls[0], subjectId: s.id });
  }
  const fromCats = Array.from(byCat.values()).slice(0, n);
  const taken = new Set(fromCats.map((h) => h.url));
  const extras = subjects
    .filter((s) => !taken.has(s.photoUrls[0]))
    .map((s) => ({ url: s.photoUrls[0], subjectId: s.id }));
  return [...fromCats, ...extras].slice(0, n);
}

// Fullscreen single-photo viewer for URL-pinned hero cards (no shoot to
// open). Tap or click anywhere on it (or press Esc) to dismiss.
function openLightbox(url) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML =
    `<button class="lightbox__close" aria-label="Close">&times;</button>` +
    `<img src="${url}" alt="" />`;
  document.body.appendChild(lb);
  document.body.classList.add("shoot-open");
  function close() {
    lb.classList.remove("open");
    document.body.classList.remove("shoot-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => lb.remove(), 250);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  lb.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  // Force one frame so the open class triggers a transition rather than
  // appearing instantly.
  requestAnimationFrame(() => lb.classList.add("open"));
}
function startHeroDrift(row) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // On touch devices the row is a scroll-snap carousel (see CSS @media).
  // Bounds-clamping each card to the viewport would pull off-screen cards
  // back to the visible edge — wrong on a scrollable container — so skip
  // it on touch. Wander still runs, the spring just stays at rest with
  // no mouse input.
  const isTouch = window.matchMedia("(hover: none)").matches ||
                  window.matchMedia("(pointer: coarse)").matches;
  // On mobile, also center the carousel on the middle card on first load
  // so the user sees a balanced view (one centered, neighbors peeking).
  if (isTouch) {
    setTimeout(() => {
      const cards = row.querySelectorAll(".hero__image");
      if (cards.length >= 3) {
        const middle = cards[Math.floor(cards.length / 2)];
        middle.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
      }
    }, 100);
  }
  const imgs = Array.from(row.querySelectorAll("img"));
  const start = performance.now();
  let lastT = start;

  // Per-card seeds. Two layers of motion are blended together:
  //  1) A subtle continuous "wander" (layered sines)         — the alive idle.
  //  2) A spring that chases a mouse-driven target           — the elastic kick.
  // The spring is what makes the motion feel rubbery: it overshoots, wobbles,
  // and settles, instead of linearly interpolating like the previous version.
  const seeds = imgs.map((_, i) => {
    const idx = i - (imgs.length - 1) / 2; // signed index, e.g. -2..-1..0..1..2
    return {
      // Idle wander
      pX: i * 1.7 + 0.3, pY: i * 2.1 + 1.1, pR: i * 1.3 + 0.7,
      aX: 12 + (i % 2) * 5,                 // softer than before — spring carries more of the energy
      aY:  5 + ((i + 1) % 2) * 2,           // tighter Y wander so cards don't drift into adjacent text
      aR: 0.7 + (i % 3) * 0.3,
      sX: 0.34 + i * 0.04, sY: 0.27 + i * 0.05, sR: 0.21 + i * 0.03,
      // Spring "depths" — outer cards target a bigger offset on cursor extremes.
      // Y depth halved from prior version so mouse-driven motion stays
      // inside the row's allotted space on shorter laptop viewports.
      depthX: idx * 80,
      depthY: 18 - Math.abs(idx) * 5,
      depthR: idx * 5,
      // Spring physics constants per axis. Slightly varied per card so they
      // don't all wobble in lockstep — feels more like Jell-O than a rigid rig.
      // damping ratio ≈ c / (2*sqrt(k))  → ~0.5 for noticeable bounce.
      kX: 95 + (i % 3) * 18, cX: 10.5 + (i % 2) * 1.5,
      kY: 105 + (i % 3) * 14, cY: 11.5 + (i % 2) * 1.2,
      kR: 80 + (i % 3) * 12,  cR: 9.5 + (i % 2) * 0.8,
    };
  });

  // Per-card spring state.
  const springs = imgs.map(() => ({ x: 0, vx: 0, y: 0, vy: 0, r: 0, vr: 0 }));

  // Mouse target — fed straight into the spring (no pre-lerp; the spring is
  // the smoother, and that's where the rubbery feel lives).
  let targetMX = 0, targetMY = 0;
  function onMove(e) {
    const r = row.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top  + r.height / 2;
    // Slightly under-scaled so even at viewport edges the targets are reasonable
    // — bounds clamping is the safety net, but we want the spring to feel
    // like it's reaching, not slamming the wall.
    targetMX = Math.max(-1.05, Math.min(1.05, (e.clientX - cx) / (r.width / 2)));
    targetMY = Math.max(-1.05, Math.min(1.05, (e.clientY - cy) / (r.height / 2)));
  }
  function onLeave() { targetMX = 0; targetMY = 0; }
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("mouseleave", onLeave, { passive: true });

  // Per-card horizontal travel limits so cards never escape the viewport.
  // Recomputed on resize; tracks each card's natural (zero-offset) rect.
  const PAD = 8;
  let bounds = imgs.map(() => ({ minX: -Infinity, maxX: Infinity }));
  function recomputeBounds() {
    bounds = imgs.map((img) => {
      const ox = img.style.getPropertyValue("--ox");
      const oy = img.style.getPropertyValue("--oy");
      img.style.setProperty("--ox", "0px");
      img.style.setProperty("--oy", "0px");
      const r = img.getBoundingClientRect();
      img.style.setProperty("--ox", ox || "0px");
      img.style.setProperty("--oy", oy || "0px");
      const vw = window.innerWidth;
      const minX = -r.left + PAD;
      const maxX = vw - r.right - PAD;
      return {
        minX: Number.isFinite(minX) ? minX : 0,
        maxX: Number.isFinite(maxX) ? maxX : 0,
      };
    });
  }
  setTimeout(recomputeBounds, 100);
  window.addEventListener("resize", recomputeBounds);

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function frame(now) {
    const t = (now - start) / 1000;
    let dt = (now - lastT) / 1000;
    // Cap dt to keep the spring stable after tab-switch / long pause.
    if (dt > 0.04) dt = 0.04;
    lastT = now;

    for (let i = 0; i < imgs.length; i++) {
      const s = seeds[i];
      const sp = springs[i];

      // 1) Idle wander (single-layer sines — calmer than before)
      const wx = Math.sin(t * s.sX + s.pX) * s.aX;
      const wy = Math.cos(t * s.sY + s.pY) * s.aY;
      const wr = Math.sin(t * s.sR + s.pR) * s.aR;

      // 2) Spring chases the mouse-driven target.  Hooke + viscous damping:
      //      acc = (target - x) * k  -  v * c
      //    With k ~ 100, c ~ 11 → underdamped → it overshoots, wobbles, settles.
      const tX = targetMX * s.depthX;
      const tY = targetMY * s.depthY;
      const tR = targetMX * s.depthR;
      const aX = (tX - sp.x) * s.kX - sp.vx * s.cX;
      const aY = (tY - sp.y) * s.kY - sp.vy * s.cY;
      const aR = (tR - sp.r) * s.kR - sp.vr * s.cR;
      sp.vx += aX * dt; sp.x += sp.vx * dt;
      sp.vy += aY * dt; sp.y += sp.vy * dt;
      sp.vr += aR * dt; sp.r += sp.vr * dt;

      // Composite + clamp so the card stays on-screen even mid-overshoot —
      // but skip the clamp on touch, where the row is a scrollable
      // carousel and "viewport bounds" don't apply per-card.
      // Y is also clamped to a hard ±25px safety range so on shorter
      // viewports the cards don't drift up into the title or down into
      // the category labels below.
      const b = bounds[i];
      const composedX = wx + sp.x;
      const composedY = wy + sp.y;
      const x = isTouch ? composedX : clamp(composedX, b.minX, b.maxX);
      const y = isTouch ? composedY : clamp(composedY, -25, 25);
      imgs[i].style.setProperty("--ox", x.toFixed(2) + "px");
      imgs[i].style.setProperty("--oy", y.toFixed(2) + "px");
      imgs[i].style.setProperty("--rot", (wr + sp.r).toFixed(2) + "deg");
    }
    rafId = requestAnimationFrame(frame);
  }
  let rafId = requestAnimationFrame(frame);

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && !rafId) {
        lastT = performance.now();   // reset dt on resume so spring doesn't lurch
        rafId = requestAnimationFrame(frame);
      } else if (!e.isIntersecting && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    });
  });
  io.observe(row);
}

// ============================================================
// FEATURED — Wendy's hand-picked shoots (or hidden if she hasn't picked any)
//
// Source of truth (in priority order):
//   1. window.WENDY_PHOTOS.featured = ["slug1", "slug2", ...]
//   2. (no fallback) — the section is hidden, since the main grid below
//      already shows every shoot.
//
// To curate, edit `featured` in scripts/pixieset.config.json — or, for a
// quick local override, scripts/featured.local.json — and re-run sync.
// ============================================================
function buildFeatured(subjects, featuredSlugs) {
  const section = document.querySelector(".featured");
  const carousel = document.getElementById("featuredCarousel");
  const dotsEl   = document.getElementById("featuredDots");
  if (!section || !carousel) return;
  carousel.innerHTML = "";
  if (dotsEl) dotsEl.innerHTML = "";

  const subjectsById = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const picks = (featuredSlugs || [])
    .map((slug) => subjectsById[slug])
    .filter(Boolean);
  // No picks → hide the whole section so we don't show an arbitrary curation.
  if (!picks.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  // Start with the middle item focal — like Spencer's site, the carousel
  // is balanced on first paint with one flank on each side.
  let active = Math.min(picks.length - 1, Math.floor(picks.length / 2));

  // Build a tile per pick and a dot per pick. Tiles use button (so it's
  // keyboard-activatable); dots are buttons too.
  const tiles = picks.map((subj, i) => {
    const tile = document.createElement("button");
    tile.className = "ftile";
    tile.dataset.i = i;
    tile.dataset.subjectId = subj.id;
    tile.setAttribute("aria-label",
      `${subj.label || catLabel(subj.cat)} — featured shoot ${i + 1} of ${picks.length}`);
    tile.innerHTML =
      `<img src="${subj.photoUrls[0]}" alt="" loading="lazy"/>` +
      `<span class="ftile__label caps">${subj.label || catLabel(subj.cat)}</span>`;
    tile.addEventListener("click", () => {
      // Click the focal tile → open the shoot. Click a flank → rotate it
      // to focus first; the user clicks again to open. Same UX as Spencer's.
      if (i === active) {
        openShoot(subj.id);
      } else {
        active = i;
        layout();
      }
    });
    carousel.appendChild(tile);
    return tile;
  });

  const dots = picks.map((_, i) => {
    if (!dotsEl) return null;
    const dot = document.createElement("button");
    dot.setAttribute("aria-label", `Show featured shoot ${i + 1}`);
    dot.addEventListener("click", () => { active = i; layout(); });
    dotsEl.appendChild(dot);
    return dot;
  });

  function layout() {
    tiles.forEach((tile, i) => {
      const rel = i - active;
      tile.classList.remove("active", "flank-left", "flank-right", "far-left", "far-right");
      if (rel === 0)        tile.classList.add("active");
      else if (rel === -1)  tile.classList.add("flank-left");
      else if (rel === 1)   tile.classList.add("flank-right");
      else if (rel < -1)    tile.classList.add("far-left");
      else                  tile.classList.add("far-right");
    });
    dots.forEach((dot, i) => {
      if (!dot) return;
      dot.classList.toggle("on", i === active);
    });
  }
  layout();

  // Keyboard nav when the carousel container has focus. Arrow Left/Right
  // shifts active by one (clamped — non-wrapping, like Spencer's). Enter
  // / Space on the focused tile is already handled by the <button> default.
  carousel.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && active > 0) {
      active--; layout(); e.preventDefault();
    } else if (e.key === "ArrowRight" && active < tiles.length - 1) {
      active++; layout(); e.preventDefault();
    }
  });

  // Drag / swipe nav. Works for mouse drag on desktop AND touch swipe on
  // mobile via the unified PointerEvent API. A horizontal drag past the
  // threshold (or a fast flick) advances the carousel by one tile in
  // the matching direction. A short stationary press still registers as
  // a tile tap (we suppress the synthesized click only when an actual
  // drag happened).
  let dragStartX = null;
  let dragStartT = 0;
  let dragPointerId = null;
  let didDrag = false;
  let clickSwallow = null;    // currently-installed click suppressor, if any
  let swallowTimer = 0;
  function clearSwallow() {
    if (clickSwallow) {
      carousel.removeEventListener("click", clickSwallow, { capture: true });
      clickSwallow = null;
    }
    if (swallowTimer) { clearTimeout(swallowTimer); swallowTimer = 0; }
  }
  carousel.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearSwallow();              // any stale suppressor must not survive
    dragStartX = e.clientX;
    dragStartT = performance.now();
    dragPointerId = e.pointerId;
    didDrag = false;
    // NOTE: we deliberately do NOT setPointerCapture here. Capturing on
    // pointerdown breaks click synthesization on inner <button> tiles in
    // some browsers (the click goes to the carousel, not the tile).
    // We capture only once we've decided it's a drag — see pointermove.
  });
  carousel.addEventListener("pointermove", (e) => {
    if (dragStartX === null) return;
    if (Math.abs(e.clientX - dragStartX) > 15) {
      if (!didDrag) {
        didDrag = true;
        // Now that it's clearly a drag, take pointer capture so the gesture
        // doesn't get hijacked if it leaves the carousel bounds.
        try { carousel.setPointerCapture(dragPointerId); } catch (_) {}
      }
    }
  });
  carousel.addEventListener("pointerup", (e) => {
    if (dragStartX === null) return;
    const dx = e.clientX - dragStartX;
    const dt = performance.now() - dragStartT;
    dragStartX = null;
    if (!didDrag) return;        // pure tap — let the tile click fire
    // Threshold: 50px static, or 20px + 0.4 px/ms flick for snappy users
    const fast = Math.abs(dx) > 20 && Math.abs(dx) / Math.max(dt, 1) > 0.4;
    const isSwipe = Math.abs(dx) > 50 || fast;
    if (!isSwipe) return;
    // Only install the click swallow when we actually advance — otherwise a
    // small drag that doesn't move the carousel would still nuke the tap.
    clickSwallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); clearSwallow(); };
    carousel.addEventListener("click", clickSwallow, { capture: true });
    swallowTimer = setTimeout(clearSwallow, 500);  // safety: don't outlive the gesture
    if (dx > 0 && active > 0) { active--; layout(); }
    else if (dx < 0 && active < tiles.length - 1) { active++; layout(); }
  });
  carousel.addEventListener("pointercancel", () => {
    dragStartX = null; didDrag = false;
  });

  // Mouse-wheel nav. Wheeling up while hovering the carousel = previous,
  // wheeling down = next. Throttled so a single gesture advances at most
  // one step. Once the carousel is at either end, wheel events pass
  // through and the page scrolls normally — so the user is never trapped.
  let wheelLockUntil = 0;
  carousel.addEventListener("wheel", (e) => {
    // Prefer whichever axis the input is dominantly using. Most mice send
    // deltaY; some trackpads send deltaX for horizontal wheels.
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 4) return;          // ignore stray micro-events

    const wantsForward = delta > 0;
    const canForward   = active < tiles.length - 1;
    const canBackward  = active > 0;
    // At the edges, let the page scroll naturally — don't trap the user.
    if (wantsForward && !canForward)   return;
    if (!wantsForward && !canBackward) return;

    e.preventDefault();                       // we're consuming this event
    const now = performance.now();
    if (now < wheelLockUntil) return;         // throttle: 1 advance per gesture

    if (wantsForward) active++; else active--;
    layout();
    // ~350ms cooldown — long enough to absorb macOS momentum-scroll trains
    // but short enough that a deliberate second flick still registers.
    wheelLockUntil = now + 350;
  }, { passive: false });
}

// ============================================================
// CATEGORY SECTION (editorial mode)
//
// Renders one Spencer-style carousel section per category. Each tile is
// the LEAD photo of a different *person* (subject) within that category.
// Tapping any tile opens that person's full set of photos in the existing
// fullscreen shoot view (currently 3 photos per person, by convention).
//
// The DOM is built dynamically and appended below the About section, so
// the home page can have any number of category sections.
// ============================================================
function buildCategorySection(people, catConfig, anchorBefore) {
  const main = document.querySelector("main");
  if (!main || !people || !people.length) return;

  const section = document.createElement("section");
  section.className = "featured category-section";
  section.dataset.slug = catConfig.slug;
  const labelHtml = escapeHtml(catConfig.label || catConfig.slug);
  const subHtml = catConfig.subtitle
    ? `<p class="featured-sub">${escapeHtml(catConfig.subtitle)}</p>`
    : "";
  section.innerHTML = `
    <h2 class="display">${labelHtml}</h2>
    ${subHtml}
    <div class="featured-carousel" tabindex="0"
         role="region" aria-roledescription="carousel" aria-label="${labelHtml}">
    </div>
    <div class="featured-dots" aria-hidden="true"></div>
  `;
  // Insert above the contact spacer so each section sits in the editorial
  // flow between About and Contact.
  if (anchorBefore && anchorBefore.parentNode === main) {
    main.insertBefore(section, anchorBefore);
  } else {
    main.appendChild(section);
  }

  const carousel = section.querySelector(".featured-carousel");
  const dotsEl   = section.querySelector(".featured-dots");
  let active = Math.min(people.length - 1, Math.floor(people.length / 2));

  // Build a tile per person. Each tile shows the person's lead photo and
  // their name as a pill label below. Click opens their shoot.
  const tiles = people.map((subj, i) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "ftile";
    tile.dataset.subjectId = subj.id;
    const personLabel = subj.label || subj.title || subj.id;
    tile.setAttribute(
      "aria-label",
      `${personLabel} — open photos (${i + 1} of ${people.length})`
    );
    const lead = (subj.photoUrls && subj.photoUrls[0]) || "";
    tile.innerHTML =
      `<img src="${lead}" alt="" loading="lazy"/>` +
      `<span class="ftile__label caps">${escapeHtml(personLabel)}</span>`;
    tile.addEventListener("click", () => {
      if (i === active) openShoot(subj.id);
      else { active = i; layout(); }
    });
    carousel.appendChild(tile);
    return tile;
  });

  const dots = people.map((_, i) => {
    const dot = document.createElement("button");
    dot.setAttribute("aria-label", `Show person ${i + 1}`);
    dot.addEventListener("click", () => { active = i; layout(); });
    dotsEl.appendChild(dot);
    return dot;
  });

  function layout() {
    tiles.forEach((tile, i) => {
      const rel = i - active;
      tile.classList.remove("active", "flank-left", "flank-right", "far-left", "far-right");
      if (rel === 0)        tile.classList.add("active");
      else if (rel === -1)  tile.classList.add("flank-left");
      else if (rel === 1)   tile.classList.add("flank-right");
      else if (rel < -1)    tile.classList.add("far-left");
      else                  tile.classList.add("far-right");
    });
    dots.forEach((dot, i) => dot.classList.toggle("on", i === active));
  }
  layout();

  // Same nav surface as Featured Work: keyboard arrows, mouse wheel,
  // touch/mouse drag-to-advance.
  carousel.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && active > 0) { active--; layout(); e.preventDefault(); }
    else if (e.key === "ArrowRight" && active < tiles.length - 1) { active++; layout(); e.preventDefault(); }
  });

  let dragStartX = null, dragStartT = 0, dragPointerId = null, didDrag = false;
  let clickSwallow = null, swallowTimer = 0;
  function clearSwallow() {
    if (clickSwallow) {
      carousel.removeEventListener("click", clickSwallow, { capture: true });
      clickSwallow = null;
    }
    if (swallowTimer) { clearTimeout(swallowTimer); swallowTimer = 0; }
  }
  carousel.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearSwallow();              // any stale suppressor must not survive
    dragStartX = e.clientX; dragStartT = performance.now();
    dragPointerId = e.pointerId; didDrag = false;
    // Don't setPointerCapture here — it would block click synthesization
    // on inner <button> tiles. Capture only once a drag is confirmed.
  });
  carousel.addEventListener("pointermove", (e) => {
    if (dragStartX === null) return;
    if (Math.abs(e.clientX - dragStartX) > 15) {
      if (!didDrag) {
        didDrag = true;
        try { carousel.setPointerCapture(dragPointerId); } catch (_) {}
      }
    }
  });
  carousel.addEventListener("pointerup", (e) => {
    if (dragStartX === null) return;
    const dx = e.clientX - dragStartX;
    const dt = performance.now() - dragStartT;
    dragStartX = null;
    if (!didDrag) return;
    const fast = Math.abs(dx) > 20 && Math.abs(dx) / Math.max(dt, 1) > 0.4;
    const isSwipe = Math.abs(dx) > 50 || fast;
    if (!isSwipe) return;
    // Only install click swallow when we actually advance the carousel.
    clickSwallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); clearSwallow(); };
    carousel.addEventListener("click", clickSwallow, { capture: true });
    swallowTimer = setTimeout(clearSwallow, 500);
    if (dx > 0 && active > 0) { active--; layout(); }
    else if (dx < 0 && active < tiles.length - 1) { active++; layout(); }
  });
  carousel.addEventListener("pointercancel", () => { dragStartX = null; didDrag = false; });

  let wheelLockUntil = 0;
  carousel.addEventListener("wheel", (e) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 4) return;
    const wantsForward = delta > 0;
    const canForward   = active < tiles.length - 1;
    const canBackward  = active > 0;
    if (wantsForward && !canForward)   return;
    if (!wantsForward && !canBackward) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLockUntil) return;
    if (wantsForward) active++; else active--;
    layout();
    wheelLockUntil = now + 350;
  }, { passive: false });
}

// Tiny helper so HTML strings injected via innerHTML can't introduce XSS
// from data file values.
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Resolve the thumbnail URL for a grid tile. Falls back to the shoot's
// first photo when no override is configured for this subject.
function resolveLeadPhoto(subj, leadPhotos) {
  const fallback = subj.photoUrls[0];
  if (!leadPhotos) return fallback;
  const pick = leadPhotos[subj.id];
  if (pick == null) return fallback;
  // Number → photo index into this subject's photo list.
  if (typeof pick === "number" && Number.isFinite(pick)) {
    return subj.photoUrls[pick] || fallback;
  }
  if (typeof pick === "string") {
    // Full URL → pin it directly.
    if (/^https?:\/\//i.test(pick)) return pick;
    // "slug#3" or "#3" → pull a specific index from this subject.
    const m = pick.match(/#(\d+)$/);
    if (m) return subj.photoUrls[parseInt(m[1], 10)] || fallback;
    // Bare numeric string fallback.
    const n = parseInt(pick, 10);
    if (!isNaN(n)) return subj.photoUrls[n] || fallback;
  }
  // Object form: { index } or { url }.
  if (typeof pick === "object") {
    if (pick.url) return pick.url;
    if (typeof pick.index === "number") return subj.photoUrls[pick.index] || fallback;
  }
  return fallback;
}

// ============================================================
// UNIFORM GRID — every subject's lead photo, with optional curation.
//   - gridShoots:   allowlist + display order (empty → show all, shuffled)
//   - excludeShoots: blocklist applied after gridShoots
//   - leadPhotos:   per-shoot thumbnail override (index, "slug#3", or URL)
// ============================================================
function buildGrid(subjects, gridShoots, excludeShoots, leadPhotos) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  // 1) Pick + order the list of shoots to render.
  let list;
  if (Array.isArray(gridShoots) && gridShoots.length) {
    // Allowlist mode: render exactly these slugs in this order. Unknown
    // slugs are silently skipped so a typo or stale entry won't break the page.
    const byId = Object.fromEntries(subjects.map((s) => [s.id, s]));
    list = gridShoots.map((slug) => byId[slug]).filter(Boolean);
  } else {
    // Default: every shoot, in a stable shuffled order.
    list = seededShuffle(subjects);
  }
  // 2) Apply the blocklist.
  if (Array.isArray(excludeShoots) && excludeShoots.length) {
    const blocked = new Set(excludeShoots);
    list = list.filter((s) => !blocked.has(s.id));
  }

  list.forEach((subj, i) => {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.dataset.cat = subj.cat;
    tile.dataset.subjectId = subj.id;
    // --i drives the staggered phase of the continuous bob (CSS animation
    // delay). --hover-rot gives each tile a deterministic-but-varied tilt
    // on hover, so adjacent tiles lean different directions — echoes the
    // hero cards' alternating base rotations.
    tile.style.setProperty("--i", i);
    const rot = (((i * 73 + 11) % 41) - 20) / 10; // pseudo-random in ~[-2°, +2°]
    tile.style.setProperty("--hover-rot", rot.toFixed(2) + "deg");
    tile.setAttribute("aria-label", `Open ${catLabel(subj.cat)} shoot`);
    // 3) Resolve the thumbnail: config override > shoot's first photo.
    const leadUrl = resolveLeadPhoto(subj, leadPhotos);
    tile.innerHTML = `
      <img src="${leadUrl}"
           alt="${catLabel(subj.cat)} portrait by Wendy Shapero" loading="lazy"/>
      <span class="cat">${subj.label || catLabel(subj.cat)}</span>
      <span class="view">View shoot &rarr;</span>
    `;
    tile.addEventListener("click", () => openShoot(subj.id));
    grid.appendChild(tile);
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { rootMargin: "0px 0px -10% 0px" });
  grid.querySelectorAll(".tile").forEach((t) => io.observe(t));
}

// ============================================================
// FILTERS — built dynamically from categories present
// ============================================================
function buildFilters(subjects) {
  const filters = document.getElementById("filters");
  if (!filters) return;
  const cats = Array.from(new Set(subjects.map((s) => s.cat)));
  filters.innerHTML = "";
  const all = btn("all", "All", true);
  filters.appendChild(all);
  cats.forEach((cat) => filters.appendChild(btn(cat, catLabel(cat), false)));
  function btn(cat, label, active) {
    const b = document.createElement("button");
    b.className = "filter" + (active ? " active" : "");
    b.dataset.cat = cat;
    b.textContent = label;
    b.addEventListener("click", () => {
      filters.querySelectorAll(".filter").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.querySelectorAll(".grid .tile").forEach((tile) => {
        const show = cat === "all" || tile.dataset.cat === cat;
        tile.classList.toggle("hidden", !show);
      });
    });
    return b;
  }
}

// ============================================================
// SHOOT VIEW — full-screen subject takeover with URL routing
// ============================================================
const shootEl = () => document.getElementById("shoot");

function openShoot(subjectId, opts = {}) {
  const subj = SUBJECT_BY_ID[subjectId];
  if (!subj) return;
  const sh = shootEl();
  sh.querySelector('[data-role="cat"]').textContent = catLabel(subj.cat);
  sh.querySelector('[data-role="num"]').textContent =
    subj.label
      ? subj.label
      : `Shoot No. ${String(subj.num).padStart(2, "0")}`;
  const body = document.getElementById("shootBody");
  body.innerHTML = "";
  subj.photoUrls.forEach((url) => {
    const fig = document.createElement("figure");
    fig.className = "shoot__photo";
    fig.innerHTML = `<img src="${url}" alt="${catLabel(subj.cat)} portrait by Wendy Shapero" />`;
    body.appendChild(fig);
  });
  // Optional: a date line under the breadcrumb
  if (subj.date) {
    const dateEl = sh.querySelector('[data-role="date"]');
    if (dateEl) dateEl.textContent = subj.date;
  }
  sh.classList.add("open");
  document.body.classList.add("shoot-open");
  sh.setAttribute("aria-hidden", "false");
  body.scrollTop = 0;
  sh.scrollTop = 0;
  if (!opts.fromHash) {
    history.pushState({ subjectId }, "", `#/shoot/${subjectId}`);
  }
  shootEl().dataset.subjectId = subj.id;
}
function closeShoot() {
  const sh = shootEl();
  sh.classList.remove("open");
  document.body.classList.remove("shoot-open");
  sh.setAttribute("aria-hidden", "true");
  if (location.hash.startsWith("#/shoot/")) {
    history.pushState(null, "", location.pathname + location.search);
  }
  delete sh.dataset.subjectId;
}
function navShoot(dir) {
  const sh = shootEl();
  const id = sh.dataset.subjectId;
  if (!id) return;
  const idxInList = SUBJECTS.findIndex(s => s.id === id);
  if (idxInList < 0) return;
  const next = (idxInList + dir + SUBJECTS.length) % SUBJECTS.length;
  openShoot(SUBJECTS[next].id);
  shootEl().scrollTo({ top: 0, behavior: "smooth" });
}
function bindShoot() {
  const sh = shootEl();
  sh.querySelector(".shoot__close").addEventListener("click", closeShoot);
  sh.querySelector(".shoot__prev").addEventListener("click", () => navShoot(-1));
  sh.querySelector(".shoot__next").addEventListener("click", () => navShoot(1));
  document.addEventListener("keydown", (e) => {
    if (!sh.classList.contains("open")) return;
    if (e.key === "Escape") closeShoot();
    if (e.key === "ArrowLeft") navShoot(-1);
    if (e.key === "ArrowRight") navShoot(1);
  });
  const handleHash = () => {
    const m = location.hash.match(/^#\/shoot\/([\w-]+)$/);
    if (m && SUBJECT_BY_ID[m[1]]) {
      openShoot(m[1], { fromHash: true });
    } else if (sh.classList.contains("open")) {
      sh.classList.remove("open");
      document.body.classList.remove("shoot-open");
    }
  };
  window.addEventListener("popstate", handleHash);
  window.addEventListener("hashchange", handleHash);
  handleHash();
}

// ============================================================
// THEME, REVEAL, INIT
// ============================================================
function bindTheme() {
  const btn = document.getElementById("themeToggle");
  const stored = localStorage.getItem("ws-theme");
  if (stored) document.documentElement.dataset.theme = stored;
  btn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme === "dark" ? "" : "dark";
    if (cur) document.documentElement.dataset.theme = cur;
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("ws-theme", cur);
  });
}
function setYear() {
  const el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
}

// Wrap each character of the brand wordmark in a span so CSS can stagger
// a per-letter fade-up entrance. Recurses into element children (e.g.
// <span class="brand-wendy">) so the wrapping spans we use for two-tone
// coloring are preserved — the .char spans land *inside* them. Run once
// at load.
function splitTitle() {
  const title = document.querySelector(".hero h1.display");
  if (!title || title.dataset.split) return;
  let i = 0;
  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment();
      for (const c of node.textContent) {
        const span = document.createElement("span");
        if (c === " ") {
          span.className = "char char--space";
          span.innerHTML = "&nbsp;";
        } else {
          span.className = "char";
          span.textContent = c;
        }
        span.style.setProperty("--i", i++);
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Recurse — but copy the children list first because replaceChild
      // mutates it during the loop.
      Array.from(node.childNodes).forEach(processNode);
    }
  }
  Array.from(title.childNodes).forEach(processNode);
  title.dataset.split = "1";
}
function bindReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".about, .featured, .all-work").forEach((s) => {
    s.classList.add("reveal");
    io.observe(s);
  });
}

// ============================================================
// CONTACT scroll-driven reveal
// As the user scrolls into the last ~2 viewports of the page, the giant
// CONTACT word stretches from scaleY(0) (invisible) up to scaleY(4.2)
// (fully elongated). Scrolling back up shrinks it again — symmetric.
// Same trick used on jackdanielvo.com and Spencer Gabor's site.
// ============================================================
function bindContactReveal() {
  const word = document.querySelector(".contact-mega");
  if (!word) return;
  // The reveal range is the last N viewports of scroll. The
  // .contact-spacer in CSS must be sized to the same number of
  // viewports — that alignment makes scroll progress hit 0 exactly
  // when the contact panel first peeks out, and 1 at the very end
  // of the page.
  // We now publish progress as a 0–1 number on :root, and CSS does the
  // per-element multiplication (×4.2 for the giant word, ×1.4 for the
  // RATES/CALL/BOOK row). One source of truth, two stretch magnitudes.
  const RANGE_VH = 2;
  let raf = 0;

  function update() {
    raf = 0;
    const doc = document.documentElement;
    const vh = window.innerHeight || doc.clientHeight;
    const maxScroll = (doc.scrollHeight - vh);
    const range = Math.max(1, vh * RANGE_VH);
    const start = maxScroll - range;
    const progress = Math.min(1, Math.max(0, (window.scrollY - start) / range));
    doc.style.setProperty("--reveal", progress.toFixed(4));
  }
  function onScroll() {
    if (!raf) raf = requestAnimationFrame(update);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  // Also recalculate after layout settles (images, fonts) since scrollHeight grows.
  setTimeout(update, 100);
  setTimeout(update, 800);
  update();
}

document.addEventListener("DOMContentLoaded", () => {
  bindTheme();
  bindReveal();
  setYear();
  splitTitle();

  const data = loadSubjects();
  SUBJECTS = data.subjects;
  SUBJECT_BY_ID = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]));
  console.log(`[wendy-site] loaded ${SUBJECTS.length} subjects from ${data.source}` +
    (data.generatedAt ? ` (synced ${data.generatedAt})` : ""));

  buildHero(SUBJECTS, data.categories, data.heroPhotos);

  if (Array.isArray(data.categories) && data.categories.length) {
    // Editorial mode: hide the legacy Featured Work + All Shoots sections
    // and render one carousel section per category between About and the
    // contact spacer.
    const featured = document.querySelector(".featured");
    const allWork  = document.querySelector(".all-work");
    if (featured) featured.style.display = "none";
    if (allWork)  allWork.style.display  = "none";
    // Insert each category section before the contact spacer (which sits
    // after </main>, so we anchor before the all-work section that DOES
    // live inside main).
    const anchor = allWork || null;
    for (const cat of data.categories) {
      // Collect every subject (person) whose `cat` matches this category.
      // Each one becomes a tile in the section's carousel.
      const peopleInCat = SUBJECTS.filter((s) => s.cat === cat.slug);
      if (!peopleInCat.length) {
        console.warn(`[wendy-site] category "${cat.slug}" has no people; skipping.`);
        continue;
      }
      buildCategorySection(peopleInCat, cat, anchor);
    }
  } else {
    // Legacy mode: original Featured Work carousel + All Shoots grid + filters
    buildFeatured(SUBJECTS, data.featured);
    buildGrid(SUBJECTS, data.gridShoots, data.excludeShoots, data.leadPhotos);
    buildFilters(SUBJECTS);
  }

  bindContactReveal();
  bindShoot();
});
