// `npm start`: the local /api stand-in plus `ng serve` (which proxies /api
// to it). Extra arguments go to ng serve, e.g. `npm start -- --port 4300`.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startDevApi } from "./dev-api.mjs";

const api = startDevApi();
const ng = spawn(process.execPath, [createRequire(import.meta.url).resolve("@angular/cli/bin/ng.js"), "serve", ...process.argv.slice(2)], {
  stdio: "inherit",
});
ng.on("exit", (code) => {
  api.close();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => ng.kill(signal));
