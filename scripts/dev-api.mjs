// A local stand-in for the /api Azure Function, so `npm start` needs no
// Azure Functions Core Tools: the same handler (api/src/openai.js) behind a
// plain Node HTTP server, reading the Azure OpenAI settings from .env. The
// Angular dev server proxies /api here (proxy.conf.json). Port 7071 is the
// Functions host's default, so `func start` in api/ works as a drop-in.

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { handleChat } from "../api/src/openai.js";

const PORT = 7071;

export function startDevApi() {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/chat") {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {}
    const result = await handleChat(body);
    if (result.status !== 200) console.warn(`[dev-api] ${result.status} ${result.body.error}`);
    res.writeHead(result.status, { "Content-Type": "application/json" }).end(JSON.stringify(result.body));
  });
  server.listen(PORT, () => console.log(`[dev-api] /api/chat on http://localhost:${PORT}`));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startDevApi();
