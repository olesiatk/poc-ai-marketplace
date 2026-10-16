// For the Node scripts: there's no /api/chat to talk to, so AI search calls
// Azure OpenAI directly with the settings from .env — through the same
// request code as the Azure Function (api/src/openai.js).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-ignore — plain JS module, shared with the Azure Function.
import { chatCompletion, chatConfig } from "../api/src/openai.js";
import { setChatTransport } from "../src/app/lib/llm-client.ts";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const config = chatConfig();

/** The model deployment's name, or null when the Azure OpenAI settings are missing from .env. */
export const AI_MODEL: string | null = config?.deployment ?? null;

if (config) setChatTransport((request) => chatCompletion(config, request));
