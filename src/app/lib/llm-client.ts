/**
 * The LLM behind AI search: one chat completion with a JSON answer.
 *
 * In the browser it goes through this app's own `/api/chat` endpoint (the
 * Azure Function in `api/`, or `scripts/dev-api.mjs` under `npm start`),
 * which holds the Azure OpenAI key server-side — the key never reaches the
 * bundle. Node scripts swap in a transport that calls Azure OpenAI directly
 * (`scripts/direct-ai.ts`).
 */

export interface ChatRequest {
  system: string;
  user: string;
  /** Reserved against the deployment's per-minute token limit along with the prompt — keep it close to real answer sizes. */
  maxTokens: number;
}

/** Returns the raw JSON text of the model's answer, or throws. */
export type ChatTransport = (request: ChatRequest) => Promise<string>;

/** The server has no Azure OpenAI settings — live AI search is off, not failing. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI search is not configured on the server");
  }
}

const CHAT_URL = "/api/chat";

const viaApi: ChatTransport = async (request) => {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (res.status === 503) throw new AiNotConfiguredError();
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data: { content?: string } = await res.json();
  if (!data.content) throw new Error("Empty response from the AI API");
  return data.content;
};

let transport: ChatTransport = viaApi;

/** For Node scripts, which have no `/api/chat` to talk to. */
export function setChatTransport(next: ChatTransport): void {
  transport = next;
}

export function chatJson(request: ChatRequest): Promise<string> {
  return transport(request);
}
