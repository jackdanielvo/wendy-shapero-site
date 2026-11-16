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
          <div class="admin__pkg__actions">
            <button type="button" class="admin__pkg__move" data-action="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move ${escapeAttr(p.name || "this package")} up">&uarr; Up</button>
            <button type="button" class="admin__pkg__move" data-action="down" data-i="${i}" ${i === packagesState.length - 1 ? "disabled" : ""} aria-label="Move ${escapeAttr(p.name || "this package")} down">&darr; Down</button>
            <button type="button" class="admin__pkg__remove" data-action="remove" data-i="${i}">Remove</button>
          </div>
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
    // Up / Down: swap with the neighbor. The saved order is the order
    // visitors see on /book and /pricing, so nothing changes on the site
    // until Save changes is clicked.
    const move = e.target.closest("[data-action='up'], [data-action='down']");
    if (move) {
      const i = Number(move.dataset.i);
      const j = move.dataset.action === "up" ? i - 1 : i + 1;
      if (!Number.isFinite(i) || j < 0 || j >= packagesState.length) return;
      [packagesState[i], packagesState[j]] = [packagesState[j], packagesState[i]];
      renderPackages();
      packagesStatus("", "Order changed. Click Save changes to publish it.");
      // Keep focus on the package that moved, so repeated clicks keep moving it.
      const same = document.querySelector(`[data-action="${move.dataset.action}"][data-i="${j}"]`);
      const other = document.querySelector(`[data-action="${move.dataset.action === "up" ? "down" : "up"}"][data-i="${j}"]`);
      ((same && !same.disabled) ? same : other)?.focus();
      return;
    }
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
      // Deep clone + annotate each subject/photo with its origin
      // location (folder names + category). The "original*" fields
      // are pointers back to where the data lived at load time, so
      // the publish function can find the source blob even after
      // Wendy has reordered, renamed, or moved things across
      // categories. Subjects carry originalCategory (their loaded
      // category's folder) so the server can construct the correct
      // old path when a subject moves between categories.
      // displayFolder/displayUrl snapshot the LOAD-TIME tree paths.
      // They are NEVER mutated for the rest of the session — even
      // after a successful publish updates originalFolder/originalFile
      // to track GitHub's new state. The admin grid's <img src> uses
      // these display* pointers so it keeps showing photos from the
      // still-live Netlify deploy. Wendy clicks Refresh to re-snapshot
      // after the rebuild lands.
      photosState = {
        commitSha: data.commitSha,
        categories: data.categories.map((c) => ({
          folder: c.folder,
          originalFolder: c.folder,
          displayFolder: c.folder,
          subjects: c.subjects.map((s) => ({
            folder: s.folder,
            originalFolder: s.folder,
            originalCategory: c.folder,
            displayFolder: s.folder,
            displayCategory: c.folder,
            photos: s.photos.map((f) => ({
              file: f,
              originalFile: f,
              displayUrl:
                "/photos-web/" +
                encodeURIComponent(c.folder) +
                "/" +
                encodeURIComponent(s.folder) +
                "/" +
                encodeURIComponent(f),
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

      // Category li is a DROP TARGET for subject moves. Drag a subject
      // from the Subjects pane onto a category here to move it.
      // Depth counter prevents the flicker that happens when the
      // cursor crosses child element boundaries (the name span, count
      // badge, etc.) — each enter/leave pair on a child fires on the
      // parent too, which would otherwise make the highlight blink.
      let catDragDepth = 0;
      li.addEventListener("dragover", (e) => {
        if (
          e.dataTransfer &&
          Array.from(e.dataTransfer.types).includes("application/wendypix-subject")
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      });
      li.addEventListener("dragenter", (e) => {
        if (
          !e.dataTransfer ||
          !Array.from(e.dataTransfer.types).includes("application/wendypix-subject")
        ) return;
        catDragDepth++;
        li.classList.add("is-drop-target");
      });
      li.addEventListener("dragleave", () => {
        catDragDepth = Math.max(0, catDragDepth - 1);
        if (catDragDepth === 0) li.classList.remove("is-drop-target");
      });
      li.addEventListener("drop", (e) => {
        catDragDepth = 0;
        li.classList.remove("is-drop-target");
        const raw = e.dataTransfer.getData("application/wendypix-subject");
        if (!raw) return;
        e.preventDefault();
        let data;
        try { data = JSON.parse(raw); } catch { return; }
        const fromCatIdx = data.catIdx;
        const subjIdx = data.subjIdx;
        const toCatIdx = i;
        if (fromCatIdx === toCatIdx) return; // dropped on same category
        const fromCat = photosState.categories[fromCatIdx];
        const toCat = photosState.categories[toCatIdx];
        const moved = fromCat.subjects.splice(subjIdx, 1)[0];
        toCat.subjects.push(moved);
        renumberSubjects(fromCat);
        renumberSubjects(toCat);
        // Follow the moved subject so the user sees where it landed
        photosActiveCatIdx = toCatIdx;
        photosActiveSubjIdx = toCat.subjects.length - 1;
        renderPhotos();
        recountPending();
        photosStatus(
          "ok",
          `Moved "${stripPrefix(moved.folder)}" to ${stripPrefix(toCat.folder)}.`
        );
      });

      catsUl.appendChild(li);
    });

    // Subjects list — draggable
    const subjsUl = document.getElementById("adminPhotoSubjsList");
    if (cat) {
      // Subjects use PURE NATIVE HTML5 DnD (no SortableJS) so we have
      // full control over both within-list reorder AND cross-category
      // moves. SortableJS preventDefaults dragstart events from outside
      // its handle, which was killing our cross-list drag.
      cat.subjects.forEach((s, i) => {
        const li = document.createElement("li");
        li.className =
          "admin__photos__item admin__photos__item--draggable" +
          (i === photosActiveSubjIdx ? " is-active" : "");
        li.dataset.subjIdx = String(i);
        li.draggable = true;
        li.innerHTML =
          `<span class="admin__photos__grip" aria-hidden="true">⋮⋮</span>` +
          `<span>${escapeHtml(stripPrefix(s.folder))}</span>` +
          `<span class="admin__photos__count">${s.photos.length}</span>` +
          `<button type="button" class="admin__photos__subj-delete" data-subj-del="${i}" title="Remove this subject" aria-label="Remove subject">&times;</button>`;
        li.addEventListener("click", (ev) => {
          if (
            ev.target.closest(".admin__photos__grip") ||
            ev.target.closest("[data-subj-del]")
          ) return;
          photosActiveSubjIdx = i;
          renderPhotos();
        });
        // Delete this subject (and all its photos in pending state).
        const delBtn = li.querySelector("[data-subj-del]");
        if (delBtn) {
          delBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const subjName = stripPrefix(s.folder);
            const photoCount = s.photos.length;
            const photoLabel =
              photoCount === 0
                ? "no photos"
                : photoCount === 1
                ? "1 photo"
                : `${photoCount} photos`;
            if (
              !confirm(
                `Remove subject "${subjName}" (${photoLabel})? You can still undo by hitting Refresh before Publish.`
              )
            ) return;
            // Revoke any in-flight upload blob URLs to avoid leaks
            s.photos.forEach((p) => {
              if (p.uploadKey) {
                const entry = photosUploads.get(p.uploadKey);
                if (entry && entry.previewUrl) {
                  try { URL.revokeObjectURL(entry.previewUrl); } catch (_) {}
                }
                photosUploads.delete(p.uploadKey);
              }
            });
            cat.subjects.splice(i, 1);
            renumberSubjects(cat);
            // Adjust active selection so we don't end up out-of-bounds
            if (photosActiveSubjIdx >= cat.subjects.length) {
              photosActiveSubjIdx = Math.max(0, cat.subjects.length - 1);
            }
            renderPhotos();
            recountPending();
            photosStatus(
              "ok",
              `Removed "${subjName}". Publish to commit.`
            );
          });
        }

        // DRAG SOURCE: stash the source category + subject index in
        // a custom MIME type the drop targets can sniff.
        li.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData(
            "application/wendypix-subject",
            JSON.stringify({ catIdx: photosActiveCatIdx, subjIdx: i })
          );
          e.dataTransfer.effectAllowed = "move";
          li.classList.add("is-dragging");
        });
        li.addEventListener("dragend", () => {
          li.classList.remove("is-dragging");
        });

        // DROP TARGET — accepts either another subject (for reorder
        // within the same category) or a photo (for cross-subject
        // move within the current category). Depth counter prevents
        // flicker as the cursor crosses inner element boundaries.
        let subjDragDepth = 0;
        li.addEventListener("dragover", (e) => {
          const t = e.dataTransfer && Array.from(e.dataTransfer.types);
          if (
            t &&
            (t.includes("application/wendypix-subject") ||
              t.includes("application/wendypix-photo"))
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        });
        li.addEventListener("dragenter", (e) => {
          const t = e.dataTransfer && Array.from(e.dataTransfer.types);
          if (
            !t ||
            !(
              t.includes("application/wendypix-subject") ||
              t.includes("application/wendypix-photo")
            )
          ) return;
          subjDragDepth++;
          li.classList.add("is-drop-target");
        });
        li.addEventListener("dragleave", () => {
          subjDragDepth = Math.max(0, subjDragDepth - 1);
          if (subjDragDepth === 0) li.classList.remove("is-drop-target");
        });
        li.addEventListener("drop", (e) => {
          subjDragDepth = 0;
          li.classList.remove("is-drop-target");
          e.preventDefault();
          const types = Array.from(e.dataTransfer.types);

          if (types.includes("application/wendypix-subject")) {
            // SUBJECT drop onto another subject → REORDER within cat
            let data;
            try {
              data = JSON.parse(
                e.dataTransfer.getData("application/wendypix-subject")
              );
            } catch { return; }
            if (data.catIdx !== photosActiveCatIdx) return; // cross-cat handled by category drop, not here
            if (data.subjIdx === i) return; // dropped on self
            const moved = cat.subjects.splice(data.subjIdx, 1)[0];
            // If we removed an item BEFORE the target index, the
            // target shifts down by one.
            const newIdx = data.subjIdx < i ? i - 1 : i;
            cat.subjects.splice(newIdx, 0, moved);
            renumberSubjects(cat);
            photosActiveSubjIdx = newIdx;
            renderPhotos();
            recountPending();
            return;
          }

          if (types.includes("application/wendypix-photo")) {
            // PHOTO drop onto a subject → move photo into this subject
            const photoIdx = parseInt(
              e.dataTransfer.getData("application/wendypix-photo"),
              10
            );
            if (i === photosActiveSubjIdx) return; // dropped on the source subject
            const fromSubj = cat.subjects[photosActiveSubjIdx];
            const toSubj = cat.subjects[i];
            const movedPhoto = fromSubj.photos.splice(photoIdx, 1)[0];
            toSubj.photos.push(movedPhoto);
            renumberPhotos(fromSubj);
            renumberPhotos(toSubj);
            renderPhotos();
            recountPending();
            photosStatus(
              "ok",
              `Moved photo to "${stripPrefix(toSubj.folder)}".`
            );
            return;
          }
        });

        subjsUl.appendChild(li);
      });

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
      // catFolder / subjFolderForUrl are now used ONLY as a fallback for
      // photos that don't have a captured displayUrl (shouldn't happen
      // for load-time photos, but a safety net for any in-memory item
      // that escaped the snapshot). The primary display path is
      // p.displayUrl — see the comment in loadPhotos for why.
      const catFolder = cat.displayFolder || cat.originalFolder || cat.folder;
      const subjFolderForUrl = subj.displayFolder || subj.originalFolder || subj.folder;
      subj.photos.forEach((p, i) => {
        const li = document.createElement("li");
        li.className =
          "admin__photos__tile" + (p.uploadKey ? " is-pending-add" : "");
        li.dataset.fileIdx = String(i);
        // draggable=true so the photo tile can be dragged onto a
        // subject in the Subjects pane to move it. (SortableJS
        // already sets this for in-grid reorder, but we set it again
        // so the native dragstart we attach below fires cleanly.)
        li.draggable = true;
        li.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("application/wendypix-photo", String(i));
          e.dataTransfer.effectAllowed = "move";
        });
        // For pending uploads, show the local blob preview.
        // For existing photos, point at the live /photos-web/ URL
        // using the ORIGINAL folder/file names — the rename hasn't
        // been published yet, so the new names don't exist on disk.
        let url;
        if (p.uploadKey) {
          // Pending upload — use the local blob preview captured at
          // file-drop time.
          const entry = photosUploads.get(p.uploadKey);
          url = (entry && entry.previewUrl) || p.displayUrl || "";
        } else if (p.displayUrl) {
          // Existing photo OR previously-uploaded-and-now-committed
          // photo (uploadKey was cleared after publish but displayUrl
          // remains for the rest of the session).
          url = p.displayUrl;
        } else {
          // Fallback for any photo that somehow lacks displayUrl —
          // construct the path from current folder/file pointers.
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
        // Tentative high NN — renumberPhotos will fix it.
        // displayUrl carries the local blob URL so the grid keeps
        // showing the photo even after publish clears uploadKey (the
        // committed blob isn't deployed to Netlify for 1-3 min, so we
        // rely on the local URL until Wendy clicks Refresh).
        subj.photos.push({
          file: `99-${subjectName}.jpg`,
          originalFile: null,
          uploadKey: key,
          displayUrl: resized.previewUrl,
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
        const subjMovedCat =
          subj.originalCategory && subj.originalCategory !== cat.folder;
        if (subjRenamed || subjMovedCat) changes++;
        subj.photos.forEach((p) => {
          if (p.uploadKey) {
            // Pending upload
            changes++;
          } else {
            // The original path lookup uses the subject's
            // originalCategory (where it loaded from) — so even if
            // Wendy dragged the subject across categories, we can
            // still match the photo back to its source path for
            // deletion-by-omission detection.
            const origCatFolder = subj.originalCategory || cat.originalFolder || cat.folder;
            const origPath = `${origCatFolder}/${subj.originalFolder}/${p.originalFile}`;
            keptOriginalPaths.add(origPath);
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
            // originalCategory is the category folder where this
            // subject lived at load time. If Wendy dragged the
            // subject across categories, this still points at the
            // SOURCE — the server uses it to find the old blob path.
            originalCategory: s.originalCategory,
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

      // Deliberately DO NOT call loadPhotos() here. The publish call
      // succeeded — GitHub has the new state — but Netlify takes 1-3
      // minutes to rebuild and redeploy the static files. If we
      // re-fetched the manifest now, the admin would render photo URLs
      // with their new filenames, but Netlify would still be serving
      // the old files at those paths. That mismatch caused the brief
      // window of broken images on the live site (and in the admin
      // grid for renames).
      //
      // Instead: show a clear "deploying, refresh in a couple minutes"
      // status, zero out the pending counter (since the changes ARE
      // published, they're just not deployed yet), and let the user
      // click Refresh manually when they want to see the new state.
      //
      // BUT we DO need to re-baseline the internal pointers so that
      // subsequent publishes in the same session work correctly:
      //
      // - commitSha is now whatever HEAD the server just created. Without
      //   updating, the very next publish would 409 with "Tree changed
      //   since you loaded it." (server compares the manifest's
      //   commitSha to the current ref head).
      //
      // - originalFolder / originalFile / originalCategory all point
      //   at where each photo lived when we LOADED. After publish, the
      //   blobs are at NEW paths on GitHub. Without updating, the next
      //   publish's blob lookup would fail with "Cannot find original
      //   blob" because it'd look at the stale paths.
      //
      // - photosOriginal is the diff baseline for recountPending(); it
      //   needs to match the just-published state so the pending counter
      //   reads 0 (nothing pending against the new baseline).
      //
      // Display URLs in the admin grid keep using p.displayUrl /
      // c.displayFolder / s.displayFolder — those snapshot the LOAD-TIME
      // tree paths and are never updated mid-session, so the grid keeps
      // showing photos from the still-live Netlify deploy until Wendy
      // clicks Refresh (at which point a fresh loadPhotos resets every
      // pointer at once).
      photosState.commitSha = body.commitSha || photosState.commitSha;
      photosState.categories.forEach((cat) => {
        cat.originalFolder = cat.folder;
        cat.subjects.forEach((subj) => {
          subj.originalFolder = subj.folder;
          subj.originalCategory = cat.folder;
          subj.photos.forEach((photo) => {
            photo.originalFile = photo.file;
            if (photo.uploadKey) {
              // The upload is now a real blob on GitHub. We don't need
              // the base64 payload anymore, but we keep the previewUrl
              // alive (via photo.displayUrl, captured at upload time)
              // so the admin grid still renders the photo. The
              // photosUploads Map entry can go — payload is committed.
              photosUploads.delete(photo.uploadKey);
              photo.uploadKey = null;
            }
          });
        });
      });
      // Reset the diff baseline to reflect what we just published.
      photosOriginal = {
        commitSha: photosState.commitSha,
        categories: photosState.categories.map((cat) => ({
          folder: cat.folder,
          subjects: cat.subjects.map((subj) => ({
            folder: subj.folder,
            photos: subj.photos.map((p) => p.file),
          })),
        })),
      };
      setPhotosPending(0);
      photosStatus(
        "ok",
        (body.message
          ? body.message + " "
          : "Published. ") +
          "Site will redeploy in 1-3 min — click Refresh after that to see the latest state."
      );
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

  // Position labels (1st, 2nd, ...). The CATEGORY label below each
  // slot is derived dynamically from the subject currently in the slot
  // — so dragging a Lifestyle subject into slot 1 makes the first hero
  // card represent Lifestyle.
  const HERO_POSITIONS = ["1st", "2nd", "3rd", "4th", "5th"];

  let heroSortable = null;

  // Find the human-readable category label for the subject in a slot.
  function heroSlotCategoryLabel(entry) {
    if (!entry) return "(empty)";
    if (typeof entry === "object" && entry.url) return "(pinned URL)";
    if (typeof entry !== "string") return "(unknown)";
    const slug = entry.split("#")[0].toLowerCase();
    if (!photosOriginal) return slug;
    for (const cat of photosOriginal.categories) {
      for (const subj of cat.subjects) {
        if (slugify(subj.folder) === slug) {
          return cat.folder.replace(/^\d+-\s*/, "");
        }
      }
    }
    return slug + " (not found)";
  }

  function renderHero() {
    const pane = document.getElementById("heroPane");
    if (!heroState) {
      pane.innerHTML = `<p class="admin__status">Loading…</p>`;
      return;
    }
    if (heroSortable) {
      try { heroSortable.destroy(); } catch (_) {}
      heroSortable = null;
    }

    const slotsHtml = heroState.map((entry, i) => {
      const url = heroEntryToUrl(entry);
      const subjLabel = heroEntryLabel(entry);
      const catLabel = heroSlotCategoryLabel(entry);
      const isUnset = !url;
      return `
        <div class="admin__hero__slot" data-slot="${i}">
          <div class="admin__hero__slot-head">
            <span class="admin__hero__slot-pos">${HERO_POSITIONS[i] || i + 1}</span>
            <span class="admin__hero__slot-grip" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
          </div>
          <div class="admin__hero__thumb ${isUnset ? "is-empty" : ""}">
            ${url ? `<img src="${url}" alt="" draggable="false" />` : `<span>?</span>`}
          </div>
          <div class="admin__hero__cat caps">${escapeHtml(catLabel)}</div>
          <div class="admin__hero__caption">${escapeHtml(subjLabel)}</div>
          <button type="button" class="btn admin__hero__change" data-change-slot="${i}">Change</button>
        </div>
      `;
    }).join("");
    pane.innerHTML = `
      <p class="admin__photos__hint" style="margin-bottom:14px">
        Drag a slot by its <strong>⋮⋮</strong> handle to reorder. The category label
        under each photo shows which section the card jumps to — drag a Lifestyle
        subject into the first slot and the first hero card becomes Lifestyle.
      </p>
      <div class="admin__hero__row" id="heroSlotsRow">${slotsHtml}</div>
    `;

    // Drag-to-reorder via SortableJS (already loaded for the Photos tab)
    const row = document.getElementById("heroSlotsRow");
    if (row && typeof Sortable !== "undefined") {
      heroSortable = new Sortable(row, {
        handle: ".admin__hero__slot-grip",
        animation: 180,
        ghostClass: "is-dragging",
        onEnd: (evt) => {
          if (evt.oldIndex === evt.newIndex) return;
          const moved = heroState.splice(evt.oldIndex, 1)[0];
          heroState.splice(evt.newIndex, 0, moved);
          renderHero();
          recountHeroPending();
        },
      });
    }

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
    // Title shows the current slot's category, if any — but since the
     // slot order is now Wendy-controlled, we lead with the position.
    const currentCat = heroSlotCategoryLabel(heroState[slotIdx]);
    document.getElementById("heroPickerTitle").textContent =
      `Pick photo for the ${HERO_POSITIONS[slotIdx] || slotIdx + 1} hero slot` +
      (currentCat && !currentCat.startsWith("(") ? ` (currently ${currentCat})` : "");
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

      // Same reasoning as publishPhotos: don't auto-reload the
      // manifest here. The Hero picker would re-fetch from GitHub
      // (current commit), but the live home page is still serving the
      // old data/photos.js for 1-3 min while Netlify rebuilds.
      // Just sync the local "original" snapshot to the just-published
      // state so the pending counter zeroes out, and tell the user to
      // refresh after the deploy.
      heroOriginal = JSON.parse(JSON.stringify(heroState));
      heroCommitSha = body.commitSha || heroCommitSha;
      setHeroPending(0);
      heroStatus(
        "ok",
        (body.message ? body.message + " " : "Published. ") +
          "Home page will refresh in 1-3 min once the deploy goes green."
      );
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

  // -----------------------------------------------------------
  // DISCOUNTS — influencer promo codes
  // -----------------------------------------------------------
  let codesState = [];

  async function loadCodes() {
    const wrap = document.getElementById("codesList");
    if (!wrap) return;
    wrap.innerHTML = '<p class="admin__status">Loading…</p>';
    try {
      const res = await authFetch("/api/admin-codes");
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const { codes } = await res.json();
      codesState = codes || [];
      renderCodes();
    } catch (err) {
      wrap.innerHTML = `<p class="admin__status admin__status--err">${err.message}</p>`;
    }
  }

  function renderCodes() {
    const wrap = document.getElementById("codesList");
    if (!wrap) return;
    if (!codesState.length) {
      wrap.innerHTML =
        '<p class="admin__status">No codes yet — create one above. If you added an influencer email, they get a branded email with the code + link. Otherwise use Copy code / Copy link to share it yourself.</p>';
      return;
    }
    wrap.innerHTML = "";
    codesState.forEach((c) => {
      const row = document.createElement("div");
      row.className = "admin__code-row" + (c.active ? "" : " admin__code-row--inactive");
      const uses = c.usedCount || 0;
      const max = c.maxUses;
      const pctFull = max ? Math.min(100, (uses / max) * 100) : 0;
      const usesBar =
        max != null
          ? `<div class="admin__code-uses-bar${uses >= max ? " admin__code-uses-bar--full" : ""}">
               <div class="admin__code-uses-bar__fill" style="width:${pctFull}%"></div>
             </div>`
          : "";
      const expiry = c.expiresAt
        ? formatDateFriendly(c.expiresAt)
        : '<span class="muted">no expiry</span>';
      const usesTxt = max != null
        ? `${uses} / ${max} uses`
        : `${uses} uses &middot; <span class="muted">no cap</span>`;
      // Show the email on the row, or a subtle 'no email — share code
      // manually' hint when there isn't one on file.
      const emailLine = c.influencerEmail
        ? escapeHtml(c.influencerEmail)
        : '<span class="muted">no email — share code manually</span>';
      const resendBtn = c.influencerEmail
        ? `<button type="button" class="btn" data-act="resend" data-code="${escapeHtml(c.code)}">Resend email</button>`
        : "";
      row.innerHTML =
        `<div class="admin__code-string">${escapeHtml(c.code)}</div>` +
        `<div class="admin__code-meta">
           <strong>${escapeHtml(c.influencerName)}</strong>
           &middot; ${emailLine}<br/>
           <strong>${c.percentOff}% off</strong>
           &middot; ${usesTxt}
           &middot; Expires: ${expiry}
           ${usesBar}
         </div>` +
        `<div class="admin__code-actions">
           <button type="button" class="btn" data-act="copy-code" data-code="${escapeHtml(c.code)}">Copy code</button>
           <button type="button" class="btn" data-act="copy-link" data-code="${escapeHtml(c.code)}">Copy link</button>
           ${resendBtn}
           <button type="button" class="btn" data-act="toggle" data-code="${escapeHtml(c.code)}">${c.active ? "Deactivate" : "Reactivate"}</button>
           <button type="button" class="btn btn--danger" data-act="delete" data-code="${escapeHtml(c.code)}">Delete</button>
         </div>`;
      wrap.appendChild(row);
    });
    // Delegate button clicks
    wrap.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => onCodeAction(btn.dataset.act, btn.dataset.code));
    });
  }

  async function createCode() {
    const status = document.getElementById("codesCreateStatus");
    status.className = "admin__status admin__status--inline";
    const name = document.getElementById("c-name").value.trim();
    const email = document.getElementById("c-email").value.trim();
    const percent = Number(document.getElementById("c-percent").value);
    const expiresRaw = document.getElementById("c-expires").value.trim();
    const maxUsesRaw = document.getElementById("c-maxuses").value.trim();
    if (!name) return status.textContent = "Enter the influencer's name.";
    // Email is optional now — only reject if the user typed something
    // that isn't a valid address. Blank is fine (Wendy will share the code manually).
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return status.textContent = "Enter a valid email, or leave it blank.";
    }
    if (!(percent > 0 && percent <= 100)) return status.textContent = "Percent must be 1-100.";
    const btn = document.getElementById("createCodeBtn");
    btn.disabled = true;
    status.textContent = "Creating…";
    try {
      const res = await authFetch("/api/admin-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          influencerName: name,
          influencerEmail: email,
          percentOff: percent,
          expiresAt: expiresRaw || null,
          maxUses: maxUsesRaw ? Number(maxUsesRaw) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`);
      status.className = "admin__status admin__status--inline admin__status--ok";
      if (data.emailed) {
        status.textContent = `Created ${data.code.code}. Emailed ${email} the code + link.`;
      } else if (data.emailSkipped) {
        status.textContent = `Created ${data.code.code}. Link copied to clipboard — paste it into a text to ${name}.`;
      } else {
        status.textContent = `Created ${data.code.code}. Email failed (${data.emailError || "unknown"}) — hit Resend to try again.`;
      }
      // Clear form
      document.getElementById("c-name").value = "";
      document.getElementById("c-email").value = "";
      document.getElementById("c-percent").value = "20";
      document.getElementById("c-expires").value = "";
      document.getElementById("c-maxuses").value = "";
      await loadCodes();
      // If there was no email, auto-copy the promo link so Wendy can
      // paste it into a text/DM right away without hunting for the row.
      if (data.emailSkipped) {
        const url = `${location.origin}/book?promo=${encodeURIComponent(data.code.code)}`;
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(url);
          }
        } catch (_) { /* silent — the status message already tells them what to do */ }
      }
    } catch (err) {
      status.className = "admin__status admin__status--inline admin__status--err";
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function onCodeAction(act, code) {
    if (act === "copy-code") return copyToClipboard(code, `Code ${code} copied.`);
    if (act === "copy-link") {
      const url = `${location.origin}/book?promo=${encodeURIComponent(code)}`;
      return copyToClipboard(url, `Link copied — paste it into a text, DM, or IG bio.`);
    }
    if (act === "resend") return resendCodeEmail(code);
    if (act === "toggle") return toggleCodeActive(code);
    if (act === "delete") return deleteCode(code);
  }

  // Shared clipboard helper. Uses the modern async API when available
  // (all evergreen browsers) and falls back to a hidden textarea +
  // execCommand for older Safari/iOS where the async API is https-only.
  async function copyToClipboard(text, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      // Lightweight confirmation — a native alert is intrusive but
      // ensures Wendy actually sees the confirmation on mobile where
      // toasts are easy to miss.
      alert(okMsg);
    } catch (err) {
      alert("Couldn't copy automatically — here it is to copy manually:\n\n" + text);
    }
  }

  async function resendCodeEmail(code) {
    const rec = codesState.find((c) => c.code === code);
    if (!rec) return;
    if (!confirm(`Re-send the welcome email to ${rec.influencerEmail}?`)) return;
    try {
      const res = await authFetch("/api/admin-codes?action=resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Resend failed (${res.status})`);
      alert(`Email re-sent to ${rec.influencerEmail}.`);
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleCodeActive(code) {
    const rec = codesState.find((c) => c.code === code);
    if (!rec) return;
    const next = !rec.active;
    try {
      const res = await authFetch("/api/admin-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, active: next }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      await loadCodes();
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteCode(code) {
    const rec = codesState.find((c) => c.code === code);
    if (!rec) return;
    const msg =
      rec.usedCount > 0
        ? `${code} has been used ${rec.usedCount} time(s). Delete anyway? ` +
          `(You'll lose the audit log — consider Deactivating instead.)`
        : `Delete ${code}?`;
    if (!confirm(msg)) return;
    try {
      const res = await authFetch("/api/admin-codes?code=" + encodeURIComponent(code), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await loadCodes();
    } catch (err) {
      alert(err.message);
    }
  }

  const createBtn = document.getElementById("createCodeBtn");
  if (createBtn) createBtn.addEventListener("click", createCode);

  // Hook Discounts tab into the tab switcher (added after the original
  // tab handler so we don't touch its DOM setup).
  document.querySelectorAll(".admin__tab[data-tab='discounts']").forEach((t) => {
    t.addEventListener("click", () => loadCodes().catch(console.error));
  });

  function formatDateFriendly(iso) {
    const d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  // escapeHtml is already declared earlier in this IIFE (used by the
  // packages/settings renderers) so we reuse that binding here.

  // -----------------------------------------------------------
  // ADD-ONS — the "Add-ons" ledger on /pricing + bookable checkboxes on /book
  // -----------------------------------------------------------
  let addonsState = []; // working copy the form is currently editing

  async function loadAddons() {
    addonsStatus("", "Loading…");
    try {
      const res = await authFetch("/api/admin-addons");
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const { addons } = await res.json();
      addonsState = Array.isArray(addons) ? addons : [];
      renderAddons();
      addonsStatus("", "");
    } catch (err) {
      addonsStatus("err", err.message);
    }
  }

  function renderAddons() {
    const wrap = document.getElementById("addonsList");
    if (!wrap) return;
    if (!addonsState.length) {
      wrap.innerHTML =
        '<p class="admin__status">No add-ons — hit "+ Add row" to create one.</p>';
      return;
    }
    wrap.innerHTML = "";
    addonsState.forEach((row, i) => {
      const el = document.createElement("div");
      el.className = "admin__addon-row";
      el.dataset.idx = String(i);
      el.innerHTML =
        `<input type="text" data-field="label" value="${escapeHtml(row.label || "")}" placeholder="Label (e.g. Additional retouched image)" />` +
        `<div class="admin__addon-row__price-wrap">
           <input type="number" data-field="price" value="${row.price != null ? row.price : ""}" min="0" step="1" placeholder="0" />
         </div>` +
        `<input type="text" data-field="priceDisplay" value="${escapeHtml(row.priceDisplay || "")}" placeholder="Display override (e.g. $250–$750)" />` +
        `<label class="admin__addon-row__bookable">
           <input type="checkbox" data-field="bookable" ${row.bookable ? "checked" : ""} />
           Bookable
         </label>` +
        `<button type="button" class="admin__addon-row__delete" data-act="delete">Delete</button>`;
      // Wire inputs → state
      el.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", () => {
          const field = input.dataset.field;
          if (field === "bookable") {
            addonsState[i][field] = input.checked;
          } else if (field === "price") {
            addonsState[i][field] = Number(input.value) || 0;
          } else {
            addonsState[i][field] = input.value;
          }
        });
      });
      el.querySelector('[data-act="delete"]').addEventListener("click", () => {
        if (!confirm(`Delete "${row.label || "this row"}"?`)) return;
        addonsState.splice(i, 1);
        renderAddons();
      });
      wrap.appendChild(el);
    });
  }

  function addAddonRow() {
    // Generate a placeholder id from the current row count; the user
    // can rename in edit mode if we ever add per-field id editing.
    // For now the id is used only server-side for lookups (booking math).
    const nextIdx = addonsState.length + 1;
    addonsState.push({
      id: "addon-" + Date.now().toString(36),
      label: "",
      price: 0,
      priceDisplay: null,
      bookable: false,
      description: "",
      order: nextIdx,
    });
    renderAddons();
  }

  async function saveAddons() {
    // Clean up empty labels + coerce priceDisplay="" to null. Server
    // will re-validate but this makes the payload cleaner.
    const cleaned = addonsState
      .filter((a) => (a.label || "").trim().length > 0)
      .map((a) => ({
        ...a,
        label: a.label.trim(),
        priceDisplay: (a.priceDisplay || "").trim() || null,
      }));
    addonsStatus("", "Saving…");
    try {
      const res = await authFetch("/api/admin-addons", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addons: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      addonsState = data.addons || cleaned;
      renderAddons();
      addonsStatus("ok", `Saved. Changes are live on /pricing and /book.`);
    } catch (err) {
      addonsStatus("err", err.message);
    }
  }

  async function resetAddonsToDefaults() {
    if (!confirm("Reset the add-ons list to the built-in defaults? Your customizations will be wiped.")) return;
    try {
      const res = await authFetch("/api/admin-addons", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Reset failed (${res.status})`);
      addonsState = data.addons || [];
      renderAddons();
      addonsStatus("ok", "Reset to defaults.");
    } catch (err) {
      addonsStatus("err", err.message);
    }
  }

  function addonsStatus(kind, msg) {
    const el = document.getElementById("addonsStatus");
    if (!el) return;
    el.className = "admin__status admin__status--inline" + (kind ? " admin__status--" + kind : "");
    el.textContent = msg || "";
  }

  const saveAddonsBtn = document.getElementById("saveAddonsBtn");
  const addAddonBtn = document.getElementById("addAddonBtn");
  const resetAddonsBtn = document.getElementById("resetAddonsBtn");
  if (saveAddonsBtn) saveAddonsBtn.addEventListener("click", saveAddons);
  if (addAddonBtn) addAddonBtn.addEventListener("click", addAddonRow);
  if (resetAddonsBtn) resetAddonsBtn.addEventListener("click", resetAddonsToDefaults);

  document.querySelectorAll(".admin__tab[data-tab='addons']").forEach((t) => {
    t.addEventListener("click", () => loadAddons().catch(console.error));
  });

  // -----------------------------------------------------------
  // RATES — Lifestyle / Events / Travel ledgers on /pricing
  // -----------------------------------------------------------
  const RATES_SECTIONS = [
    { key: "lifestyle", title: "02. Lifestyle & Commercial" },
    { key: "events",    title: "03. Events" },
    { key: "travel",    title: "04. Travel" },
  ];
  let ratesState = { lifestyle: [], events: [], travel: [] };

  async function loadRates() {
    ratesStatus("", "Loading…");
    try {
      const res = await authFetch("/api/admin-rates");
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const { rates } = await res.json();
      ratesState = {
        lifestyle: (rates && rates.lifestyle) || [],
        events:    (rates && rates.events)    || [],
        travel:    (rates && rates.travel)    || [],
      };
      renderRates();
      ratesStatus("", "");
    } catch (err) {
      ratesStatus("err", err.message);
    }
  }

  function renderRates() {
    const wrap = document.getElementById("ratesForm");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const section of RATES_SECTIONS) {
      const box = document.createElement("div");
      box.className = "admin__rates-section";
      box.dataset.section = section.key;
      box.innerHTML =
        `<div class="admin__rates-section__head">
           <h3 class="admin__rates-section__title">${escapeHtml(section.title)}</h3>
         </div>
         <div class="admin__rates-section__rows" data-role="rows"></div>
         <button type="button" class="admin__rates-section__addbtn" data-act="add">+ Add row to ${escapeHtml(section.title.replace(/^\d+\.\s*/, ""))}</button>`;
      const rowsWrap = box.querySelector("[data-role='rows']");
      (ratesState[section.key] || []).forEach((row, i) => {
        const el = document.createElement("div");
        el.className = "admin__rates-row";
        el.innerHTML =
          `<input type="text" data-field="label" value="${escapeHtml(row.label || "")}" placeholder="Label (e.g. Full day commercial)" />` +
          `<input type="text" data-field="priceText" value="${escapeHtml(row.priceText || "")}" placeholder="Price (e.g. $4,800+ or $350 / hr or Included)" />` +
          `<button type="button" class="admin__rates-row__delete" data-act="delete">Delete</button>`;
        el.querySelectorAll("[data-field]").forEach((input) => {
          input.addEventListener("input", () => {
            ratesState[section.key][i][input.dataset.field] = input.value;
          });
        });
        el.querySelector('[data-act="delete"]').addEventListener("click", () => {
          if (!confirm(`Delete "${row.label || "this row"}"?`)) return;
          ratesState[section.key].splice(i, 1);
          renderRates();
        });
        rowsWrap.appendChild(el);
      });
      box.querySelector('[data-act="add"]').addEventListener("click", () => {
        ratesState[section.key].push({
          id: "row-" + Date.now().toString(36),
          label: "",
          priceText: "",
        });
        renderRates();
      });
      wrap.appendChild(box);
    }
  }

  async function saveRates() {
    // Trim + drop rows with empty labels or priceText — those are
    // half-added rows the user forgot to fill in.
    const cleaned = {};
    for (const key of ["lifestyle", "events", "travel"]) {
      cleaned[key] = (ratesState[key] || [])
        .map((r) => ({
          id: r.id,
          label: (r.label || "").trim(),
          priceText: (r.priceText || "").trim(),
        }))
        .filter((r) => r.label && r.priceText);
    }
    ratesStatus("", "Saving…");
    try {
      const res = await authFetch("/api/admin-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      ratesState = data.rates || cleaned;
      renderRates();
      ratesStatus("ok", "Saved. Changes are live on /pricing.");
    } catch (err) {
      ratesStatus("err", err.message);
    }
  }

  async function resetRatesToDefaults() {
    if (!confirm("Reset all three sections (Lifestyle, Events, Travel) to defaults? Your customizations will be wiped.")) return;
    try {
      const res = await authFetch("/api/admin-rates", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Reset failed (${res.status})`);
      ratesState = data.rates || { lifestyle: [], events: [], travel: [] };
      renderRates();
      ratesStatus("ok", "Reset to defaults.");
    } catch (err) {
      ratesStatus("err", err.message);
    }
  }

  function ratesStatus(kind, msg) {
    const el = document.getElementById("ratesStatus");
    if (!el) return;
    el.className = "admin__status admin__status--inline" + (kind ? " admin__status--" + kind : "");
    el.textContent = msg || "";
  }

  const saveRatesBtn = document.getElementById("saveRatesBtn");
  const resetRatesBtn = document.getElementById("resetRatesBtn");
  if (saveRatesBtn) saveRatesBtn.addEventListener("click", saveRates);
  if (resetRatesBtn) resetRatesBtn.addEventListener("click", resetRatesToDefaults);

  document.querySelectorAll(".admin__tab[data-tab='rates']").forEach((t) => {
    t.addEventListener("click", () => loadRates().catch(console.error));
  });

  // -----------------------------------------------------------
  // INVOICES — Stripe-backed. Stripe is the system of record; we
  // never persist invoices in Blobs, so there's nothing to keep in
  // sync and Wendy can also work from the Stripe Dashboard directly.
  // -----------------------------------------------------------
  let invoiceLines = [{ description: "", quantity: 1, amount: "" }];

  function renderInvoiceLines() {
    const wrap = document.getElementById("invoiceLines");
    if (!wrap) return;
    wrap.innerHTML = "";
    invoiceLines.forEach((line, i) => {
      const el = document.createElement("div");
      el.className = "admin__invoice-line";
      el.innerHTML =
        `<input type="text" data-field="description" value="${escapeHtml(line.description || "")}" placeholder="Description (e.g. Balance — Standard Headshot session)" />` +
        `<input type="number" data-field="quantity" value="${line.quantity || 1}" min="1" step="1" title="Quantity" />` +
        `<div class="admin__invoice-line__amt-wrap">
           <input type="number" data-field="amount" value="${line.amount}" min="0" step="0.01" placeholder="0.00" title="Unit amount" />
         </div>` +
        `<button type="button" class="admin__invoice-line__delete" data-act="delete">×</button>`;
      el.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("input", () => {
          const f = input.dataset.field;
          invoiceLines[i][f] = f === "description" ? input.value : input.value;
          updateInvoiceTotal();
        });
      });
      el.querySelector('[data-act="delete"]').addEventListener("click", () => {
        // Always keep at least one row so the form is never empty.
        if (invoiceLines.length === 1) {
          invoiceLines[0] = { description: "", quantity: 1, amount: "" };
        } else {
          invoiceLines.splice(i, 1);
        }
        renderInvoiceLines();
        updateInvoiceTotal();
      });
      wrap.appendChild(el);
    });
  }

  // Read the discount form controls into a normalized shape.
  // Returns null when no discount is selected.
  function readInvoiceDiscount() {
    const typeEl = document.getElementById("inv-discount-type");
    const valEl = document.getElementById("inv-discount-value");
    const labelEl = document.getElementById("inv-discount-label");
    if (!typeEl || typeEl.value === "none") return null;
    const value = Number(valEl && valEl.value);
    if (!Number.isFinite(value) || value <= 0) return null;
    return {
      type: typeEl.value,
      value,
      label: (labelEl && labelEl.value.trim()) || "Discount",
    };
  }

  function updateInvoiceTotal() {
    const el = document.getElementById("invoiceTotal");
    if (!el) return;
    const subtotal = invoiceLines.reduce((sum, l) => {
      const amt = Number(l.amount) || 0;
      const qty = Number(l.quantity) || 1;
      return sum + amt * qty;
    }, 0);

    const discount = readInvoiceDiscount();
    let discountAmount = 0;
    if (discount) {
      discountAmount = discount.type === "percent"
        ? (subtotal * discount.value) / 100
        : discount.value;
      // Never let the preview show a negative total — the server
      // rejects an over-large flat discount anyway, but the preview
      // shouldn't display nonsense while she's mid-typing.
      discountAmount = Math.min(discountAmount, subtotal);
    }
    const total = subtotal - discountAmount;

    const lines = [];
    if (discount && discountAmount > 0) {
      const label = discount.type === "percent"
        ? `${escapeHtml(discount.label)} (${discount.value}% off)`
        : escapeHtml(discount.label);
      lines.push(`<small>Subtotal: $${subtotal.toFixed(2)}</small>`);
      lines.push(`<small class="is-discount">${label}: −$${discountAmount.toFixed(2)}</small>`);
    }

    // If the invoice is being split, show what each of the two
    // invoices will be for. Deposit is rounded to cents and the
    // balance derived by subtraction so they always sum to the total.
    const split = readInvoiceSplit();
    if (split && total > 0) {
      const depositAmt = Math.round(total * 100 * (split.depositPercent / 100)) / 100;
      const balanceAmt = Math.round(total * 100 - depositAmt * 100) / 100;
      if (!lines.length) lines.push(`<small>Subtotal: $${subtotal.toFixed(2)}</small>`);
      lines.push(`<small>Deposit now (${split.depositPercent}%): $${depositAmt.toFixed(2)}</small>`);
      lines.push(`<small>Balance after shoot: $${balanceAmt.toFixed(2)}</small>`);
    }

    el.innerHTML = lines.join("") + `Total: $${total.toFixed(2)}`;
  }

  // Read the split checkbox + percent. Returns null when off.
  function readInvoiceSplit() {
    const cb = document.getElementById("inv-split");
    if (!cb || !cb.checked) return null;
    const pctEl = document.getElementById("inv-split-pct");
    const pct = Number(pctEl && pctEl.value);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
    return { depositPercent: pct };
  }

  function wireInvoiceSplitControls() {
    const cb = document.getElementById("inv-split");
    const wrap = document.getElementById("invSplitPctWrap");
    const pct = document.getElementById("inv-split-pct");
    if (!cb || !wrap || !pct) return;
    cb.addEventListener("change", () => {
      wrap.hidden = !cb.checked;
      updateInvoiceTotal();
    });
    pct.addEventListener("input", updateInvoiceTotal);
  }

  // Enable/disable the discount value + label inputs based on the
  // type selector, and recompute the total on any change.
  function wireInvoiceDiscountControls() {
    const typeEl = document.getElementById("inv-discount-type");
    const valEl = document.getElementById("inv-discount-value");
    const labelEl = document.getElementById("inv-discount-label");
    if (!typeEl || !valEl || !labelEl) return;
    function syncEnabled() {
      const off = typeEl.value === "none";
      valEl.disabled = off;
      labelEl.disabled = off;
      if (off) { valEl.value = ""; labelEl.value = ""; }
      // Swap the placeholder so the unit is obvious at a glance.
      valEl.placeholder = typeEl.value === "percent" ? "10" : "0.00";
      updateInvoiceTotal();
    }
    typeEl.addEventListener("change", syncEnabled);
    valEl.addEventListener("input", updateInvoiceTotal);
    labelEl.addEventListener("input", updateInvoiceTotal);
    syncEnabled();
  }

  async function createInvoice() {
    const status = document.getElementById("invoiceCreateStatus");
    status.className = "admin__status admin__status--inline";
    const name = document.getElementById("inv-name").value.trim();
    const email = document.getElementById("inv-email").value.trim();
    const due = document.getElementById("inv-due").value.trim();
    const memo = document.getElementById("inv-memo").value.trim();

    if (!name) return (status.textContent = "Enter the client's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return (status.textContent = "Enter a valid client email.");
    }
    const cleanLines = invoiceLines
      .map((l) => ({
        description: (l.description || "").trim(),
        quantity: Number(l.quantity) || 1,
        amount: Number(l.amount) || 0,
      }))
      .filter((l) => l.description && l.amount > 0);
    if (!cleanLines.length) {
      return (status.textContent = "Add at least one line item with a description and an amount.");
    }

    const subtotal = cleanLines.reduce((s, l) => s + l.amount * l.quantity, 0);
    const discount = readInvoiceDiscount();
    let discountAmount = 0;
    if (discount) {
      discountAmount = discount.type === "percent"
        ? (subtotal * discount.value) / 100
        : discount.value;
      if (discountAmount > subtotal) {
        return (status.textContent =
          `The $${discountAmount.toFixed(2)} discount is larger than the ` +
          `$${subtotal.toFixed(2)} subtotal.`);
      }
    }
    const total = subtotal - discountAmount;

    const discountLine = discount
      ? `\nDiscount: −$${discountAmount.toFixed(2)} (${discount.label})`
      : "";
    const split = readInvoiceSplit();

    let confirmMsg;
    if (split) {
      const depositAmt = Math.round(total * 100 * (split.depositPercent / 100)) / 100;
      const balanceAmt = Math.round(total * 100 - depositAmt * 100) / 100;
      confirmMsg =
        `Create TWO invoices for ${name} (${email})?\n\n` +
        `Subtotal: $${subtotal.toFixed(2)}${discountLine}\n` +
        `Job total: $${total.toFixed(2)}\n\n` +
        `1. Deposit $${depositAmt.toFixed(2)} (${split.depositPercent}%) — emailed NOW\n` +
        `2. Balance $${balanceAmt.toFixed(2)} — saved as a draft\n\n` +
        `Send the balance yourself after the shoot using the "Send now" button on that row.`;
    } else {
      confirmMsg =
        `Send an invoice to ${name} (${email})?\n\n` +
        `Subtotal: $${subtotal.toFixed(2)}${discountLine}\n` +
        `Total due: $${total.toFixed(2)}\n\n` +
        `Stripe will email them a payment page immediately.`;
    }
    if (!confirm(confirmMsg)) return;

    const btn = document.getElementById("createInvoiceBtn");
    btn.disabled = true;
    status.textContent = "Creating and sending…";
    try {
      const res = await authFetch("/api/admin-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          customerEmail: email,
          daysUntilDue: due === "" ? null : Number(due),
          memo: memo || null,
          lineItems: cleanLines,
          discountType: discount ? discount.type : "none",
          discountValue: discount ? discount.value : null,
          discountLabel: discount ? discount.label : null,
          split: split
            ? { enabled: true, depositPercent: split.depositPercent }
            : { enabled: false },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`);
      status.className = "admin__status admin__status--inline admin__status--ok";
      if (data.split && data.balanceInvoice) {
        status.textContent =
          `Deposit invoice ${data.invoice.number || ""} sent to ${email} for ` +
          `$${data.invoice.amountDue.toFixed(2)}. Balance of ` +
          `$${data.balanceInvoice.amountDue.toFixed(2)} is saved as a draft — ` +
          `hit "Send now" on that row after the shoot.`;
      } else {
        status.textContent =
          `Invoice ${data.invoice.number || ""} sent to ${email} for $${data.invoice.amountDue.toFixed(2)}.`;
      }
      // Reset the form
      document.getElementById("inv-name").value = "";
      document.getElementById("inv-email").value = "";
      document.getElementById("inv-due").value = "14";
      document.getElementById("inv-memo").value = "";
      const dType = document.getElementById("inv-discount-type");
      const dVal = document.getElementById("inv-discount-value");
      const dLbl = document.getElementById("inv-discount-label");
      if (dType) dType.value = "none";
      if (dVal) { dVal.value = ""; dVal.disabled = true; }
      if (dLbl) { dLbl.value = ""; dLbl.disabled = true; }
      const splitCb = document.getElementById("inv-split");
      const splitWrap = document.getElementById("invSplitPctWrap");
      const splitPct = document.getElementById("inv-split-pct");
      if (splitCb) splitCb.checked = false;
      if (splitWrap) splitWrap.hidden = true;
      if (splitPct) splitPct.value = "25";
      invoiceLines = [{ description: "", quantity: 1, amount: "" }];
      renderInvoiceLines();
      updateInvoiceTotal();
      await loadInvoices();
    } catch (err) {
      status.className = "admin__status admin__status--inline admin__status--err";
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function loadInvoices() {
    const wrap = document.getElementById("invoicesList");
    if (!wrap) return;
    wrap.innerHTML = '<p class="admin__status">Loading…</p>';
    try {
      const res = await authFetch("/api/admin-invoices");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
      renderInvoices(data.invoices || []);
    } catch (err) {
      wrap.innerHTML = `<p class="admin__status admin__status--err">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderInvoices(invoices) {
    const wrap = document.getElementById("invoicesList");
    if (!wrap) return;
    if (!invoices.length) {
      wrap.innerHTML = '<p class="admin__status">No invoices yet — create one above.</p>';
      return;
    }
    wrap.innerHTML = "";
    invoices.forEach((inv) => {
      // An "open" invoice past its due date reads as overdue, which
      // Stripe doesn't model as a distinct status — derive it here.
      let status = inv.status;
      if (status === "open" && inv.dueDate && inv.dueDate < Date.now()) {
        status = "overdue";
      }
      const row = document.createElement("div");
      row.className = "admin__invoice-row";
      const dueTxt = inv.dueDate
        ? new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "—";
      const createdTxt = inv.created
        ? new Date(inv.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "";
      const canVoid = inv.status === "open" || inv.status === "draft";
      const canResend = inv.status === "open";
      // A draft that's the balance half of a split is the one Wendy
      // sends after the shoot — give it a prominent Send now button.
      const canSendDraft = inv.status === "draft";
      const splitBadge = inv.splitRole
        ? `<span class="admin__invoice-split-badge">${
            inv.splitRole === "deposit" ? "Deposit 1 of 2" : "Balance 2 of 2"
          }</span>`
        : "";
      // Drafts have no number assigned yet (Stripe assigns it at
      // finalize), so fall back to a readable id fragment.
      const displayNum = inv.number || (inv.status === "draft" ? "(draft)" : inv.id.slice(-8));
      const sentTxt = inv.status === "draft" ? "not sent yet" : `sent ${createdTxt}`;
      row.innerHTML =
        `<div class="admin__invoice-row__num">${escapeHtml(displayNum)}</div>` +
        `<div class="admin__invoice-row__meta">
           <strong>${escapeHtml(inv.customerName || "—")}</strong>
           ${inv.customerEmail ? "&middot; " + escapeHtml(inv.customerEmail) : ""}<br/>
           <span class="admin__invoice-status admin__invoice-status--${status}">${escapeHtml(status)}</span>
           ${splitBadge}
           <span class="muted">&middot; ${escapeHtml(sentTxt)} &middot; due ${escapeHtml(dueTxt)}</span>
           ${inv.description ? '<br/><span class="muted">' + escapeHtml(inv.description) + "</span>" : ""}
         </div>` +
        `<div class="admin__invoice-row__amt">$${(inv.amountDue || 0).toFixed(2)}</div>` +
        `<div class="admin__invoice-row__actions">
           ${canSendDraft ? `<button type="button" class="btn btn--primary" data-act="send" data-id="${inv.id}">Send now</button>` : ""}
           ${inv.hostedInvoiceUrl ? `<a class="btn" href="${inv.hostedInvoiceUrl}" target="_blank" rel="noopener">View</a>` : ""}
           ${inv.invoicePdf ? `<a class="btn" href="${inv.invoicePdf}" target="_blank" rel="noopener">PDF</a>` : ""}
           ${canResend ? `<button type="button" class="btn" data-act="resend" data-id="${inv.id}">Resend</button>` : ""}
           ${canVoid ? `<button type="button" class="btn btn--danger" data-act="void" data-id="${inv.id}">Void</button>` : ""}
         </div>`;
      row.querySelectorAll("button[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => onInvoiceAction(btn.dataset.act, btn.dataset.id));
      });
      wrap.appendChild(row);
    });
  }

  async function onInvoiceAction(act, id) {
    if (act === "send") {
      if (!confirm(
        "Send this invoice to the client now?\n\n" +
        "It'll be finalized (assigning an invoice number) and emailed immediately."
      )) return;
    }
    if (act === "resend") {
      if (!confirm("Re-send this invoice email to the client?")) return;
    }
    if (act === "void") {
      if (!confirm(
        "Void this invoice?\n\nVoiding is permanent — the client can no longer pay it. " +
        "Use this for invoices sent in error. (If they already paid, refund from the Stripe Dashboard instead.)"
      )) return;
    }
    try {
      const res = await authFetch(`/api/admin-invoices?action=${act}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${act} failed (${res.status})`);
      await loadInvoices();
    } catch (err) {
      alert(err.message);
    }
  }

  const createInvoiceBtn = document.getElementById("createInvoiceBtn");
  const addInvoiceLineBtn = document.getElementById("addInvoiceLineBtn");
  const refreshInvoicesBtn = document.getElementById("refreshInvoicesBtn");
  if (createInvoiceBtn) createInvoiceBtn.addEventListener("click", createInvoice);
  if (addInvoiceLineBtn) addInvoiceLineBtn.addEventListener("click", () => {
    invoiceLines.push({ description: "", quantity: 1, amount: "" });
    renderInvoiceLines();
  });
  if (refreshInvoicesBtn) refreshInvoicesBtn.addEventListener("click", () => loadInvoices().catch(console.error));

  // Wire the discount + split controls once at load (the elements exist
  // in the DOM even while the tab is hidden).
  wireInvoiceDiscountControls();
  wireInvoiceSplitControls();

  document.querySelectorAll(".admin__tab[data-tab='invoices']").forEach((t) => {
    t.addEventListener("click", () => {
      renderInvoiceLines();
      updateInvoiceTotal();
      loadInvoices().catch(console.error);
    });
  });

  // Boot — if Identity hasn't fired init yet, run an initial pass anyway
  // so the auth gate shows up.
  if (!identity) {
    document.getElementById("authBlock").hidden = false;
    document.getElementById("tabs").hidden = true;
  }
})();
