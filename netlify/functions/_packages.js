// Default package definitions — used when the config blob is empty
// (first deploy, or if Wendy hasn't customized anything yet). The
// admin's "Reset to defaults" button writes these back.
//
// Single source of truth; both the public packages.js endpoint and the
// admin write path import from here.

const DEFAULT_PACKAGES = [
  {
    id: "headshot-essential",
    name: "Essential Headshot",
    price: 600,
    duration: 60,
    description: "Quick, polished, ready for your roster.",
    includes: [
      "1-hour session",
      "Up to 2 looks",
      "3 retouched final images",
    ],
    featured: false,
    inquiry: false,
  },
  {
    id: "headshot-standard",
    name: "Standard Headshot",
    price: 850,
    duration: 90,
    description: "Most popular — actor & exec sweet spot.",
    includes: [
      "1.5-hour session",
      "Up to 4 looks",
      "6 retouched final images",
    ],
    featured: true,
    inquiry: false,
  },
  {
    id: "headshot-premium",
    name: "Premium Headshot",
    price: 1400,
    duration: 120,
    description: "Full-service — looks, retouching, glam.",
    includes: [
      "2-hour session",
      "Unlimited looks",
      "10 retouched final images",
      "Hair & makeup included",
    ],
    featured: false,
    inquiry: false,
  },
  {
    id: "lifestyle-inquiry",
    name: "Lifestyle / Commercial",
    price: null,
    duration: null,
    description: "Quote-based — let's scope it on a 15-min call.",
    includes: ["Brand portraits", "Editorial / on-location", "Commercial usage"],
    featured: false,
    inquiry: true,
  },
  {
    id: "event-inquiry",
    name: "Event Coverage",
    price: null,
    duration: null,
    description: "Hourly — pick a duration on the call.",
    includes: [
      "Hourly, 2-hour minimum",
      "Galleries in 7 business days",
      "Same-day previews available",
    ],
    featured: false,
    inquiry: true,
  },
];

module.exports = { DEFAULT_PACKAGES };
