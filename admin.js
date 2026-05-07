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

  // Boot — if Identity hasn't fired init yet, run an initial pass anyway
  // so the auth gate shows up.
  if (!identity) {
    document.getElementById("authBlock").hidden = false;
    document.getElementById("tabs").hidden = true;
  }
})();
