// The one thing the browser can't do itself: call Azure OpenAI with the
// key. Shared by the Azure Function (functions/chat.js), the local dev
// server (scripts/dev-api.mjs) and the Node scripts (scripts/direct-ai.ts),
// so all three send exactly the same request.
//
// Settings (app settings in Azure, .env locally):
//   AZURE_OPENAI_ENDPOINT    https://<resource>.openai.azure.com (from the Foundry resource's "Keys and Endpoint")
//   AZURE_OPENAI_API_KEY     one of that resource's keys
//   AZURE_OPENAI_DEPLOYMENT  the model deployment's name, e.g. gpt-4.1-mini

// The endpoint takes anything a client sends, so it only accepts requests
// shaped like the app's own two calls (see src/app/lib/ai-search.ts): a
// short system prompt, a catalog-sized user message, a small answer.
const MAX_SYSTEM_CHARS = 8_000;
const MAX_USER_CHARS = 30_000;
const MAX_TOKENS = 1_000;

/** The Azure OpenAI settings, or null when any is missing (AI search is then off). */
export function chatConfig(env = process.env) {
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim();
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim();
  if (!endpoint || !apiKey || !deployment) return null;
  // The OpenAI-compatible v1 API: no api-version, the deployment goes in "model".
  const base = endpoint.replace(/\/+$/, "").replace(/\/openai\/v1$/, "");
  return { url: `${base}/openai/v1/chat/completions`, apiKey, deployment };
}

/** A request body from the browser, checked; throws a message for a 400. */
export function parseChatRequest(body) {
  const { system, user, maxTokens } = body ?? {};
  if (typeof system !== "string" || !system || system.length > MAX_SYSTEM_CHARS) throw new Error("Invalid or too long `system`");
  if (typeof user !== "string" || !user || user.length > MAX_USER_CHARS) throw new Error("Invalid or too long `user`");
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS) throw new Error(`\`maxTokens\` must be 1-${MAX_TOKENS}`);
  return { system, user, maxTokens };
}

export class UpstreamError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** One chat completion with a JSON answer; returns the answer's raw JSON text. */
export async function chatCompletion(config, { system, user, maxTokens }) {
  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": config.apiKey },
    body: JSON.stringify({
      model: config.deployment,
      temperature: 0,
      max_tokens: maxTokens,
      // Plain JSON mode, not strict structured outputs: the model sometimes
      // writes a long match list as one object with duplicate keys, which
      // strict mode would reject but the app's parseMatches can recover.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new UpstreamError(res.status, `Azure OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new UpstreamError(502, "Empty response from Azure OpenAI");
  return content;
}

/**
 * The whole /api/chat endpoint, framework-free: request body in, status and
 * JSON body out. 503 = not configured (the app then stops trying), 429 is
 * passed through (the deployment's per-minute limit), any other upstream
 * failure is a 502.
 */
export async function handleChat(body, env = process.env) {
  const config = chatConfig(env);
  if (!config) return { status: 503, body: { error: "not_configured" } };
  let request;
  try {
    request = parseChatRequest(body);
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
  try {
    return { status: 200, body: { content: await chatCompletion(config, request) } };
  } catch (err) {
    const status = err instanceof UpstreamError && err.status === 429 ? 429 : 502;
    return { status, body: { error: err.message } };
  }
}
