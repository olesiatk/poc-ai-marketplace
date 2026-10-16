import { app } from "@azure/functions";
import { handleChat } from "../openai.js";

// POST /api/chat — served by Azure Static Web Apps as its managed API, on
// the same origin as the site (so no CORS). See ../openai.js.
app.http("chat", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const body = await request.json().catch(() => null);
    const result = await handleChat(body);
    if (result.status >= 500 && result.status !== 503) context.error(result.body.error);
    return { status: result.status, jsonBody: result.body };
  },
});
