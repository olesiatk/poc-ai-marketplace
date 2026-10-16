# POC: Marketplace Search

A proof of concept of AI-powered product search for a marketplace. A shopper describes what they need in plain words, by typing or by voice ("something gentle for a sensitive scalp", "a gift for my brother under $20"), and the app shows two searches side by side over the same catalog:

- **Keyword search** (left): an honest baseline. It matches word stems over titles, features, descriptions and reviews, the way most store searches work.
- **AI search** (right): an LLM (Azure OpenAI) reads the query for its meaning, picks candidates with local retrieval plus vector search, and reranks them. Its results show which products keyword search missed and which keyword hits it filtered out.

A query can also set filters by itself: a price ("under $25") moves the price slider, and "skin care category" or "lotion form" select those filters.

The app is built to be embedded in a host page's `<iframe>`, with a small postMessage bridge for resizing, the guided tour and modals. On its own it also works as a standalone page.

## Stack

- Angular 22 (standalone components, zoneless, signals), Tailwind CSS 4
- Azure OpenAI (`gpt-4.1-mini` by default), called only from the server side
- transformers.js (`all-MiniLM-L6-v2`) for in-browser vector search
- Azure Static Web Apps hosting (static site plus a managed Azure Function at `/api`)
- GitLab CI/CD

## How it works

```
Browser (Angular)                        Azure Static Web App
 ├─ keyword search (local)                ├─ static site (dist/…/browser)
 ├─ vector search (transformers.js)       └─ /api/chat (Azure Function, api/)
 └─ AI search ── POST /api/chat ───────────────▶ Azure OpenAI (key stays here)
```

An AI search makes two small LLM calls:

1. **Plan**: which categories to look in and which words a fitting product would use.
2. **Rerank**: the model judges at most 32 candidates, chosen locally by keyword and vector search.

Together the two calls use about 4.5K tokens. Sending the whole catalog would take hundreds of thousands. If the AI is unavailable or not configured, the AI column falls back to local synonym search, so the app always works.

The example queries under the search box (the presets) are served from recorded real AI runs (`public/data/<catalog>-ai-snapshots.json`). The page loads instantly, every visitor sees the same results, and the LLM isn't called for them.

## Getting started

Requirements: Node 22+ and npm.

```bash
npm install
cp .env.example .env   # fill in the Azure OpenAI settings (optional, see below)
npm start              # http://localhost:4200
```

`npm start` runs the Angular dev server together with a local stand-in for the `/api` function (`scripts/dev-api.mjs`, port 7071), and the dev server proxies `/api` to it. You don't need the Azure Functions Core Tools. If you prefer them, `func start` in `api/` uses the same port.

Without the Azure OpenAI settings in `.env`, everything still runs: presets show their recorded AI results, and other queries use local synonym search.

### Settings (`.env`)

| Variable | Where it's used | |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | `/api` and scripts | The Foundry resource's endpoint, e.g. `https://poc-marketplace-search-openai.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | `/api` and scripts | One of that resource's keys. **Secret: never goes into the frontend build.** |
| `AZURE_OPENAI_DEPLOYMENT` | `/api` and scripts | The model deployment's name, e.g. `gpt-4.1-mini` |
| `AI_TOKENS_PER_MINUTE` | frontend build | The deployment's tokens-per-minute limit. The browser paces live searches to fit it (default 50000). |

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev server plus local `/api` |
| `npm run build` | Production build into `dist/poc-marketplace-search/browser` |
| `npm test` | Unit tests (Vitest) |
| `npm run eval:search` | Retrieval-accuracy regression check for the search over the Beauty catalog |
| `npm run record:ai -- <beauty\|health> [--all]` | Records real AI results for the preset queries (needs the Azure settings) |
| `npm run report:presets -- <beauty\|health> [--detail \| --screen "q" … \| --try "q" …]` | Scores how well each preset query shows off AI search |
| `npm run embed:catalog -- <beauty\|health>` | Rebuilds the catalog's embeddings for vector search |

The presets were recorded during development with a different model. Re-record them once the Azure deployment is in place: `npm run record:ai -- beauty --all`.

## Catalogs

The app shows one catalog per build, chosen in `src/app/datasets/active.ts` (currently Beauty; Health is also included). Everything catalog-specific lives in that catalog's config (`src/app/datasets/beauty.ts`, `health.ts`): data files, prompt wording, synonyms, preset queries and the tour's demo query.

### Data source

The product and review data is a one-off extract from the **Amazon Reviews 2023** dataset (McAuley Lab, UC San Diego; "All Beauty" and "Health & Personal Care" categories): https://amazon-reviews-2023.github.io/. The dataset is published for research purposes; it's used here only for this internal demo. The categories are our own; the raw data has none.

## Deployment (Azure + GitLab CI)

Azure resources go in the `poc-marketplace-search-rg` resource group and are named `poc-marketplace-search-<resource>`:

1. **Azure AI Foundry resource**, e.g. `poc-marketplace-search-openai`. Deploy the model there (`gpt-4.1-mini`, Global Standard) and note the deployment name, its tokens-per-minute limit, and the resource's endpoint and key (Keys and Endpoint).
2. **Static Web App** `poc-marketplace-search-frontend` (Free plan; deployment source "Other").
   - Under *Settings > Environment variables*, add `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_DEPLOYMENT`. The `/api` function reads them.
   - Copy the deployment token (*Overview > Manage deployment token*).
3. **GitLab** (*Settings > CI/CD > Variables*): add `SWA_DEPLOYMENT_TOKEN` (masked, protected), and optionally `AI_TOKENS_PER_MINUTE`.

`.gitlab-ci.yml` runs the tests, the search eval and a build on every push. On the default branch it builds the site and deploys it together with `api/` through the Static Web Apps CLI. The API runtime (Node 22) is set in `public/staticwebapp.config.json`.

## Project layout

```
api/                    Azure Function for /api/chat (holds the Azure OpenAI key)
public/data/            catalogs, reviews, embeddings, recorded AI runs
scripts/                dev API, env generation, recording/eval/report tools
src/app/
  components/           UI (hero, filters, comparison, product tiles, modal)
  datasets/             per-catalog configuration
  lib/                  search, AI pipeline, filters, tour, iframe bridge
```

`CLAUDE.md` has the detailed design notes and conventions.
