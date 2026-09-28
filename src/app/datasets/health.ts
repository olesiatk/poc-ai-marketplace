import type { DatasetConfig } from "./dataset.model";

/**
 * Amazon Reviews 2023 "Health & Personal Care" catalog — a one-off extract from the raw
 * dump, in public/data/health-*.json.
 *
 * Concept groups were picked from terms that actually recur across this
 * catalog's product text and reviews — an expansion term can only ever
 * match text that contains it verbatim.
 */
export const HEALTH_DATASET: DatasetConfig = {
  productsUrl: "data/health-products.json",
  reviewsUrl: "data/health-reviews.json",
  aiSnapshotsUrl: "data/health-ai-snapshots.json",

  domain: "health and personal care marketplace",
  promptExamples: {
    synonyms: '"pain relief" also means "aches", "soreness", "sore muscles"',
    phrases: '"for sleep" can also read as "fall asleep", "relaxation", "restful night"',
    implied:
      '"something for my knee after surgery" implies a knee brace, a support sleeve or an ice pack; "for my elderly mother" implies mobility aids, pill organizers or easy-to-use monitors',
  },

  conceptGroups: [
    ["pain relief", "pain", "aches", "sore muscles", "soreness", "relieve pain"],
    ["sleep", "fall asleep", "relaxation", "restful", "insomnia"],
    ["immune", "immunity", "immune support", "cold and flu"],
    ["joint", "joints", "arthritis", "mobility", "stiff"],
    ["back pain", "lower back", "posture", "spine"],
    ["energy", "fatigue", "tired", "stamina"],
    ["digestion", "digestive", "gut", "bloating", "stomach"],
    ["elderly", "seniors", "senior"],
    ["comfortable", "comfort", "comfy", "cushioned"],
    ["gentle", "sensitive skin", "mild", "soothing", "hypoallergenic"],
    ["organic", "plant-based", "vegan", "non-gmo"],
    ["portable", "travel", "compact", "lightweight", "on the go"],
    ["affordable", "cheap", "inexpensive", "great price", "good value"],
    ["durable", "sturdy", "well made", "high quality"],
    ["easy to use", "easy to apply", "simple to use", "user-friendly"],
    ["kids", "children", "toddler", "baby"],
    ["accurate", "precise", "reliable"],
    ["stress", "anxiety", "calm", "calming", "relax"],
  ],

  presetQueries: [
    { query: "knee brace for joint pain", label: "Synonyms" },
    { query: "something to help me fall asleep", label: "Intent" },
    { query: "pain relief without pills", label: "Negation" },
    { query: "massager under $40", label: "Budget" },
    { query: "blood pressure monitor for seniors", label: "For whom" },
  ],
  searchPlaceholder: 'e.g. "a heating pad for lower back pain"',
  demoQuery: "knee brace for joint pain",
};
