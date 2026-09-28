import { environment } from "../../environments/environment";
import { ACTIVE_DATASET } from "../datasets/active";
import { localHeuristicSearch, tokenize } from "./search";
import type { AiMode, MatchesMap, Product, ReviewsMap } from "../models/product.model";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const API_KEY = environment.groqApiKey;
// "llama-3.1-8b-instant"/"llama-3.3-70b-versatile" have been retired from
// Groq's catalog — gpt-oss-20b is a currently-available, JSON-mode-capable
// replacement. Verified live against this project's Groq account.
export const MODEL = environment.groqModel || "openai/gpt-oss-20b";

export const isGroqConfigured = Boolean(API_KEY);

// The catalog is 1000+ products — sent in full, that's hundreds of
// thousands of tokens, well past typical free/on-demand Groq rate limits
// (this project's account: 8K TPM), regardless of model. So instead of sending everything,
// pre-rank with the local heuristic (keyword + synonym expansion) and
// send only the top candidates — a standard retrieve-then-rerank split:
// cheap local retrieval narrows the field, the LLM does the expensive
// semantic judgment only on a pool small enough to fit the budget.
// Sized so the request stays under the 8K TPM limit with room to spare —
// Groq counts the prompt PLUS the full max_tokens reservation against it,
// so prompt (~4.2K tokens at 20 candidates) + max_tokens must stay well under 8K.
const MAX_CANDIDATES = 20;

/**
 * Picks up to MAX_CANDIDATES products to send to the LLM: local-heuristic
 * matches first (best score first), padded with further catalog products
 * (in their original order) if the heuristic found fewer than that — so
 * the model still gets a full-size, if not perfectly pre-filtered, pool
 * to reason over rather than an arbitrarily short list.
 */
function selectCandidates(query: string, products: Product[], reviews: ReviewsMap): Product[] {
  const localMatches = localHeuristicSearch(query, products, reviews);
  const rankedIds = [...localMatches.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([id]) => id);

  const byId = new Map(products.map((p) => [p.id, p]));
  const ranked = rankedIds.map((id) => byId.get(id)!).filter(Boolean);
  if (ranked.length >= MAX_CANDIDATES) return ranked.slice(0, MAX_CANDIDATES);

  const rankedIdSet = new Set(rankedIds);
  const filler = products.filter((p) => !rankedIdSet.has(p.id));
  return [...ranked, ...filler].slice(0, MAX_CANDIDATES);
}

// Per-product text budget for what's sent to Groq. Titles, descriptions and
// reviews in these catalogs run to hundreds or thousands of characters
// each, so even 20 candidates would blow the token budget if sent whole —
// these caps keep one entry at roughly 150 tokens.
const MAX_TITLE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 160;
const MAX_FEATURES = 2;
const MAX_FEATURE_CHARS = 80;
const MAX_REVIEWS = 2;
const MAX_REVIEW_CHARS = 100;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

interface CatalogEntry {
  id: string;
  title: string;
  category: string;
  brand: string;
  price: number;
  features: string[];
  description: string;
  reviews: string[];
}

function buildCatalog(products: Product[], reviews: ReviewsMap): CatalogEntry[] {
  return products.map((p) => ({
    id: p.id,
    title: truncate(p.title, MAX_TITLE_CHARS),
    category: p.category,
    brand: p.store,
    price: p.price,
    features: p.features.slice(0, MAX_FEATURES).map((f) => truncate(f, MAX_FEATURE_CHARS)),
    description: truncate(p.description, MAX_DESCRIPTION_CHARS),
    reviews: (reviews[p.id] || [])
      .slice(0, MAX_REVIEWS)
      .map((r) => truncate(`${r.title}. ${r.text}`, MAX_REVIEW_CHARS)),
  }));
}

const { domain, promptExamples } = ACTIVE_DATASET;

const SYSTEM_PROMPT = `You are a semantic search engine for a ${domain}.
You are given a user's query (typed or transcribed from speech) and a product catalog in JSON format.

Your job: find products that are semantically relevant to the query — not only products that contain its exact words. To do that, expand the query in your head before matching, considering:
1. Core concepts and their lexical synonyms — e.g. ${promptExamples.synonyms}.
2. Contextual, multi-word phrases that express the same idea in a product's own words — e.g. ${promptExamples.phrases}.
3. Related attributes implied by the query, even if unstated — product types, ingredients, usage scenarios and who it's for (e.g. ${promptExamples.implied}).
4. Price: each product has a "price" in USD. If the query mentions a budget ("under $20", "cheap"), prefer products that fit it.

Analyze the product's title, category, brand, features, description, AND customer reviews — the query's intent may match not only the listed attributes but also what customers wrote in their reviews.

Return ONLY valid JSON (no explanations, no markdown) in this exact shape:
{"matches": [{"id": "<product id>", "score": <0-100 relevance>, "keywords": ["<word-or-phrase-1>", "<word-or-phrase-2>"]}]}
Rules:
- "keywords" must be words or short phrases that appear VERBATIM in that product's title, features, description, or reviews, and that justify why it's relevant — including synonyms and contextual phrases you matched, not only the user's literal query words. 2-6 keywords per product.
- Only include genuinely relevant products (not the whole catalog), sorted by descending score.
- If no product satisfies every part of the query, still return the closest matches with lower scores (e.g. 30-60) rather than an empty list — but never a product that directly contradicts the query (e.g. a scented product for "without fragrance").
- If nothing is relevant, return {"matches": []}.
- Never invent products or ids that aren't in the catalog.`;

interface RawMatch {
  id?: string;
  score?: number;
  keywords?: unknown;
}

export interface AiSearchResult {
  matches: MatchesMap;
  mode: AiMode;
  error?: string;
}

/**
 * Runs AI-powered relevance search via Groq. Falls back to a
 * local client-side keyword heuristic if no API key is configured or the
 * request fails for any reason, so the UI always stays functional.
 */
export async function aiSearch(query: string, products: Product[], reviews: ReviewsMap): Promise<AiSearchResult> {
  if (!isGroqConfigured) {
    return { matches: localHeuristicSearch(query, products, reviews), mode: "local" };
  }

  try {
    const candidates = selectCandidates(query, products, reviews);
    const catalog = buildCatalog(candidates, reviews);
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        // Room for gpt-oss's reasoning plus the JSON answer. At low reasoning
        // effort (below) answers run ~150–250 tokens; the headroom is for the
        // occasional longer one.
        max_tokens: 2000,
        // gpt-oss models reason before answering; at the default effort that
        // reasoning sometimes eats the whole budget and Groq rejects the
        // cut-off answer ("json_validate_failed"). Ranking 20 candidates
        // doesn't need deep reasoning. Other models don't accept the param.
        ...(MODEL.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({ query, catalog }),
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Groq API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const content: string | undefined = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq");

    const parsed = JSON.parse(content);
    const rawMatches: RawMatch[] = Array.isArray(parsed.matches) ? parsed.matches : [];

    const validIds = new Set(candidates.map((p) => p.id));
    const queryTokens = new Set(tokenize(query));
    const matches: MatchesMap = new Map();
    rawMatches.forEach((m) => {
      if (!m?.id || !validIds.has(m.id)) return;
      const keywords = Array.isArray(m.keywords) ? m.keywords : [];
      const cleanedKeywords = keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean);

      // The model isn't asked to tag each keyword, so classify post-hoc:
      // a keyword identical to a literal query word is an exact match
      // (highlighted yellow); anything else — a synonym or contextual
      // phrase the model matched — is highlighted light green.
      const directTerms = new Set<string>();
      const synonymTerms = new Set<string>();
      cleanedKeywords.forEach((k) => (queryTokens.has(k) ? directTerms : synonymTerms).add(k));

      // Always keep at least the raw query tokens so highlighting has something
      // to work with even if the model returned no keywords for this item.
      if (!directTerms.size && !synonymTerms.size) queryTokens.forEach((t) => directTerms.add(t));

      matches.set(m.id, { score: Number(m.score) || 0, directTerms, synonymTerms });
    });

    return { matches, mode: "groq" };
  } catch (err) {
    console.error("Groq AI search failed, falling back to local heuristic:", err);
    return {
      matches: localHeuristicSearch(query, products, reviews),
      mode: "local",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
