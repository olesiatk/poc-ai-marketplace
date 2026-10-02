import type { DatasetConfig } from "./dataset.model";

/**
 * Amazon Reviews 2023 "All Beauty" catalog — a one-off extract from the raw
 * dump, in public/data/beauty-*.json.
 *
 * Concept groups were picked from terms that actually recur across this
 * catalog's product text and reviews (each term below appears in at least
 * a handful of products) — an expansion term can only ever match text
 * that contains it verbatim.
 */
export const BEAUTY_DATASET: DatasetConfig = {
  productsUrl: "data/beauty-products.json",
  reviewsUrl: "data/beauty-reviews.json",
  aiSnapshotsUrl: "data/beauty-ai-snapshots.json",

  domain: "beauty and personal care marketplace",
  promptExamples: {
    synonyms: '"moisturizing" also means "hydrating", "nourishing", "moisturizer"',
    phrases: '"moisturizing" can also read as "for dry skin", "soft skin", "locks in moisture"',
    implied:
      '"something for frizzy hair" implies a conditioner, a hair oil or a smoothing serum; "a gift for my wife" implies a gift set, a fragrance or a skincare kit',
  },

  conceptGroups: [
    ["moisturizing", "hydrating", "nourishing", "moisturizer", "hydration", "hydrates", "dry skin", "soft skin"],
    ["gentle", "sensitive skin", "mild", "soothing", "non-irritating", "hypoallergenic", "calming"],
    ["organic", "plant-based", "vegan", "paraben-free", "cruelty-free", "chemical-free"],
    ["anti-aging", "anti-wrinkle", "wrinkles", "fine lines", "firming", "youthful"],
    ["acne", "breakouts", "pimples", "zits", "blemishes", "clear skin", "oily skin"],
    ["long-lasting", "long lasting", "all day", "waterproof", "smudge-proof", "stays on"],
    ["scent", "smell", "fragrance", "aroma", "smells good", "smells amazing"],
    ["unscented", "fragrance-free", "no scent"],
    ["cologne", "perfume", "eau de toilette", "eau de parfum", "men's fragrance"],
    ["shine", "shiny", "glossy", "lustrous", "healthy hair"],
    ["frizz", "frizzy", "anti-frizz", "smooth hair", "sleek"],
    ["curly", "curls", "wavy", "waves", "coils"],
    ["volume", "volumizing", "thicker", "fuller", "thick hair"],
    ["thinning hair", "thinning", "thin hair", "hair loss", "hair growth", "regrowth", "thickening"],
    ["damaged hair", "split ends", "breakage", "repair", "strengthening"],
    ["travel", "travel size", "portable", "compact", "on the go"],
    ["affordable", "cheap", "inexpensive", "great price", "worth the money", "good value"],
    ["gift", "gift set", "holiday gift"],
    ["easy to use", "easy to apply", "simple to use"],
    ["kids", "children", "toddler", "baby"],
    ["for men", "husband", "beard"],
    ["glow", "radiant", "brightening", "luminous", "dewy"],
    ["sunscreen", "spf", "sun protection", "uv protection"],
    ["professional", "salon", "salon-quality", "salon quality"],
    ["durable", "sturdy", "well made", "high quality"],
  ],

  presetQueries: [
    // Checked against this catalog before picking. The first few are wording
    // the catalog itself barely uses ("honeymoon", "sunkissed", "hangnails",
    // "rosacea" — 0-5 keyword hits), so AI finds more products than keyword
    // search does. The rest have a visibly wrong answer on the keyword side
    // (perfumes for "without fragrance", red clay for "red lipstick", SPF 4
    // tanning oil for "SPF 30+") — and two carry a price the slider picks up.
    // The last leans on customer reviews ("gave it to my mom for her birthday,
    // she loved it") more than on product descriptions.
    { query: "honeymoon getaway", label: "Occasion" },
    { query: "sunkissed", label: "Glow" },
    { query: "hangnails", label: "Problem" },
    { query: "rosacea", label: "Skin concern" },
    { query: "shampoo without fragrance", label: "Negation" },
    { query: "red lipstick", label: "Color" },
    { query: "sunscreen SPF 30+ under $15", label: "Numbers" },
    { query: "cologne for men under $20", label: "Budget" },
    { query: "my hair gets frizzy in humid weather", label: "Intent" },
    { query: "birthday gift my mom will love", label: "Reviews" },
  ],
  searchPlaceholder: 'e.g. "a hydrating serum for dry skin"',
  demoQuery: "red lipstick",
};
