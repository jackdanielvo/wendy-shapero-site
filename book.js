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
    promoCode: null,       // uppercase A-Z0-9 string, or null
    promo: null,           // {percentOff, discountedPrice, ...} from redeem-code, or null
  };

  async function loadPackages() {
    try {
      // ?t=<timestamp> to bypass CDN cache too, so a fresh admin edit
      // is reflected on the next book-page reload even if the CDN
      // hasn't yet expired the cached response.
      const res = await fetch("/api/packages?t=" + Date.now(), { cache: "no-store" });
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
    // Steps can be numeric (1, 2, 3, 4) or named (e.g., "2-inquiry").
    // Compare as strings so both work.
    const target = String(n);
    document.querySelectorAll("[data-step]").forEach((el) => {
      el.hidden = String(el.dataset.step) !== target;
    });
    // Smooth scroll to the new step
    const active = document.querySelector(`[data-step="${target}"]`);
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
      // Quote-based packages route to an inline inquiry form instead of
      // the slot picker. The form posts to /api/inquiry which emails
      // Wendy via Resend. No mailto: app-launch dialog, works on every
      // device.
      state.package = pkg;
      const chosen = document.getElementById("inquiryChosenPackage");
      if (chosen) chosen.textContent = `${pkg.name} · quote-based`;
      // Show/hide the guest-count row based on package id
      const guestsRow = document.getElementById("row-i-guests");
      if (guestsRow) {
        const isEvent = /event/i.test(pkg.id) || /event/i.test(pkg.name);
        guestsRow.hidden = !isEvent;
      }
      // Clear any prior status / submit-button state
      const status = document.getElementById("inquiryStatus");
      if (status) {
        status.textContent = "";
        status.className = "admin__status admin__status--inline";
      }
      const submitBtn = document.getElementById("inquirySubmitBtn");
      if (submitBtn) submitBtn.disabled = false;
      gotoStep("2-inquiry");
      return;
    }
    state.package = pkg;
    document.getElementById("chosenPackage").textContent =
      `${pkg.name} · $${pkg.price.toLocaleString()} · ${pkg.duration / 60} hours`;
    loadAvailability();
    gotoStep(2);
  }

  // ----------------------------------------------------------
  // INQUIRY FORM submit — POST to /api/inquiry, show in-page result
  // ----------------------------------------------------------
  const inquiryForm = document.getElementById("inquiryForm");
  if (inquiryForm) {
    inquiryForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const pkg = state.package;
      if (!pkg) {
        inquirySetStatus("err", "Pick a package first.");
        return;
      }
      const status = document.getElementById("inquiryStatus");
      const submitBtn = document.getElementById("inquirySubmitBtn");

      // Collect values
      const payload = {
        packageId: pkg.id,
        packageName: pkg.name,
        name: (document.getElementById("i-name").value || "").trim(),
        email: (document.getElementById("i-email").value || "").trim(),
        phone: (document.getElementById("i-phone").value || "").trim(),
        eventDate: (document.getElementById("i-date").value || "").trim(),
        guestCount: (document.getElementById("i-guests").value || "").trim(),
        notes: (document.getElementById("i-notes").value || "").trim(),
      };

      // Client-side validation
      if (!payload.name) {
        inquirySetStatus("err", "Please add your name.");
        return;
      }
      if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
        inquirySetStatus("err", "Please add a valid email.");
        return;
      }
      if (!payload.notes) {
        inquirySetStatus("err", "Please tell me a bit about your project.");
        return;
      }

      inquirySetStatus("", "Sending…");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch("/api/inquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error || `Send failed (${res.status})`);
        }
        // Success — show the same "done" step the booking flow uses
        const doneSummary = document.getElementById("doneSummary");
        if (doneSummary) {
          doneSummary.textContent =
            body.message ||
            `Thanks, ${payload.name.split(" ")[0]}! Your inquiry is in — Wendy will be in touch within 24 hours.`;
        }
        gotoStep(4);
        // Reset the form for any future submissions
        inquiryForm.reset();
      } catch (e) {
        inquirySetStatus("err", e.message || "Couldn't send right now.");
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  function inquirySetStatus(kind, msg) {
    const el = document.getElementById("inquiryStatus");
    if (!el) return;
    el.className =
      "admin__status admin__status--inline" + (kind ? " admin__status--" + kind : "");
    el.textContent = msg || "";
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
    // Always show times in the studio's timezone (LA) regardless of the
    // viewer's location — these are physical, in-person shoots, so the
    // posted time IS the local-LA time. Otherwise a NYC viewer would
    // see "12:00 PM EDT" for what was set as 9am PT, which is confusing.
    const tz = (state.availability && state.availability.timezone) || "America/Los_Angeles";
    day.slots.forEach((slot) => {
      const li = document.createElement("li");
      li.className = "book__time";
      li.setAttribute("role", "option");
      li.dataset.time = slot.start;
      const start = new Date(slot.start);
      const label = start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
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
    // Display in the studio's timezone (LA) so the summary matches what
    // the slot picker showed and what Wendy set in admin. Otherwise an
    // out-of-state viewer would see their own zone here, mismatching
    // the time they just clicked.
    const tz = (state.availability && state.availability.timezone) || "America/Los_Angeles";
    const summary =
      state.package.name +
      " · " +
      start.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: tz,
      }) +
      " · " +
      start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
        timeZoneName: "short",
      });
    document.getElementById("chosenSummary").textContent = summary;

    // Deposit note depends on whether Stripe is configured AND the
    // currently-set deposit percentage (admin-editable). Both come
    // back from /api/config in one call.
    const noteEl = document.getElementById("depositNote");
    fetch("/.netlify/functions/config")
      .then((r) => r.json())
      .then((cfg) => {
        const pct = Number(cfg.depositPercent) || 25;
        const fraction = pct / 100;
        if (cfg.stripeEnabled) {
          noteEl.innerHTML =
            `<strong>Deposit:</strong> a ${pct}% non-refundable retainer ` +
            "($" + Math.round(state.package.price * fraction).toLocaleString() +
            ") will be charged at submit to hold your date. " +
            "The balance is due 24 hours before the session.";
        } else {
          noteEl.innerHTML =
            "<strong>What happens next:</strong> I'll confirm your booking " +
            "by email within 24 hours and send deposit instructions " +
            `(${pct}% non-refundable retainer to hold the date). ` +
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
      // Promo code: server revalidates and rejects with a friendly 400
      // if the code has since expired or been used up. Client-side state
      // is only a preview — the truth lives in the Blobs store.
      promoCode: state.promoCode || null,
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

      // Conflict (409) — somebody booked this slot in the seconds
      // between when this user picked it and when they hit submit.
      // Friendly message + refresh availability + bounce them back
      // to step 2 to pick again.
      if (res.status === 409) {
        alert(
          (result.error || "That slot was just taken.") +
          "\n\nThe times list is being refreshed — please pick another."
        );
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit booking request";
        // Reset slot selection and reload availability for the same package
        state.time = null;
        state.day = null;
        if (state.package) {
          loadAvailability().catch(console.error);
        }
        gotoStep(2);
        return;
      }

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
    const tz = (state.availability && state.availability.timezone) || "America/Los_Angeles";
    document.getElementById("doneSummary").innerHTML =
      `Your <strong>${escapeHtml(data.packageName)}</strong> session is on hold for ` +
      start.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: tz,
      }) +
      " at " +
      start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
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
    else if (action === "back-to-package-from-inquiry") gotoStep(1);
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
  // DISCOVERY CALL — deep-link from the home page bio.
  // index.html has: <a href="book.html#discovery">…</a>
  // When the hash is present on load, open the inquiry form pre-set
  // as a 15-min discovery call rather than waiting for the user to
  // pick a package. Re-uses the same /api/inquiry endpoint that the
  // Lifestyle and Event inquiry forms use — Wendy gets the email
  // tagged as "discovery-call" so she can tell it apart.
  // ----------------------------------------------------------
  const DISCOVERY_CALL_PSEUDO_PACKAGE = {
    id: "discovery-call",
    name: "15-minute discovery call",
    price: null,
    duration: null,
    includes: [],
    description: "",
    inquiry: true,
  };
  function openDiscoveryCallForm() {
    selectPackage(DISCOVERY_CALL_PSEUDO_PACKAGE);
    // selectPackage formats the chosen-package label as "<name> · quote-based"
    // which doesn't fit a free discovery call. Override with cleaner copy.
    const chosen = document.getElementById("inquiryChosenPackage");
    if (chosen) chosen.textContent = "15-minute discovery call · free";
  }

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    await loadPackages();
    renderPackages();
    const form = document.getElementById("bookForm");
    if (form) form.addEventListener("submit", submitBooking);
    // Deep-link: book.html#discovery opens the inquiry form pre-set as
    // a discovery call. Done AFTER renderPackages so the package cards
    // are in place underneath when the user closes the form.
    if (location.hash === "#discovery") openDiscoveryCallForm();
    initPromoField();
  });

  // ----------------------------------------------------------
  // PROMO CODE
  //
  // On page load, if the URL carries ?promo=CODE, drop that into the
  // promo input and remember it in state. Once the user reaches the
  // details form (step 3) we validate it against the server so we can
  // show a discounted price BEFORE they submit. The server also
  // revalidates at submit time — this is UI preview only.
  // ----------------------------------------------------------
  function initPromoField() {
    const params = new URLSearchParams(location.search);
    const preset = (params.get("promo") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (preset) state.promoCode = preset;
    // When the details form is created on package load, wire up handlers.
    const input = document.getElementById("f-promo");
    const btn = document.getElementById("applyPromoBtn");
    if (input && preset) input.value = preset;
    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); applyPromoCode(); });
    if (input) {
      input.addEventListener("blur", () => {
        if ((input.value || "").trim()) applyPromoCode();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); applyPromoCode(); }
      });
    }
    // If a code was pre-populated from the URL, validate lazily — the
    // package price isn't known until the user picks a package. So we
    // just remember it and let goToForm() trigger validation once the
    // price is known. See applyPromoCodeIfPresent() called from goToForm.
  }

  async function applyPromoCode() {
    const input = document.getElementById("f-promo");
    const status = document.getElementById("promoStatus");
    const row = input && input.closest(".book__row");
    if (!input || !status) return;
    const raw = (input.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    input.value = raw; // normalize what the user sees
    if (!raw) {
      state.promoCode = null;
      state.promo = null;
      status.textContent = "";
      status.className = "book__promo-status";
      if (row) row.classList.remove("is-valid");
      updateDepositNote();
      return;
    }
    status.textContent = "Checking…";
    status.className = "book__promo-status";
    try {
      const packagePrice = state.package && state.package.price ? state.package.price : null;
      const res = await fetch("/.netlify/functions/redeem-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: raw, packagePrice }),
      });
      const data = await res.json();
      if (data.valid) {
        state.promoCode = raw;
        state.promo = data;
        status.textContent = data.discountedPrice != null
          ? `${data.percentOff}% off applied — package now $${data.discountedPrice} (was $${data.originalPrice}).`
          : `${data.percentOff}% off applied.`;
        status.className = "book__promo-status is-valid";
        if (row) row.classList.add("is-valid");
      } else {
        state.promoCode = null;
        state.promo = null;
        status.textContent = data.message || "That code isn't valid.";
        status.className = "book__promo-status is-invalid";
        if (row) row.classList.remove("is-valid");
      }
    } catch (err) {
      console.error("[promo] validate failed:", err);
      status.textContent = "Couldn't check that code — try again.";
      status.className = "book__promo-status is-invalid";
    }
    updateDepositNote();
  }

  // If a promo code was pre-loaded from the URL, revalidate it now that
  // the package (and its price) is locked in. Called from goToForm.
  function applyPromoCodeIfPresent() {
    const input = document.getElementById("f-promo");
    if (state.promoCode && input) {
      input.value = state.promoCode;
      applyPromoCode().catch(console.error);
    }
  }

  // Re-render the deposit note with discount math when a promo is
  // applied or cleared. The original note is built by goToForm; this
  // just overlays a "you saved $X" line above it when relevant.
  function updateDepositNote() {
    const note = document.getElementById("depositNote");
    if (!note || !state.package) return;
    // Strip any prior promo overlay and rebuild.
    const existing = note.querySelector(".book__deposit-promo");
    if (existing) existing.remove();
    if (!state.promo || state.promo.discountedPrice == null) return;
    const overlay = document.createElement("div");
    overlay.className = "book__deposit-promo";
    overlay.style.marginBottom = "10px";
    overlay.style.fontWeight = "700";
    overlay.style.color = "#1d5e62";
    overlay.innerHTML =
      `Code <strong>${state.promo && state.promoCode ? state.promoCode : ""}</strong> applied &middot; ` +
      `$${state.promo.originalPrice} → <strong>$${state.promo.discountedPrice}</strong> ` +
      `(you save $${state.promo.discountApplied}).`;
    note.insertBefore(overlay, note.firstChild);
  }

  // Hook applyPromoCodeIfPresent into goToForm without patching that
  // function's original text (avoids fragile Edit). Wrap it.
  const _origGoToForm = goToForm;
  goToForm = function () {
    const r = _origGoToForm.apply(this, arguments);
    // Fire on the next tick so depositNote HTML is in the DOM first.
    setTimeout(() => applyPromoCodeIfPresent(), 0);
    return r;
  };
})();
