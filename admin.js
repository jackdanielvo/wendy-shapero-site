/* ============================================================
   WendyPix admin — packages editor + bookings dashboard.
   Uses Netlify Identity for magic-link auth. Every admin API call
   includes the user's JWT in the Authorization header.
   ============================================================ */

(function () {
  // -----------------------------------------------------------
  // AUTH
  // -----------------------------------------------------------
  const identity = window.netlifyIdentity;
  if (identity) {
    identity.on("init", onAuthChange);
    identity.on("login", () => { identity.close(); onAuthChange(); });
    identity.on("logout", onAuthChange);
  }

  function currentUser() { return identity && identity.currentUser(); }

  function onAuthChange() {
    const user = currentUser();
    document.getElementById("authBlock").hidden = !!user;
    document.getElementById("tabs").hidden = !user;
    document.querySelectorAll(".admin__pane").forEach((el) => {
      el.hidden = !user || el.dataset.tab !== getActiveTab();
    });
    document.getElementById("userEmailLabel").textContent =
      user ? user.email : "Admin";

    if (user) {
      // Initial data loads
      loadPackages().catch((e) => packagesStatus("err", e.message));
      // Bookings load is lazy — when user clicks the tab — but go
      // ahead and prefetch since it's a small payload.
      loadBookings().catch((e) => console.error("bookings load:", e));
      loadSettings().catch((e) => settingsStatus("err", e.message));
    }
  }

  document.getElementById("loginBtn").addEventListener("click", () => {
    identity && identity.open("login");
  });
  document.getElementById("logoutBtn").addEventListener("click", () => {
    identity && identity.logout();
  });

  // Send JWT with admin API calls
  async function authFetch(url, opts = {}) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    const token = await user.jwt();
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // -----------------------------------------------------------
  // TABS
  // -----------------------------------------------------------
  function getActiveTab() {
    const sel = document.querySelector(".admin__tab[aria-selected='true']");
    return sel ? sel.dataset.tab : "packages";
  }
  document.querySelectorAll(".admin__tab[data-tab]").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".admin__tab[data-tab]").forEach((x) => {
        x.setAttribute("aria-selected", x === t ? "true" : "false");
      });
      const active = t.dataset.tab;
      document.querySelectorAll(".admin__pane").forEach((el) => {
        el.hidden = el.dataset.tab !== active;
      });
      if (active === "bookings") loadBookings().catch(console.error);
      if (active === "settings") loadSettings().catch(console.error);
      if (active === "photos")   loadPhotos().catch((e) => photosStatus("err", e.message));
      if (active === "hero")     loadHero().catch((e) => heroStatus("err", e.message));
    });
  });

  // -----------------------------------------------------------
  // PACKAGES
  // -----------------------------------------------------------
  let packagesState = []; // working copy currently in the form

  async function loadPackages() {
    packagesStatus("", "Loading…");
    const res = await authFetch("/api/admin-packages");
    if (!res.ok) throw new Error(`Load failed (${res.status})`);
    const { packages } = await res.json();
    packagesState = packages || [];
    renderPackages();
    packagesStatus("", "");
  }

  function renderPackages() {
    const wrap = document.getElementById("packagesList");
    if (!packagesState.length) {
      wrap.innerHTML = `<p class="admin__status">No packages yet — click "Add package" to start.</p>`;
      return;
    }
    wrap.innerHTML = "";
    packagesState.forEach((p, i) => {
      const card = document.createElement("article");
      card.className = "admin__pkg" +
        (p.featured ? " admin__pkg--featured" : "") +
        (p.inquiry ? " admin__pkg--inquiry" : "");
      card.innerHTML = `
        <div class="admin__pkg__header">
          <h3>${escapeHtml(p.name || "(unnamed)")} ${p.inquiry ? "&middot; Inquiry-only" : `&middot; $${Number(p.price || 0).toLocaleString()}`}</h3>
          <button type="button" class="admin__pkg__remove" data-action="remove" data-i="${i}">Remove</button>
        </div>

        <div class="admin__pkg__row">
          <label>Display name</label>
          <input type="text" data-field="name" data-i="${i}" value="${escapeAttr(p.name || "")}" />
        </div>
        <div class="admin__pkg__row">
          <label>ID (lowercase, hyphens — affects internal routing only)</label>
          <input type="text" data-field="id" data-i="${i}" value="${escapeAttr(p.id || "")}" pattern="[a-z0-9\\-]+" />
        </div>

        <div class="admin__pkg__row">
          <label>Price (USD)</label>
          <input type="number" data-field="price" data-i="${i}" value="${p.price ?? ""}" min="0" step="50" ${p.inquiry ? "disabled" : ""} />
        </div>
        <div class="admin__pkg__row">
          <label>Duration (minutes)</label>
          <input type="number" data-field="duration" data-i="${i}" value="${p.duration ?? ""}" min="15" max="480" step="15" ${p.inquiry ? "disabled" : ""} />
        </div>

        <div class="admin__pkg__row admin__pkg__row--full">
          <label>One-line description</label>
          <input type="text" data-field="description" data-i="${i}" value="${escapeAttr(p.description || "")}" />
        </div>

        <div class="admin__pkg__row admin__pkg__row--full">
          <label>What's included (one item per line)</label>
          <textarea data-field="includes" data-i="${i}" rows="4">${escapeHtml((p.includes || []).join("\n"))}</textarea>
        </div>

        <div class="admin__pkg__row">
          <label class="admin__pkg__check">
            <input type="checkbox" data-field="featured" data-i="${i}" ${p.featured ? "checked" : ""} />
            Featured (highlighted as "Most popular")
          </label>
        </div>
        <div class="admin__pkg__row">
          <label class="admin__pkg__check">
            <input type="checkbox" data-field="inquiry" data-i="${i}" ${p.inquiry ? "checked" : ""} />
            Inquiry only (no slot picker — opens email)
          </label>
        </div>
      `;
      wrap.appendChild(card);
    });
  }

  // Sync form changes back into packagesState as the user types.
  document.getElementById("packagesList").addEventListener("input", (e) => {
    const el = e.target.closest("[data-field][data-i]");
    if (!el) return;
    const i = Number(el.dataset.i);
    const field = el.dataset.field;
    const pkg = packagesState[i];
    if (!pkg) return;

    if (field === "includes") {
      pkg.includes = el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } else if (field === "price" || field === "duration") {
      pkg[field] = el.value === "" ? null : Number(el.value);
    } else if (field === "featured" || field === "inquiry") {
      pkg[field] = el.checked;
      if (field === "inquiry" && el.checked) {
        // Clear price/duration when toggling to inquiry
        pkg.price = null;
        pkg.duration = null;
      }
      renderPackages(); // re-render so the disabled state on price/duration updates
    } else {
      pkg[field] = el.value;
    }
  });

  document.getElementById("packagesList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='remove']");
    if (!btn) return;
    const i = Number(btn.dataset.i);
    if (!Number.isFinite(i)) return;
    if (!confirm(`Remove package "${packagesState[i].name}"?`)) return;
    packagesState.splice(i, 1);
    renderPackages();
  });

  document.getElementById("addPackageBtn").addEventListener("click", () => {
    packagesState.push({
      id: "new-package-" + (packagesState.length + 1),
      name: "New package",
      price: 500,
      duration: 60,
      description: "",
      includes: [],
      featured: false,
      inquiry: false,
    });
    renderPackages();
  });

  document.getElementById("savePackagesBtn").addEventListener("click", async () => {
    packagesStatus("", "Saving…");
    try {
      const res = await authFetch("/api/admin-packages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packages: packagesState }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      packagesState = data.packages;
      renderPackages();
      packagesStatus("ok", "Saved. Booking page will reflect the changes within ~1 minute.");
    } catch (e) {
      packagesStatus("err", "Save failed: " + e.message);
    }
  });

  document.getElementById("resetPackagesBtn").addEventListener("click", async () => {
    if (!confirm("Reset all packages to the original WendyPix defaults? This wipes any edits.")) return;
    packagesStatus("", "Resetting…");
    try {
      const res = await authFetch("/api/admin-packages", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Reset failed (${res.status})`);
      packagesState = data.packages;
      renderPackages();
      packagesStatus("ok", "Reset to defaults.");
    } catch (e) {
      packagesStatus("err", "Reset failed: " + e.message);
    }
  });

  function packagesStatus(kind, msg) {
    const el = document.getElementById("packagesStatus");
    el.className = "admin__status admin__status--inline" + (kind ? " admin__status--" + kind : "");
    el.textContent = msg || "";
  }

  // -----------------------------------------------------------
  // BOOKINGS
  // -----------------------------------------------------------
  async function loadBookings() {
    const wrap = document.getElementById("bookingsList");
    wrap.innerHTML = `<p class="admin__status">Loading…</p>`;
    const res = await authFetch("/api/admin-bookings");
    if (!res.ok) {
      wrap.innerHTML = `<p class="admin__status admin__status--err">Couldn't load (${res.status})</p>`;
      return;
    }
    const { bookings } = await res.json();
    renderBookings(bookings || []);
  }

  function renderBookings(bookings) {
    const wrap = document.getElementById("bookingsList");
    if (!bookings.length) {
      wrap.innerHTML = `<p class="admin__status">No upcoming bookings.</p>`;
      return;
    }
    wrap.innerHTML = "";
    bookings.forEach((b) => {
      const start = new Date(b.slotStart);
      const dateStr = start.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const dayOfMonth = start.toLocaleDateString("en-US", { day: "numeric" });
      const timeStr = start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Los_Angeles",
        timeZoneName: "short",
      });

      const status = b.status || "unknown";
      const statusLabel = {
        tentative: "Awaiting confirmation",
        busy: "Confirmed",
        deleted: "Removed",
      }[status] || status;

      const card = document.createElement("article");
      card.className = "admin__booking admin__booking--" + status;
      card.innerHTML = `
        <div class="admin__booking__date">
          <span class="day">${escapeHtml(dateStr)}</span>
          <span class="time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="admin__booking__main">
          <p class="pkg">${escapeHtml(b.packageName || "Booking")}${b.packagePrice ? ` &middot; $${b.packagePrice}` : ""}</p>
          <p class="client">
            <strong>${escapeHtml(b.name || "")}</strong>
            &middot;
            <a href="mailto:${encodeURIComponent(b.email || "")}">${escapeHtml(b.email || "")}</a>
            ${b.phone ? `&middot; ${escapeHtml(b.phone)}` : ""}
          </p>
          <p class="meta">
            ${b.durationMin ? `${b.durationMin} min` : ""}
            ${b.looks ? `&middot; ${escapeHtml(String(b.looks))} looks` : ""}
            ${b.hmua ? "&middot; + Hair &amp; makeup" : ""}
            ${b.notes ? `&middot; <em>${escapeHtml(b.notes.slice(0, 60))}${b.notes.length > 60 ? "…" : ""}</em>` : ""}
          </p>
        </div>
        <div class="admin__booking__status">
          <span class="label-${status}">${escapeHtml(statusLabel)}</span>
        </div>
      `;
      wrap.appendChild(card);
    });
  }

  document.getElementById("refreshBookingsBtn").addEventListener("click", () => {
    loadBookings().catch(console.error);
  });

  // -----------------------------------------------------------
  // UTIL
  // -----------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#039;");
  }

  // -----------------------------------------------------------
  // SETTINGS — working hours, lead time, buffer, days lookahead, deposit
  // -----------------------------------------------------------
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let settingsState = null;

  async function loadSettings() {
    settingsStatus("", "Loading…");
    const res = await authFetch("/api/admin-settings");
    if (!res.ok) throw new Error(`Load failed (${res.status})`);
    const { settings } = await res.json();
    settingsState = normalizeSettings(settings);
    renderSettings();
    settingsStatus("", "");
  }

  // Make sure every weekday is represented and numbers are numbers,
  // regardless of how the JSON came across the wire.
  function normalizeSettings(s) {
    const hours = {};
    const src = (s && s.hoursByDay) || {};
    for (let d = 0; d <= 6; d++) {
      const v = src[d] != null ? src[d] : src[String(d)];
      if (v && typeof v === "object" && v.start && v.end) {
        hours[d] = { start: String(v.start), end: String(v.end) };
      } else {
        hours[d] = null;
      }
    }
    return {
      hoursByDay: hours,
      leadTimeHours: Number(s && s.leadTimeHours) || 0,
      bufferMin: Number(s && s.bufferMin) || 0,
      daysToShow: Number(s && s.daysToShow) || 21,
      maxSlotsPerDay: Number(s && s.maxSlotsPerDay) || 4,
      depositPercent: Number(s && s.depositPercent) || 25,
      timezone: (s && s.timezone) || "America/Los_Angeles",
    };
  }

  function renderSettings() {
    const wrap = document.getElementById("settingsForm");
    if (!settingsState) {
      wrap.innerHTML = `<p class="admin__status">Loading…</p>`;
      return;
    }

    const dayRows = DAY_NAMES.map((label, d) => {
      const h = settingsState.hoursByDay[d];
      const open = h !== null;
      const start = (h && h.start) || "09:00";
      const end = (h && h.end) || "18:00";
      return `
        <div class="admin__settings__row admin__settings__day" data-day="${d}">
          <label class="admin__settings__day-name">${label}</label>
          <label class="admin__settings__check">
            <input type="checkbox" data-day-open="${d}" ${open ? "checked" : ""} />
            Open
          </label>
          <label class="admin__settings__time">
            <span>Start</span>
            <input type="time" data-day-start="${d}" value="${start}" ${open ? "" : "disabled"} />
          </label>
          <label class="admin__settings__time">
            <span>End</span>
            <input type="time" data-day-end="${d}" value="${end}" ${open ? "" : "disabled"} />
          </label>
        </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="admin__settings__section">
        <h3 class="admin__settings__h3">Working hours</h3>
        <p class="admin__settings__hint">
          Pacific time. Uncheck Open to mark a day as closed. Times outside
          these windows won't appear in the booking picker.
        </p>
        ${dayRows}
      </div>

      <div class="admin__settings__section">
        <h3 class="admin__settings__h3">Booking rules</h3>

        <div class="admin__settings__row">
          <label>Lead time (hours)</label>
          <input type="number" data-field="leadTimeHours" min="0" max="720" step="1"
                 value="${settingsState.leadTimeHours}" />
          <span class="admin__settings__hint admin__settings__hint--inline">
            Minimum hours between booking and session.
          </span>
        </div>

        <div class="admin__settings__row">
          <label>Buffer (minutes)</label>
          <input type="number" data-field="bufferMin" min="0" max="240" step="5"
                 value="${settingsState.bufferMin}" />
          <span class="admin__settings__hint admin__settings__hint--inline">
            Gap reserved between back-to-back sessions.
          </span>
        </div>

        <div class="admin__settings__row">
          <label>Days lookahead</label>
          <input type="number" data-field="daysToShow" min="1" max="180" step="1"
                 value="${settingsState.daysToShow}" />
          <span class="admin__settings__hint admin__settings__hint--inline">
            How far in the future the picker shows.
          </span>
        </div>

        <div class="admin__settings__row">
          <label>Max slots per day</label>
          <input type="number" data-field="maxSlotsPerDay" min="1" max="24" step="1"
                 value="${settingsState.maxSlotsPerDay}" />
          <span class="admin__settings__hint admin__settings__hint--inline">
            Visual cap so the picker never overwhelms.
          </span>
        </div>
      </div>

      <div class="admin__settings__section">
        <h3 class="admin__settings__h3">Deposit</h3>

        <div class="admin__settings__row">
          <label>Deposit percentage</label>
          <input type="number" data-field="depositPercent" min="0" max="100" step="1"
                 value="${settingsState.depositPercent}" />
          <span class="admin__settings__hint admin__settings__hint--inline">
            Non-refundable retainer charged at booking. Affects Stripe
            checkout amount, the rate-card copy, and email language.
          </span>
        </div>
      </div>
    `;
  }

  // Sync form changes back into settingsState as the user types.
  document.getElementById("settingsForm").addEventListener("input", (e) => {
    if (!settingsState) return;
    const el = e.target;

    // Day open/closed toggle
    const openDay = el.dataset.dayOpen;
    if (openDay != null) {
      const d = Number(openDay);
      if (el.checked) {
        // Reopen using the time inputs that are already in the DOM
        const startEl = document.querySelector(`[data-day-start="${d}"]`);
        const endEl = document.querySelector(`[data-day-end="${d}"]`);
        settingsState.hoursByDay[d] = {
          start: (startEl && startEl.value) || "09:00",
          end: (endEl && endEl.value) || "18:00",
        };
      } else {
        settingsState.hoursByDay[d] = null;
      }
      renderSettings();
      return;
    }

    // Day start time
    const startDay = el.dataset.dayStart;
    if (startDay != null) {
      const d = Number(startDay);
      if (settingsState.hoursByDay[d]) {
        settingsState.hoursByDay[d].start = el.value;
      }
      return;
    }

    // Day end time
    const endDay = el.dataset.dayEnd;
    if (endDay != null) {
      const d = Number(endDay);
      if (settingsState.hoursByDay[d]) {
        settingsState.hoursByDay[d].end = el.value;
      }
      return;
    }

    // Numeric fields
    if (el.dataset.field) {
      const n = Number(el.value);
      settingsState[el.dataset.field] = Number.isFinite(n) ? n : 0;
    }
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    if (!settingsState) return;
    settingsStatus("", "Saving…");
    try {
      const res = await authFetch("/api/admin-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: settingsState }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      settingsState = normalizeSettings(data.settings);
      renderSettings();
      settingsStatus("ok", "Saved. Booking page will reflect changes within ~1 minute.");
    } catch (e) {
      settingsStatus("err", "Save failed: " + e.message);
    }
  });

  document.getElementById("resetSettingsBtn").addEventListener("click", async () => {
    if (!confirm("Reset settings to defaults? This wipes any edits.")) return;
    settingsStatus("", "Resetting…");
    try {
      const res = await authFetch("/api/admin-settings", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Reset failed (${res.status})`);
      settingsState = normalizeSettings(data.settings);
      renderSettings();
      settingsStatus("ok", "Reset to defaults.");
    } catch (e) {
      settingsStatus("err", "Reset failed: " + e.message);
    }
  });

  function settingsStatus(kind, msg) {
    const el = document.getElementById("settingsStatus");
    if (!el) return;
    el.className = "admin__status admin__status--inline" + (kind ? " admin__status--" + kind : "");
    el.textContent = msg || "";
  }

  // -----------------------------------------------------------
  // PHOTOS TAB — browse, reorder, upload, delete.
  //
  // Data model:
  //   `photosOriginal`  — manifest as it was when we loaded (immutable)
  //   `photosState`     — working copy we mutate as the user drags things
  //                       around. Each subject / photo carries an
  //                       `originalFolder` / `originalFile` pointer so the
  //                       publish endpoint can find the source blob even
  //                       after the user has renumbered things.
  //   `photosUploads`   — Map<uploadKey, base64Jpeg> of pending uploads.
  //                       New photo entries in `photosState` carry an
  //                       `uploadKey` that looks the bytes up at publish.
  //                       Also tracks `previewUrl` (object URL) for
  //                       displaying the local preview before publish.
  // -----------------------------------------------------------
  let photosOriginal = null;
  let photosState = null;
  let photosUploads = new Map();
  let photosSortables = []; // SortableJS instances we destroy on reload
  let photosActiveCatIdx = 0;
  let photosActiveSubjIdx = 0;
  let photoUploadCounter = 0;

  async function loadPhotos() {
    photosStatus("", "Loading…");
    setPhotosPending(0);
    // Release any blob URLs we created for upload previews
    photosUploads.forEach((entry) => {
      if (entry && entry.previewUrl) {
        try { URL.revokeObjectURL(entry.previewUrl); } catch (_) {}
      }
    });
    photosUploads = new Map();
    try {
      const res = await authFetch("/api/admin-photos-manifest");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Load failed (${res.status})`);
      }
      const data = await res.json();
      photosOriginal = data;
      // Deep clone + annotate each subject/photo with its originalFolder/originalFile
      photosState = {
        commitSha: data.commitSha,
        categories: data.categories.map((c) => ({
          folder: c.folder,
          originalFolder: c.folder,
          subjects: c.subjects.map((s) => ({
            folder: s.folder,
            originalFolder: s.folder,
            photos: s.photos.map((f) => ({
              file: f,
              originalFile: f,
            })),
          })),
        })),
      };
      photosActiveCatIdx = 0;
      photosActiveSubjIdx = 0;
      renderPhotos();
      photosStatus("", "");
    } catch (e) {
      photosStatus("err", e.message);
    }
  }

  function destroyPhotoSortables() {
    photosSortables.forEach((s) => { try { s.destroy(); } catch (_) {} });
    photosSortables = [];
  }

  function renderPhotos() {
    destroyPhotoSortables();
    const pane = document.getElementById("photosPane");
    if (!photosState || !photosState.categories.length) {
      pane.innerHTML = `<p class="admin__status">No photos to manage.</p>`;
      return;
    }

    const cat = photosState.categories[photosActiveCatIdx];
    const subj = cat && cat.subjects[photosActiveSubjIdx];

    pane.innerHTML = `
      <div class="admin__photos__layout">
        <div class="admin__photos__col" id="adminPhotoCats">
          <h4 class="admin__photos__h">Categories</h4>
          <ul class="admin__photos__list" id="adminPhotoCatsList"></ul>
        </div>
        <div class="admin__photos__col" id="adminPhotoSubjs">
          <h4 class="admin__photos__h">Subjects ${cat ? "in " + escapeHtml(stripPrefix(cat.folder)) : ""}</h4>
          <ul class="admin__photos__list admin__photos__list--draggable" id="adminPhotoSubjsList"></ul>
          <button type="button" class="admin__photos__add-subj" id="adminPhotoAddSubjBtn">+ New subject</button>
          <p class="admin__photos__hint">Drag subjects to reorder. Click a subject to manage its photos.</p>
        </div>
        <div class="admin__photos__col admin__photos__col--wide" id="adminPhotoFiles">
          <h4 class="admin__photos__h">
            Photos ${subj ? "in " + escapeHtml(stripPrefix(subj.folder)) : ""}
          </h4>
          <ul class="admin__photos__grid admin__photos__grid--draggable" id="adminPhotoFilesList"></ul>
          ${subj ? `<input type="file" id="adminPhotoAddInput" accept="image/jpeg,image/png" multiple hidden />` : ""}
          <p class="admin__photos__hint">
            Drag photos to reorder. The first one is the lead/cover.
            Click the &times; on a tile to remove it.
            Click the dashed <strong>+</strong> tile (or drop JPEG/PNG files onto it) to add new photos.
          </p>
        </div>
      </div>
    `;

    // Categories list — clickable, no drag (reordering categories is rare
    // and we don't want to risk breaking the category slug mapping)
    const catsUl = document.getElementById("adminPhotoCatsList");
    photosState.categories.forEach((c, i) => {
      const li = document.createElement("li");
      li.className =
        "admin__photos__item" + (i === photosActiveCatIdx ? " is-active" : "");
      li.innerHTML = `<span>${escapeHtml(c.folder)}</span><span class="admin__photos__count">${c.subjects.length}</span>`;
      li.addEventListener("click", () => {
        photosActiveCatIdx = i;
        photosActiveSubjIdx = 0;
        renderPhotos();
      });
      catsUl.appendChild(li);
    });

    // Subjects list — draggable
    const subjsUl = document.getElementById("adminPhotoSubjsList");
    if (cat) {
      cat.subjects.forEach((s, i) => {
        const li = document.createElement("li");
        li.className =
          "admin__photos__item admin__photos__item--draggable" +
          (i === photosActiveSubjIdx ? " is-active" : "");
        li.dataset.subjIdx = String(i);
        li.innerHTML =
          `<span class="admin__photos__grip" aria-hidden="true">⋮⋮</span>` +
          `<span>${escapeHtml(stripPrefix(s.folder))}</span>` +
          `<span class="admin__photos__count">${s.photos.length}</span>`;
        li.addEventListener("click", (ev) => {
          if (ev.target.closest(".admin__photos__grip")) return;
          photosActiveSubjIdx = i;
          renderPhotos();
        });
        subjsUl.appendChild(li);
      });

      photosSortables.push(new Sortable(subjsUl, {
        handle: ".admin__photos__grip",
        animation: 160,
        ghostClass: "is-dragging",
        onEnd: (evt) => {
          if (evt.oldIndex === evt.newIndex) return;
          const moved = cat.subjects.splice(evt.oldIndex, 1)[0];
          cat.subjects.splice(evt.newIndex, 0, moved);
          // Recompute "01-Name", "02-Name", … prefixes
          renumberSubjects(cat);
          // Keep active subject pointing to the moved one
          photosActiveSubjIdx = evt.newIndex;
          renderPhotos();
          recountPending();
        },
      }));

      // "+ New subject" button wiring — prompts Wendy for the
      // subject name, validates uniqueness within the category,
      // creates an empty subject at the end, auto-selects it so she
      // can immediately drop photos in. The new subject's photos
      // array starts empty; uploads added via the photo grid's "+"
      // tile will be the entire content of this subject. If she
      // publishes without adding any photos, the subject is silently
      // skipped (git doesn't track empty folders).
      const addSubjBtn = document.getElementById("adminPhotoAddSubjBtn");
      if (addSubjBtn) {
        addSubjBtn.addEventListener("click", () => {
          const raw = window.prompt(
            "Name of the new subject (e.g., 'Maria Jones'):",
            ""
          );
          if (raw == null) return; // user hit Cancel
          const name = String(raw).trim();
          if (!name) {
            alert("Subject name can't be blank.");
            return;
          }
          if (/[\/\\:]/.test(name)) {
            alert("Subject name can't contain / \\ or :");
            return;
          }
          // Reject duplicates (case-insensitive, ignoring NN- prefix)
          const cleanLower = name.toLowerCase();
          const dupe = cat.subjects.find(
            (s) => stripPrefix(s.folder).toLowerCase() === cleanLower
          );
          if (dupe) {
            alert(
              `There's already a subject called "${stripPrefix(dupe.folder)}" in this category.`
            );
            return;
          }
          // Push a new subject at the end. originalFolder = null is
          // the marker for "this subject didn't exist before".
          const pad = String(cat.subjects.length + 1).padStart(2, "0");
          cat.subjects.push({
            folder: `${pad}-${name}`,
            originalFolder: null,
            photos: [],
          });
          photosActiveSubjIdx = cat.subjects.length - 1;
          renderPhotos();
          recountPending();
          photosStatus(
            "ok",
            `Created "${name}". Click the + tile in the photo grid to add photos.`
          );
        });
      }
    }

    // Photos grid — draggable thumbnails
    const filesUl = document.getElementById("adminPhotoFilesList");
    if (subj) {
      const catFolder = cat.originalFolder || cat.folder;
      const subjFolderForUrl = subj.originalFolder || subj.folder;
      subj.photos.forEach((p, i) => {
        const li = document.createElement("li");
        li.className =
          "admin__photos__tile" + (p.uploadKey ? " is-pending-add" : "");
        li.dataset.fileIdx = String(i);
        // For pending uploads, show the local blob preview.
        // For existing photos, point at the live /photos-web/ URL
        // using the ORIGINAL folder/file names — the rename hasn't
        // been published yet, so the new names don't exist on disk.
        let url;
        if (p.uploadKey) {
          const entry = photosUploads.get(p.uploadKey);
          url = (entry && entry.previewUrl) || "";
        } else {
          url =
            "/photos-web/" +
            encodeURIComponent(catFolder) +
            "/" +
            encodeURIComponent(subjFolderForUrl) +
            "/" +
            encodeURIComponent(p.originalFile || p.file);
        }
        const isLead = i === 0;
        li.innerHTML =
          `<img src="${url}" alt="" loading="lazy" draggable="false"/>` +
          (isLead ? `<span class="admin__photos__lead">LEAD</span>` : "") +
          (p.uploadKey ? `<span class="admin__photos__new">NEW</span>` : "") +
          `<button type="button" class="admin__photos__delete" data-photo-del="${i}" title="Remove this photo" aria-label="Remove">&times;</button>` +
          `<span class="admin__photos__filename">${escapeHtml(p.file)}</span>`;
        filesUl.appendChild(li);
      });

      // "+ Add" tile at the end of the grid — click to pick files,
      // or drop files onto it. Always sits at the end of the photos list.
      const addLi = document.createElement("li");
      addLi.className = "admin__photos__tile admin__photos__tile--add";
      addLi.id = "adminPhotoAddTile";
      addLi.innerHTML =
        `<span class="admin__photos__plus" aria-hidden="true">+</span>` +
        `<span class="admin__photos__add-label">Add photos</span>`;
      filesUl.appendChild(addLi);

      photosSortables.push(new Sortable(filesUl, {
        animation: 160,
        ghostClass: "is-dragging",
        // Don't initiate drag on the delete button or the + tile
        filter: ".admin__photos__delete, .admin__photos__tile--add",
        preventOnFilter: false,
        // Pin the + tile at the end of the list — it must never be
        // dragged or have other tiles dropped after it
        onMove: (evt) => {
          if (evt.related && evt.related.classList.contains("admin__photos__tile--add")) {
            return false;
          }
        },
        onEnd: (evt) => {
          if (evt.oldIndex === evt.newIndex) return;
          // The + tile is always the last child; only photo tiles can
          // be reordered. Cap newIndex at photos.length - 1 just in case.
          const oldI = evt.oldIndex;
          const newI = Math.min(evt.newIndex, subj.photos.length - 1);
          if (oldI === newI) return;
          const moved = subj.photos.splice(oldI, 1)[0];
          subj.photos.splice(newI, 0, moved);
          renumberPhotos(subj);
          renderPhotos();
          recountPending();
        },
      }));

      wirePhotoActions(subj);
    }
  }

  // Wire up the delete buttons + add-photos button + drop zone for the
  // current subject's photo grid. Called from renderPhotos AFTER the
  // grid has been re-rendered.
  function wirePhotoActions(subj) {
    // Delete buttons
    document
      .querySelectorAll("[data-photo-del]")
      .forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const idx = Number(btn.dataset.photoDel);
          if (!Number.isFinite(idx)) return;
          const photo = subj.photos[idx];
          if (!photo) return;
          const label = photo.uploadKey ? "this new (unpublished) photo" : photo.file;
          if (!confirm(`Remove ${label}? You can still undo by hitting Refresh before Publish.`)) return;
          if (photo.uploadKey) {
            const entry = photosUploads.get(photo.uploadKey);
            if (entry && entry.previewUrl) {
              try { URL.revokeObjectURL(entry.previewUrl); } catch (_) {}
            }
            photosUploads.delete(photo.uploadKey);
          }
          subj.photos.splice(idx, 1);
          renumberPhotos(subj);
          renderPhotos();
          recountPending();
        });
      });

    // The "+" tile — click to pick files, or drop files onto it.
    const addTile = document.getElementById("adminPhotoAddTile");
    const addInput = document.getElementById("adminPhotoAddInput");
    if (addTile && addInput) {
      addTile.addEventListener("click", (ev) => {
        ev.preventDefault();
        addInput.click();
      });
      addInput.addEventListener("change", async () => {
        const files = Array.from(addInput.files || []);
        addInput.value = ""; // allow re-selecting same file
        if (files.length) await handlePhotoUploads(subj, files);
      });

      // Drag-drop ONLY onto the + tile. Photos elsewhere on the grid
      // stay fully visible. The tile highlights itself while a file is
      // hovering over it.
      let dragDepth = 0;
      const hasFiles = (e) =>
        e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

      addTile.addEventListener("dragenter", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        addTile.classList.add("is-drop-target");
      });
      addTile.addEventListener("dragover", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      });
      addTile.addEventListener("dragleave", () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) addTile.classList.remove("is-drop-target");
      });
      addTile.addEventListener("drop", async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        addTile.classList.remove("is-drop-target");
        const files = Array.from(e.dataTransfer.files || []).filter((f) =>
          /^image\/(jpeg|jpg|png)$/i.test(f.type)
        );
        if (files.length) await handlePhotoUploads(subj, files);
      });
    }
  }

  // Resize a File to a JPEG <= 1600px on the long edge at q82 via canvas.
  // Returns { base64, previewUrl, width, height, bytes }.
  async function resizePhotoToJpeg(file) {
    const blobUrl = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't decode image: " + file.name));
      i.src = blobUrl;
    });
    URL.revokeObjectURL(blobUrl);
    const max = 1600;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w >= h && w > max) { h = Math.round((h * max) / w); w = max; }
    else if (h > w && h > max) { w = Math.round((w * max) / h); h = max; }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // flatten transparency
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const base64 = dataUrl.split(",")[1];
    // Build a Blob from the data URL for a stable preview URL
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/jpeg" });
    return {
      base64,
      previewUrl: URL.createObjectURL(blob),
      width: w,
      height: h,
      bytes: bytes.length,
    };
  }

  async function handlePhotoUploads(subj, files) {
    photosStatus("", `Resizing ${files.length} photo${files.length === 1 ? "" : "s"}…`);
    const subjectName = stripPrefix(subj.folder);
    let added = 0;
    for (const f of files) {
      try {
        const resized = await resizePhotoToJpeg(f);
        const key = "u" + Date.now().toString(36) + (++photoUploadCounter).toString(36);
        photosUploads.set(key, {
          base64: resized.base64,
          previewUrl: resized.previewUrl,
          sourceName: f.name,
        });
        // Tentative high NN — renumberPhotos will fix it
        subj.photos.push({
          file: `99-${subjectName}.jpg`,
          originalFile: null,
          uploadKey: key,
        });
        added++;
      } catch (e) {
        console.warn("upload skip:", f.name, e);
      }
    }
    renumberPhotos(subj);
    renderPhotos();
    recountPending();
    if (added) {
      photosStatus("ok", `${added} photo${added === 1 ? "" : "s"} queued. Hit Publish to commit.`);
    } else {
      photosStatus("err", "Couldn't process any of those files.");
    }
  }

  // After a drag, regenerate the leading "NN-" prefixes so the
  // current array order becomes the alphabetic order on the filesystem.
  function renumberSubjects(cat) {
    cat.subjects.forEach((s, i) => {
      const pad = String(i + 1).padStart(2, "0");
      const stripped = stripPrefix(s.folder);
      s.folder = `${pad}-${stripped}`;
    });
  }
  function renumberPhotos(subj) {
    subj.photos.forEach((p, i) => {
      const pad = String(i + 1).padStart(2, "0");
      const stripped = stripPrefix(p.file).replace(/^[-_]+/, "");
      // Preserve the original extension
      p.file = `${pad}-${stripped}`;
    });
  }

  function stripPrefix(name) {
    return String(name || "").replace(/^\d+-\s*/, "");
  }

  // Count: renames (file or subject folder name changed) + uploads +
  // deletions (original photo no longer represented in state).
  function recountPending() {
    if (!photosState || !photosOriginal) {
      setPhotosPending(0);
      return;
    }
    let changes = 0;
    // Build a set of the original-paths kept by the current state so
    // we can detect deletions by absence.
    const keptOriginalPaths = new Set();

    photosState.categories.forEach((cat) => {
      cat.subjects.forEach((subj) => {
        const subjRenamed = subj.folder !== subj.originalFolder;
        if (subjRenamed) changes++;
        subj.photos.forEach((p) => {
          if (p.uploadKey) {
            // Pending upload
            changes++;
          } else {
            // Existing photo — count rename if any segment changed
            const curPath = `${cat.folder}/${subj.folder}/${p.file}`;
            const origPath = `${cat.originalFolder || cat.folder}/${subj.originalFolder}/${p.originalFile}`;
            keptOriginalPaths.add(origPath);
            // Subject-rename was already counted once for the whole
            // subject; for the file itself only count if its filename
            // changed (file rename within a subject).
            if (p.file !== p.originalFile) changes++;
          }
        });
      });
    });

    // Deletions: original photos that no longer appear in state
    photosOriginal.categories.forEach((cat) => {
      cat.subjects.forEach((subj) => {
        subj.photos.forEach((file) => {
          const origPath = `${cat.folder}/${subj.folder}/${file}`;
          if (!keptOriginalPaths.has(origPath)) changes++;
        });
      });
    });

    setPhotosPending(changes);
  }

  function setPhotosPending(n) {
    const el = document.getElementById("photosPending");
    const btn = document.getElementById("photosPublishBtn");
    if (n === 0) {
      el.textContent = "No pending changes";
      el.className = "admin__status admin__status--inline";
      if (btn) btn.disabled = true;
    } else {
      el.textContent = `${n} pending change${n === 1 ? "" : "s"}`;
      el.className = "admin__status admin__status--inline admin__status--pending";
      if (btn) btn.disabled = false;
    }
  }

  async function publishPhotos() {
    if (!photosState) return;
    photosStatus("", "Publishing…");
    const btn = document.getElementById("photosPublishBtn");
    if (btn) btn.disabled = true;
    try {
      // Build uploads map { uploadKey: base64 } from photosUploads,
      // but only include keys actually referenced by photosState
      // (in case the user added then deleted an upload).
      const referencedKeys = new Set();
      photosState.categories.forEach((c) => {
        c.subjects.forEach((s) => {
          s.photos.forEach((p) => {
            if (p.uploadKey) referencedKeys.add(p.uploadKey);
          });
        });
      });
      const uploads = {};
      referencedKeys.forEach((key) => {
        const entry = photosUploads.get(key);
        if (entry && entry.base64) uploads[key] = entry.base64;
      });

      // Summarize the change so the commit message tells the story
      const summary = summarizeChanges();

      const payload = {
        commitSha: photosState.commitSha,
        categories: photosState.categories.map((c) => ({
          folder: c.folder,
          originalFolder: c.originalFolder,
          subjects: c.subjects.map((s) => ({
            folder: s.folder,
            originalFolder: s.originalFolder,
            photos: s.photos.map((p) => ({
              file: p.file,
              originalFile: p.originalFile,
              uploadKey: p.uploadKey,
            })),
          })),
        })),
        uploads,
        commitMessage: summary || "Photos: edits via /admin",
      };
      const res = await authFetch("/api/admin-photos-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Publish failed (${res.status})`);
      photosStatus("ok", body.message || "Published.");
      // After publish, reload from the new tree so we start fresh
      await loadPhotos();
    } catch (e) {
      photosStatus("err", e.message);
      if (btn) btn.disabled = false;
    }
  }

  // Build a one-line commit message from the pending state — e.g.
  // "Photos: 3 reorders, 2 uploads, 1 delete (Women / Kids & Teens)"
  function summarizeChanges() {
    if (!photosState || !photosOriginal) return null;
    let renames = 0, uploads = 0, deletes = 0;
    const cats = new Set();
    const kept = new Set();

    photosState.categories.forEach((cat) => {
      cat.subjects.forEach((subj) => {
        subj.photos.forEach((p) => {
          if (p.uploadKey) {
            uploads++;
            cats.add(stripPrefix(cat.folder));
          } else {
            const origPath = `${cat.originalFolder || cat.folder}/${subj.originalFolder}/${p.originalFile}`;
            kept.add(origPath);
            if (p.file !== p.originalFile || subj.folder !== subj.originalFolder) {
              renames++;
              cats.add(stripPrefix(cat.folder));
            }
          }
        });
      });
    });
    photosOriginal.categories.forEach((cat) => {
      cat.subjects.forEach((subj) => {
        subj.photos.forEach((file) => {
          const origPath = `${cat.folder}/${subj.folder}/${file}`;
          if (!kept.has(origPath)) {
            deletes++;
            cats.add(stripPrefix(cat.folder));
          }
        });
      });
    });

    const bits = [];
    if (renames) bits.push(`${renames} reorder${renames === 1 ? "" : "s"}`);
    if (uploads) bits.push(`${uploads} upload${uploads === 1 ? "" : "s"}`);
    if (deletes) bits.push(`${deletes} delete${deletes === 1 ? "" : "s"}`);
    if (!bits.length) return null;
    const catList = Array.from(cats).slice(0, 4).join(", ");
    return `Photos: ${bits.join(", ")} (${catList})`;
  }

  document.getElementById("photosPublishBtn").addEventListener("click", publishPhotos);
  document.getElementById("photosRefreshBtn").addEventListener("click", () => {
    loadPhotos().catch((e) => photosStatus("err", e.message));
  });

  function photosStatus(kind, msg) {
    const el = document.getElementById("photosStatus");
    if (!el) return;
    el.className = "admin__status admin__status--inline" + (kind ? " admin__status--" + kind : "");
    el.textContent = msg || "";
  }

  // -----------------------------------------------------------
  // HERO TAB — pick the 5 photos that lead the home page.
  //
  // Each entry in heroState/heroOriginal is either:
  //   - a string slug like "valentina"
  //   - a string slug#N like "valentina#3" (Nth photo, 0-indexed)
  //   - an object { url: "https://..." } for pinned URLs (used rarely;
  //     the picker UI never produces these but we preserve them on load)
  //
  // The picker modal reuses the photos manifest we already fetch for
  // the Photos tab to enumerate available subjects + previews.
  // -----------------------------------------------------------
  let heroOriginal = null;       // array as loaded
  let heroState = null;          // working copy
  let heroCommitSha = null;
  let heroPickerSlot = null;     // which slot (0-4) the picker is editing
  let heroPickerStage = null;    // "categories" | "photos"
  let heroPickerCatIdx = 0;

  // The Photos tab manifest gives us folder names with NN- prefixes,
  // which we need to convert to slugs for matching to heroPhotos.
  function slugify(folder) {
    return String(folder || "")
      .replace(/^\d+-\s*/, "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Stable URL for the lead (or Nth) photo of a subject, given the
  // raw manifest tree (with NN- prefixes).
  function heroPhotoUrl(catFolder, subjFolder, photoIndex) {
    const list = currentManifestPhotos(catFolder, subjFolder);
    if (!list || !list.length) return "";
    const idx = Math.min(Math.max(0, photoIndex || 0), list.length - 1);
    const file = list[idx];
    return (
      "/photos-web/" +
      encodeURIComponent(catFolder) +
      "/" +
      encodeURIComponent(subjFolder) +
      "/" +
      encodeURIComponent(file)
    );
  }

  function currentManifestPhotos(catFolder, subjFolder) {
    if (!photosOriginal) return null;
    const cat = photosOriginal.categories.find((c) => c.folder === catFolder);
    if (!cat) return null;
    const subj = cat.subjects.find((s) => s.folder === subjFolder);
    return subj ? subj.photos : null;
  }

  // Find the (cat, subj) pair in the manifest whose slug matches `slug`.
  // Returns { catFolder, subjFolder } or null.
  function manifestLookupBySlug(slug) {
    if (!photosOriginal || !slug) return null;
    const cleanSlug = String(slug).split("#")[0].toLowerCase();
    for (const cat of photosOriginal.categories) {
      for (const subj of cat.subjects) {
        if (slugify(subj.folder) === cleanSlug) {
          return { catFolder: cat.folder, subjFolder: subj.folder };
        }
      }
    }
    return null;
  }

  function heroEntryToUrl(entry) {
    if (entry && typeof entry === "object" && entry.url) return entry.url;
    if (typeof entry === "string") {
      const parts = entry.split("#");
      const slug = parts[0];
      const idx = parts.length > 1 ? Number(parts[1]) || 0 : 0;
      const m = manifestLookupBySlug(slug);
      if (m) return heroPhotoUrl(m.catFolder, m.subjFolder, idx);
    }
    return "";
  }

  function heroEntryLabel(entry) {
    if (entry && typeof entry === "object" && entry.url) return "(pinned URL)";
    if (typeof entry === "string") {
      const parts = entry.split("#");
      const slug = parts[0];
      const m = manifestLookupBySlug(slug);
      if (m) {
        const name = m.subjFolder.replace(/^\d+-\s*/, "");
        return parts.length > 1 ? `${name} · photo ${Number(parts[1]) + 1}` : name;
      }
      return entry + " (not found)";
    }
    return "(unset)";
  }

  async function loadHero() {
    heroStatus("", "Loading…");
    setHeroPending(0);
    try {
      // Need the photos manifest too so we can render thumbnails.
      // If it hasn't been loaded yet (i.e., user jumped straight to
      // Hero), fetch it now.
      if (!photosOriginal) {
        const pm = await authFetch("/api/admin-photos-manifest");
        if (!pm.ok) throw new Error("Couldn't load photo list");
        photosOriginal = await pm.json();
      }

      const res = await authFetch("/api/admin-hero");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Load failed (${res.status})`);
      }
      const data = await res.json();
      heroOriginal = JSON.parse(JSON.stringify(data.heroPhotos || []));
      heroState = JSON.parse(JSON.stringify(data.heroPhotos || []));
      heroCommitSha = data.commitSha;
      // Pad/truncate to exactly 5
      while (heroState.length < 5) heroState.push("");
      heroState.length = 5;
      renderHero();
      heroStatus("", "");
    } catch (e) {
      heroStatus("err", e.message);
    }
  }

  const HERO_LABELS = ["1 · Women", "2 · Men", "3 · Kids & Teens", "4 · Lifestyle", "5 · Events"];

  function renderHero() {
    const pane = document.getElementById("heroPane");
    if (!heroState) {
      pane.innerHTML = `<p class="admin__status">Loading…</p>`;
      return;
    }
    const slotsHtml = heroState.map((entry, i) => {
      const url = heroEntryToUrl(entry);
      const label = heroEntryLabel(entry);
      const isUnset = !url;
      return `
        <div class="admin__hero__slot" data-slot="${i}">
          <div class="admin__hero__slot-num">${HERO_LABELS[i]}</div>
          <div class="admin__hero__thumb ${isUnset ? "is-empty" : ""}">
            ${url ? `<img src="${url}" alt="" />` : `<span>?</span>`}
          </div>
          <div class="admin__hero__caption">${escapeHtml(label)}</div>
          <button type="button" class="btn admin__hero__change" data-change-slot="${i}">Change</button>
        </div>
      `;
    }).join("");
    pane.innerHTML = `<div class="admin__hero__row">${slotsHtml}</div>`;

    pane.querySelectorAll("[data-change-slot]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const slot = Number(btn.dataset.changeSlot);
        openHeroPicker(slot);
      });
    });

    recountHeroPending();
  }

  // PICKER MODAL --------------------------------------------------
  function openHeroPicker(slotIdx) {
    heroPickerSlot = slotIdx;
    heroPickerStage = "categories";
    heroPickerCatIdx = 0;
    // Default to the category that matches the slot (Women, Men, …)
    if (photosOriginal && photosOriginal.categories[slotIdx]) {
      heroPickerCatIdx = slotIdx;
    }
    document.getElementById("heroPickerModal").hidden = false;
    document.getElementById("heroPickerTitle").textContent =
      `Pick photo for slot ${slotIdx + 1} (${HERO_LABELS[slotIdx].split("· ")[1] || ""})`;
    renderHeroPicker();
  }
  function closeHeroPicker() {
    document.getElementById("heroPickerModal").hidden = true;
    heroPickerSlot = null;
  }
  function renderHeroPicker() {
    const body = document.getElementById("heroPickerBody");
    if (!photosOriginal) {
      body.innerHTML = `<p class="admin__status">No photo manifest loaded.</p>`;
      return;
    }
    // Always render the category tabs at the top
    const tabsHtml = photosOriginal.categories.map((cat, i) =>
      `<button type="button" class="admin__hero-picker__cat ${i === heroPickerCatIdx ? "is-active" : ""}" data-pick-cat="${i}">${escapeHtml(cat.folder.replace(/^\d+-\s*/, ""))}</button>`
    ).join("");

    const cat = photosOriginal.categories[heroPickerCatIdx];
    let gridHtml = "";
    if (!cat) {
      gridHtml = `<p class="admin__status">No category selected.</p>`;
    } else {
      const subjects = cat.subjects.map((s) => {
        const url = heroPhotoUrl(cat.folder, s.folder, 0);
        const name = s.folder.replace(/^\d+-\s*/, "");
        return `
          <button type="button" class="admin__hero-picker__tile" data-pick-subj="${escapeAttr(s.folder)}">
            <img src="${url}" alt="" loading="lazy" />
            <span>${escapeHtml(name)}</span>
          </button>
        `;
      }).join("");
      gridHtml = `<div class="admin__hero-picker__grid">${subjects}</div>`;
    }

    body.innerHTML = `
      <div class="admin__hero-picker__cats">${tabsHtml}</div>
      ${gridHtml}
    `;

    body.querySelectorAll("[data-pick-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        heroPickerCatIdx = Number(btn.dataset.pickCat);
        renderHeroPicker();
      });
    });
    body.querySelectorAll("[data-pick-subj]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const subjFolder = btn.dataset.pickSubj;
        const slug = slugify(subjFolder);
        if (heroPickerSlot != null) {
          heroState[heroPickerSlot] = slug;
        }
        closeHeroPicker();
        renderHero();
      });
    });
  }

  document.getElementById("heroPickerClose").addEventListener("click", closeHeroPicker);
  document.getElementById("heroPickerBackdrop").addEventListener("click", closeHeroPicker);

  // PENDING + PUBLISH ---------------------------------------------
  function recountHeroPending() {
    if (!heroState || !heroOriginal) {
      setHeroPending(0);
      return;
    }
    let changes = 0;
    for (let i = 0; i < 5; i++) {
      const cur = heroState[i];
      const orig = heroOriginal[i];
      if (JSON.stringify(cur) !== JSON.stringify(orig)) changes++;
    }
    setHeroPending(changes);
  }

  function setHeroPending(n) {
    const el = document.getElementById("heroPending");
    const btn = document.getElementById("heroPublishBtn");
    if (n === 0) {
      el.textContent = "No pending changes";
      el.className = "admin__status admin__status--inline";
      if (btn) btn.disabled = true;
    } else {
      el.textContent = `${n} pending change${n === 1 ? "" : "s"}`;
      el.className = "admin__status admin__status--inline admin__status--pending";
      if (btn) btn.disabled = false;
    }
  }

  async function publishHero() {
    if (!heroState) return;
    heroStatus("", "Publishing…");
    const btn = document.getElementById("heroPublishBtn");
    if (btn) btn.disabled = true;
    try {
      const payload = {
        heroPhotos: heroState,
        commitSha: heroCommitSha,
        commitMessage: `Hero: ${heroState.map((e) => typeof e === "string" ? e : "url").join(", ")}`,
      };
      const res = await authFetch("/api/admin-hero", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Publish failed (${res.status})`);
      heroStatus("ok", body.message || "Published.");
      // Reload to pick up the new commit SHA
      await loadHero();
    } catch (e) {
      heroStatus("err", e.message);
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById("heroPublishBtn").addEventListener("click", publishHero);
  document.getElementById("heroRefreshBtn").addEventListener("click", () => {
    loadHero().catch((e) => heroStatus("err", e.message));
  });

  function heroStatus(kind, msg) {
    const el = document.getElementById("heroStatus");
    if (!el) return;
    el.className = "admin__status admin__status--inline" + (kind ? " admin__status--" + kind : "");
    el.textContent = msg || "";
  }

  // Boot — if Identity hasn't fired init yet, run an initial pass anyway
  // so the auth gate shows up.
  if (!identity) {
    document.getElementById("authBlock").hidden = false;
    document.getElementById("tabs").hidden = true;
  }
})();
