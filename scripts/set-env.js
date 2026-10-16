#!/usr/bin/env node
"use strict";

// Generates src/environments/environment.ts — the app's build-time,
// non-secret settings — from .env (or the process environment, as in CI)
// before serve/build. Runs automatically via npm's "prestart"/"prebuild"
// hooks. The Azure OpenAI key is NOT one of them: it stays server-side, in
// the /api function's settings (see api/ and README.md).

const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const envPath = path.join(rootDir, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

// The model deployment's per-minute token limit — the browser paces live
// AI searches to fit it (see src/app/lib/ai-results.ts).
const tokensPerMinute = Number(process.env.AI_TOKENS_PER_MINUTE) || 50000;

const outPath = path.join(rootDir, "src", "environments", "environment.ts");
const content = `// Auto-generated from .env by scripts/set-env.js — do not edit by hand.
export const environment = {
  aiTokensPerMinute: ${JSON.stringify(tokensPerMinute)},
};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content);
