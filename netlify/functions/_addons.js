// Add-ons — the ledger rows that show under Headshots on /pricing, plus
// any checkbox add-ons that appear on /book (e.g. Hair & makeup).
//
// One shared model with two display modes:
//   - Ledger display: always shown on /pricing.
//   - Bookable checkbox: also shown on /book, added to the total when
//     checked. Only add-ons flagged bookable:true show up here.
//
// Fields per add-on:
//   id           slug — stable id used to look up prices server-side
//   label        display text ("Hair & makeup artist on set")
//   price        numeric dollars — used for booking math and the ledger
//                display when priceDisplay is null
//   priceDisplay optional freeform string that overrides how the price
//                renders on /pricing (e.g. "$250-$750" for a range, or
//                "Included" for a zero-cost item). Booking math still
//                uses the numeric `price` field regardless.
//   bookable     if true, /book renders a checkbox for this add-on and
//                adds `price` to the deposit + total when checked
//   description  optional short blurb shown under the label on /pricing
//   order        integer — controls display order in both places
//
// Storage: single JSON array in the wendypix-config blob, key "addons".
// Same shape as packages so admin.js can borrow patterns.

const { getConfigStore } = require("./_blobs");

const STORE_KEY = "addons";

const DEFAULT_ADDONS = [
  {
    id: "extra-image",
    label: "Additional retouched image",
    price: 45,
    priceDisplay: null,
    bookable: false,
    description: "",
    order: 1,
  },
  {
    id: "extra-half-hour",
    label: "Additional half-hour on set",
    price: 150,
    priceDisplay: null,
    bookable: false,
    description: "",
    order: 2,
  },
  {
    id: "hmua",
    label: "Hair & makeup artist on set",
    price: 200,
    priceDisplay: null,
    // Only add-on currently checkoutable on /book. Flip this off if
    // Wendy wants to stop offering HMUA as a self-serve booking option.
    bookable: true,
    description: "",
    order: 3,
  },
  {
    id: "usage-license",
    label: "Commercial & advertising usage license",
    // priceDisplay overrides — the numeric price is only used if this
    // ever becomes bookable, which for a range price wouldn't make
    // sense (Wendy would negotiate the exact number offline).
    price: 250,
    priceDisplay: "$250–$750",
    bookable: false,
    description: "",
    order: 4,
  },
];

async function listAddons() {
  const store = getConfigStore();
  const stored = await store.get(STORE_KEY, { type: "json" });
  if (!Array.isArray(stored) || !stored.length) return DEFAULT_ADDONS.slice();
  // Sort by `order` (ascending). Missing/invalid orders fall to the end
  // in insertion order.
  return stored.slice().sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
    const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
}

async function saveAddons(list) {
  const store = getConfigStore();
  await store.setJSON(STORE_KEY, list);
}

async function resetAddons() {
  const store = getConfigStore();
  await store.delete(STORE_KEY);
}

// Validate a single addon row from admin PUT. Returns
// { value: <cleaned> } on success, { error: "<msg>" } on failure.
function validateAddon(a) {
  if (!a || typeof a !== "object") return { error: "must be an object" };
  if (!a.id || typeof a.id !== "string") return { error: "id required" };
  if (!/^[a-z0-9-]+$/.test(a.id)) {
    return { error: "id can only contain lowercase letters, digits, and hyphens" };
  }
  if (!a.label || typeof a.label !== "string") return { error: "label required" };
  const price = Number(a.price);
  if (!Number.isFinite(price) || price < 0) return { error: "price must be a non-negative number" };
  const bookable = Boolean(a.bookable);
  const priceDisplay = a.priceDisplay ? String(a.priceDisplay).trim() : null;
  const description = a.description ? String(a.description).trim() : "";
  const order = Number.isFinite(Number(a.order)) ? Number(a.order) : 999;
  return {
    value: {
      id: a.id,
      label: a.label.trim(),
      price,
      priceDisplay,
      bookable,
      description,
      order,
    },
  };
}

module.exports = {
  DEFAULT_ADDONS,
  listAddons,
  saveAddons,
  resetAddons,
  validateAddon,
};
