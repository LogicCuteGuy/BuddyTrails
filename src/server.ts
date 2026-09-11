import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./tools.js";
import { getDb } from "./db.js";
import { requestContext } from "./context.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function createMcpServer(): Server {
  const server = new Server({ name: "buddytrails-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
  getDb();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => {
      let jsonSchema: any = { type: "object", properties: {}, additionalProperties: true };
      try {
        const { zodToJsonSchema } = require("zod-to-json-schema");
        jsonSchema = zodToJsonSchema(t.inputSchema, { target: "jsonSchema7" });
      } catch {}
      return { name: t.name, description: t.description, inputSchema: jsonSchema };
    }),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
    const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) throw new Error(`Invalid input for ${tool.name}: ${parsed.error.message}`);
    // If called via HTTP, userId is in AsyncLocalStorage; for stdio, use BUDDYTRAILS_USER_ID env or "local"
    const ctx = requestContext.getStore();
    const fallbackUserId = (process.env.BUDDYTRAILS_USER_ID || "").trim() || "local";
    const result = ctx ? await tool.handler(parsed.data) : await requestContext.run({ userId: fallbackUserId }, () => tool.handler(parsed.data));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
  return server;
}
