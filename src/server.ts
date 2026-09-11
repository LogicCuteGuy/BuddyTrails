import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./tools.js";
import { getDb } from "./db.js";

export function createMcpServer(): Server {
  const server = new Server({ name: "buddytrails-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

  // Ensure DB initialized
  getDb();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object" as const, properties: {}, additionalProperties: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
    const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) throw new Error(`Invalid input for ${tool.name}: ${parsed.error.message}`);
    const result = await tool.handler(parsed.data);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}
