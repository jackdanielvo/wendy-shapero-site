// Rates — the ledgers for Lifestyle & Commercial (section 02), Events
// (03), and Travel (04) on /pricing. These sections don't feed booking
// math (the /book flow uses packages + add-ons only), so we deliberately
// use a simpler model: freeform priceText strings instead of a numeric
// price + display override. That lets Wendy write anything ("$350 / hr",
// "$4,800+", "Included", "Cost + 10%") without wrestling with a numeric
// field she doesn't need.
//
// Storage: single JSON blob in wendypix-config, key "rates". Shape:
//   { lifestyle: Row[], events: Row[], travel: Row[] }
// Row shape:
//   { id: "unique-slug", label: "…", priceText: "…" }
//
// If the blob is missing or malformed for any section, that section
// falls back to defaults independently — so partial data never wipes
// the page.

const { getConfigStore } = require("./_blobs");

const STORE_KEY = "rates";
const SECTIONS = ["lifestyle", "events", "travel"];

const DEFAULT_RATES = {
  lifestyle: [
    { id: "lif-solo",     label: "2-hour solo / brand portrait",  priceText: "$1,500" },
    { id: "lif-halfday",  label: "Half-day (4 hours) lifestyle",  priceText: "$2,800" },
    { id: "lif-fullday",  label: "Full day (8 hours) commercial", priceText: "$4,800+" },
  ],
  events: [
    { id: "evt-std",      label: "Standard event coverage",             priceText: "$350 / hr" },
    { id: "evt-corp",     label: "Corporate, conference, fundraiser",   priceText: "$400 / hr" },
    { id: "evt-halfday",  label: "Half-day (4 hrs · with assistant)",   priceText: "$1,800" },
    { id: "evt-fullday",  label: "Full day (8 hrs · with assistant)",   priceText: "$3,800" },
  ],
  travel: [
    { id: "trv-local",       label: "Within 30 miles of Los Angeles",                priceText: "Included" },
    { id: "trv-mile",        label: "Beyond 30 miles",                               priceText: "$0.85 / mile" },
    { id: "trv-time",        label: "Travel time on round-trips over 90 minutes",    priceText: "$175 / hr" },
    { id: "trv-outofstate",  label: "Out-of-state shoots",                           priceText: "Cost + 10%" },
  ],
};

async function listRates() {
  const store = getConfigStore();
  const stored = await store.get(STORE_KEY, { type: "json" });
  const out = {};
  for (const key of SECTIONS) {
    const arr = stored && Array.isArray(stored[key]) ? stored[key] : null;
    out[key] = arr && arr.length ? arr : DEFAULT_RATES[key].slice();
  }
  return out;
}

async function saveRates(rates) {
  const store = getConfigStore();
  await store.setJSON(STORE_KEY, rates);
}

async function resetRates() {
  const store = getConfigStore();
  await store.delete(STORE_KEY);
}

// Validate a single row. Returns { value } on success, { error } on fail.
function validateRow(r) {
  if (!r || typeof r !== "object") return { error: "must be an object" };
  if (!r.label || typeof r.label !== "string") return { error: "label required" };
  const priceText = String(r.priceText || "").trim();
  if (!priceText) return { error: "priceText required" };
  // id is optional — server will regenerate if missing. Kept if valid.
  let id = String(r.id || "").trim();
  if (id && !/^[a-z0-9-]+$/.test(id)) id = "";
  return {
    value: {
      id: id || "row-" + Math.random().toString(36).slice(2, 9),
      label: r.label.trim(),
      priceText,
    },
  };
}

module.exports = {
  DEFAULT_RATES,
  SECTIONS,
  listRates,
  saveRates,
  resetRates,
  validateRow,
};
