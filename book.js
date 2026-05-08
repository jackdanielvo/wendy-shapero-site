/* ============================================================
   WendyPix booking page — frontend logic.
   Multi-step flow: package → slot → form → done.
   Talks to Netlify Functions at /.netlify/functions/availability
   and /.netlify/functions/book.
   ============================================================ */

(function () {
  // ----------------------------------------------------------
  // PACKAGE CONFIG. The live source of truth lives in Netlify
  // Blobs and is editable from /admin. We fetch it on page load
  // via /api/packages (with the array below as a fallback if the
  // network call fails — keeps the page working even mid-incident).
  // ----------------------------------------------------------
  const FALLBACK_PACKAGES = [
    {
      id: "headshot-essential",
      name: "Essential Headshot",
      price: 600,
      duration: 60,                // minutes
      includes: ["1-hour session", "Up to 2 looks", "3 retouched final images"],
      description: "Quick, polished, ready for your roster.",
    },
    {
      id: "headshot-standard",
      name: "Standard Headshot",
      price: 850,
      duration: 90,
      includes: ["1.5-hour session", "Up to 4 looks", "6 retouched final images"],
      description: "Most popular — actor & exec sweet spot.",
      featured: true,
    },
    {
      id: "headshot-premium",
      name: "Premium Headshot",
      price: 1400,
      duration: 120,
      includes: [
        "2-hour session",
        "Unlimited looks",
        "10 retouched final images",
        "Hair & makeup included",
      ],
      description: "Full-service — looks, retouching, glam.",
    },
    {
      id: "lifestyle-inquiry",
      name: "Lifestyle / Commercial",
      price: null,                  // quote-based
      duration: null,
      includes: ["Brand portraits", "Editorial / on-location", "Commercial usage"],
      description: "Quote-based — let's scope it on a 15-min call.",
      inquiry: true,
    },
    {
      id: "event-inquiry",
      name: "Event Coverage",
      price: null,
      duration: null,
      includes: ["Hourly, 2-hour minimum", "Galleries in 7 business days", "Same-day previews available"],
      description: "Hourly — pick a duration on the call.",
      inquiry: true,
    },
  ];

  // Live packages — set by loadPackages() at boot.
  let PACKAGES = FALLBACK_PACKAGES;

  // ----------------------------------------------------------
  // STATE — what the user has selected so far.
  // ----------------------------------------------------------
  const state = {
    package: null,         // PACKAGES entry
    day: null,             // ISO date string YYYY-MM-DD
    time: null,            // ISO datetime string (start of slot)
    availability: null,    // {days: [...]} loaded from API
  };

  async function loadPackages() {
    try {
      const res = await fetch("/api/packages", { cache: "no-store" });
      if (!res.ok) throw new Error("packages " + res.status);
      const data = await res.json();
      if (Array.isArray(data.packages) && data.packages.length) {
        PACKAGES = data.packages;
      }
    } catch (err) {
      console.warn("[book] /api/packages fetch failed, using fallback:", err.message);
    }
  }

  // ----------------------------------------------------------
  // STEP NAVIGATION. Sections in DOM with [data-step="N"] are
  // hidden by default; show only the active one.
  // ----------------------------------------------------------
  function gotoStep(n) {
    document.querySelectorAll("[data-step]").forEach((el) => {
      el.hidden = Number(el.dataset.step) !== n;
    });
    // Smooth scroll to the new step
    const active = document.querySelector(`[data-step="${n}"]`);
    if (active) active.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ----------------------------------------------------------
  // RENDER PACKAGE CARDS
  // ----------------------------------------------------------
  function renderPackages() {
    const wrap = document.getElementById("packageCards");
    if (!wrap) return;
    wrap.innerHTML = "";
    PACKAGES.forEach((pkg) => {
      const card = document.createElement("article");
      card.className = "rate-card" + (pkg.featured ? " rate-card--featured" : "");
      card.dataset.packageId = pkg.id;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      const flag = pkg.featured
        ? `<p class="rate-card__flag">Most popular</p>`
        : "";
      const priceHtml = pkg.price
        ? `<p class="rate-card__price">$${pkg.price.toLocaleString()}</p>`
        : `<p class="rate-card__price" style="font-size:clamp(28px,3.6vw,40px)">Quote</p>`;
      const tag = pkg.duration
        ? `${pkg.duration / 60}-hour session`
        : "15-min discovery call first";
      const includes = pkg.includes
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("");
      card.innerHTML =
        flag +
        `<p class="rate-card__name">${escapeHtml(pkg.name)}</p>` +
        priceHtml +
        `<p class="rate-card__tag">${escapeHtml(tag)}</p>` +
        `<ul class="rate-card__list">${includes}</ul>`;

      const choose = () => selectPackage(pkg);
      card.addEventListener("click", choose);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
      wrap.appendChild(card);
    });
  }

  // ----------------------------------------------------------
  // SELECT PACKAGE → step 2 (or, for quote-based packages, send
  // them straight to email since the booking flow doesn't fit).
  // ----------------------------------------------------------
  function selectPackage(pkg) {
    if (pkg.inquiry) {
      // Quote-based — open mailto with subject line. Phase 1.
      window.location.href =
        "mailto:wendy@wendypix.com" +
        "?subject=" +
        encodeURIComponent(pkg.name + " inquiry") +
        "&body=" +
        encodeURIComponent(
          `Hi Wendy,\n\nI'm interested in booking a ${pkg.name.toLowerCase()} session.\n\nA bit about the project:\n\n— `
        );
      return;
    }
    state.package = pkg;
    document.getElementById("chosenPackage").textContent =
      `${pkg.name} · $${pkg.price.toLocaleString()} · ${pkg.duration / 60} hours`;
    loadAvailability();
    gotoStep(2);
  }

  // ----------------------------------------------------------
  // LOAD AVAILABILITY from the serverless function.
  // The endpoint reads Wendy's Google Calendar and returns days
  // with open slots that fit the requested duration.
  // ----------------------------------------------------------
  async function loadAvailability() {
    const picker = document.getElementById("slotPicker");
    picker.innerHTML = `<div class="book__loading">Loading available dates…</div>`;

    try {
      const res = await fetch(
        `/.netlify/functions/availability?duration=${state.package.duration}`
      );
      if (!res.ok) throw new Error("availability " + res.status);
      const data = await res.json();
      state.availability = data;
      renderSlotPicker(data);
    } catch (err) {
      console.error("[book] availability error:", err);
      picker.innerHTML = `
        <div class="book__error">
          Couldn't load available dates right now. Please email
          <a href="mailto:wendy@wendypix.com">wendy@wendypix.com</a>
          and we'll set up your session manually.
        </div>`;
    }
  }

  // ----------------------------------------------------------
  // RENDER SLOT PICKER — two-column layout: days left, times right.
  // ----------------------------------------------------------
  function renderSlotPicker(avail) {
    const picker = document.getElementById("slotPicker");
    if (!avail.days || !avail.days.length) {
      picker.innerHTML = `
        <div class="book__error">
          No available dates in the next few weeks. Email
          <a href="mailto:wendy@wendypix.com">wendy@wendypix.com</a>
          and we'll find time.
        </div>`;
      return;
    }
    picker.innerHTML =
      `<ul class="book__days" id="dayList" role="listbox" aria-label="Available days"></ul>` +
      `<div class="book__times-wrap"><ul class="book__times" id="timeList" role="listbox" aria-label="Available times"></ul></div>`;

    const dayList = document.getElementById("dayList");
    avail.days.forEach((day, i) => {
      const li = document.createElement("li");
      li.className = "book__day";
      li.setAttribute("role", "option");
      li.dataset.date = day.date;
      const date = new Date(day.date + "T12:00:00");
      const dateStr = date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      li.innerHTML =
        `<span class="day-date">${dateStr}</span>` +
        `<span class="day-meta">${day.slots.length} ${day.slots.length === 1 ? "time" : "times"}</span>`;
      li.tabIndex = 0;
      li.addEventListener("click", () => selectDay(day));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectDay(day);
        }
      });
      dayList.appendChild(li);
    });

    // Default-select the first day so the user sees times immediately.
    selectDay(avail.days[0]);
  }

  function selectDay(day) {
    state.day = day.date;
    state.time = null;
    // Update day selection visuals
    document.querySelectorAll(".book__day").forEach((el) => {
      el.setAttribute(
        "aria-selected",
        el.dataset.date === day.date ? "true" : "false"
      );
    });
    renderTimes(day);
  }

  function renderTimes(day) {
    const wrap = document.querySelector(".book__times-wrap");
    if (!wrap) return;
    if (!day.slots.length) {
      wrap.innerHTML = `<p class="book__times-empty">No times open this day.</p>`;
      return;
    }
    wrap.innerHTML = `<ul class="book__times" id="timeList"></ul>`;
    const timeList = document.getElementById("timeList");
    day.slots.forEach((slot) => {
      const li = document.createElement("li");
      li.className = "book__time";
      li.setAttribute("role", "option");
      li.dataset.time = slot.start;
      const start = new Date(slot.start);
      const label = start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      li.textContent = label;
      li.tabIndex = 0;
      li.addEventListener("click", () => selectTime(slot));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectTime(slot);
        }
      });
      timeList.appendChild(li);
    });
  }

  function selectTime(slot) {
    state.time = slot.start;
    document.querySelectorAll(".book__time").forEach((el) => {
      el.setAttribute(
        "aria-selected",
        el.dataset.time === slot.start ? "true" : "false"
      );
    });
    // Tiny pause so the visual selection registers before navigating
    setTimeout(() => goToForm(), 250);
  }

  // ----------------------------------------------------------
  // STEP 3 — intake form
  // ----------------------------------------------------------
  function goToForm() {
    const start = new Date(state.time);
    const summary =
      state.package.name +
      " · " +
      start.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }) +
      " · " +
      start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
    document.getElementById("chosenSummary").textContent = summary;

    // Deposit note depends on whether Stripe is configured. The
    // server tells us which mode we're in via a small endpoint.
    const noteEl = document.getElementById("depositNote");
    fetch("/.netlify/functions/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.stripeEnabled) {
          noteEl.innerHTML =
            "<strong>Deposit:</strong> a 25% non-refundable retainer (" +
            "$" +
            Math.round(state.package.price * 0.25).toLocaleString() +
            ") will be charged at submit to hold your date. " +
            "The balance is due 24 hours before the session.";
        } else {
          noteEl.innerHTML =
            "<strong>What happens next:</strong> I'll confirm your booking " +
            "by email within 24 hours and send deposit instructions " +
            "(25% non-refundable retainer to hold the date). " +
            "Until then, the slot is held for you.";
        }
      })
      .catch(() => {
        // If config endpoint is down, default to manual-deposit message
        noteEl.innerHTML =
          "<strong>What happens next:</strong> I'll confirm your booking " +
          "by email within 24 hours and send deposit instructions.";
      });

    gotoStep(3);
  }

  // ----------------------------------------------------------
  // SUBMIT BOOKING
  //
  // Read fields by element ID rather than `form.name` / `form.email`
  // / etc. Form-named-property access (e.g. `form.name`) is a legacy
  // browser feature that has subtle precedence rules — `form.name`
  // can resolve to the form element's own `name` attribute string
  // instead of the child input under some circumstances. Using the
  // element ID is unambiguous and survives any DOM tweaks.
  // ----------------------------------------------------------
  function val(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  async function submitBooking(e) {
    e.preventDefault();
    const submitBtn = document.getElementById("submitBtn");

    const data = {
      packageId: state.package.id,
      packageName: state.package.name,
      packagePrice: state.package.price,
      packageDurationMin: state.package.duration,
      slotStart: state.time,
      name: val("f-name"),
      email: val("f-email"),
      phone: val("f-phone"),
      looks: Number(val("f-looks")) || null,
      hmua: !!(document.getElementById("f-hmua") || {}).checked,
      notes: val("f-notes"),
    };

    // Pre-flight validation. The form is novalidate (we handle UX here),
    // so we have to catch missing required fields before the server does.
    const missing = [];
    if (!data.name) missing.push("Full name");
    if (!data.email) missing.push("Email");
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      alert("That email address doesn't look right — could you double-check it?");
      document.getElementById("f-email").focus();
      return;
    }
    if (missing.length) {
      alert(
        `Please fill in: ${missing.join(", ")}. ` +
        `These help me confirm your booking.`
      );
      // Focus the first missing field so the user lands on it directly
      const firstId = !data.name ? "f-name" : "f-email";
      const el = document.getElementById(firstId);
      if (el) el.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      const res = await fetch("/.netlify/functions/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "book failed");

      if (result.checkoutUrl) {
        // Stripe path — redirect to Checkout
        window.location.href = result.checkoutUrl;
        return;
      }

      // Non-Stripe path — show confirmation
      showDone(data, result);
    } catch (err) {
      console.error("[book] submit error:", err);
      alert(
        "Something went wrong submitting your booking. Please email " +
          "wendy@wendypix.com and I'll set it up manually. (" +
          (err.message || "unknown") +
          ")"
      );
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit booking request";
    }
  }

  function showDone(data, result) {
    const start = new Date(data.slotStart);
    document.getElementById("doneSummary").innerHTML =
      `Your <strong>${escapeHtml(data.packageName)}</strong> session is on hold for ` +
      start.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }) +
      " at " +
      start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }) +
      ". A confirmation will land in your inbox within 24 hours. " +
      "I sent a copy to <strong>" +
      escapeHtml(data.email) +
      "</strong> as well — keep an eye on your spam folder if you don't see it.";
    gotoStep(4);
  }

  // ----------------------------------------------------------
  // BACK NAVIGATION
  // ----------------------------------------------------------
  document.addEventListener("click", (e) => {
    const action = e.target.dataset && e.target.dataset.action;
    if (action === "back-to-package") gotoStep(1);
    else if (action === "back-to-slot") gotoStep(2);
  });

  // ----------------------------------------------------------
  // ESCAPE-HTML helper (small XSS guard for user-provided strings)
  // ----------------------------------------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    await loadPackages();
    renderPackages();
    const form = document.getElementById("bookForm");
    if (form) form.addEventListener("submit", submitBooking);
  });
})();
