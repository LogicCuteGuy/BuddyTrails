import "dotenv/config";
import express from "express";
import cors from "cors";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../server.js";
import { tools } from "../tools.js";
import { extractUserIdFromHeaders, requestContext } from "../context.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const app = express();
app.use(cors());
app.use(express.json());

// Extract Open WebUI user from Custom Headers ({{USER_ID}}, {{USER_EMAIL}} etc.)
// Open WebUI Custom Headers docs: https://docs.openwebui.com/features/extensibility/mcp/#custom-headers
// Admin sets e.g. X-User-Id: {{USER_ID}} or X-User-Id: {{USER_EMAIL}} in the MCP connection's Headers JSON.
// We accept X-User-Id, X-OpenWebUI-User, X-OpenWebUI-User-Email, X-User-Email, X-User.
app.use((req, _res, next) => {
  const userId = extractUserIdFromHeaders(req.headers as any, (req.body as any)?.user_id);
  // Store for downstream handlers; MCP handlers also use AsyncLocalStorage
  (req as any).userId = userId;
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.post("/tools/:name", async (req, res) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) return res.status(404).json({ error: `Unknown tool: ${req.params.name}` });
  const parsed = tool.inputSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const userId = (req as any).userId as string;
  try {
    const result = await requestContext.run({ userId }, () => tool.handler(parsed.data));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/tools", (_req, res) => {
  res.json({ tools: tools.map((t) => ({ name: t.name, description: t.description })) });
});

// Streamable HTTP (Open WebUI native, recommended) — https://docs.openwebui.com/features/extensibility/mcp/
async function handleMcp(req: express.Request, res: express.Response) {
  const userId = extractUserIdFromHeaders(req.headers as any, (req.query as any)?.user_id);
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await requestContext.run({ userId }, () => transport.handleRequest(req, res, req.body));
}
app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);

// SSE transport for MCP — per-session map to avoid race (legacy, keep for compat)
const sseTransports = new Map<string, SSEServerTransport>();
app.get("/sse", async (req, res) => {
  const userId = extractUserIdFromHeaders(req.headers as any, (req.query as any)?.user_id);
  const server = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);
  sseTransports.set(transport.sessionId, transport);
  // stash userId on transport for CallTool handler via AsyncLocalStorage
  (transport as any)._userId = userId;
  res.on("close", () => sseTransports.delete(transport.sessionId));
  await server.connect(transport);
});
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sessionId ? sseTransports.get(sessionId) : [...sseTransports.values()][0];
  if (transport) {
    const headerUser = extractUserIdFromHeaders(req.headers as any);
    const userId = headerUser !== "anonymous" ? headerUser : (transport as any)._userId ?? "anonymous";
    await requestContext.run({ userId }, () => transport.handlePostMessage(req, res, req.body));
  } else res.status(404).end();
});

function getOpenApiSpec(req?: express.Request) {
  const host = req ? `${req.protocol}://${req.get("host")}` : `http://localhost:${process.env.PORT || 3000}`;
  const paths: any = {};
  for (const t of tools) {
    let schema: any = { type: "object", properties: {} };
    try {
      const { zodToJsonSchema } = require("zod-to-json-schema");
      schema = zodToJsonSchema(t.inputSchema, { target: "openApi3" });
      if (schema.$schema) delete schema.$schema;
      if (schema.type !== "object") schema = { type: "object", properties: {} };
    } catch {}
    const path = `/tools/${t.name}`;
    paths[path] = {
      post: {
        operationId: t.name,
        summary: t.description,
        description: t.description,
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema,
            },
          },
        },
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
          "400": { description: "Invalid input" },
          "500": { description: "Server error" },
        },
      },
    };
  }
  paths["/health"] = {
    get: {
      operationId: "health",
      summary: "Health check",
      responses: { "200": { description: "OK" } },
    },
  };
  paths["/tools"] = {
    get: {
      operationId: "listTools",
      summary: "List tools",
      responses: { "200": { description: "OK" } },
    },
  };
  return {
    openapi: "3.0.0",
    info: {
      title: "BuddyTrails MCP",
      version: "0.1.0",
      description: "BuddyTrails MCP — Knowledge Hook DB, Have-Idea, Work Task. Single SQLite file. Use X-User-Id header for per-user isolation (Knowledge shared, Ideas/Tasks private).",
    },
    servers: [{ url: host }],
    paths,
  };
}

app.get("/openapi.json", (req, res) => {
  res.json(getOpenApiSpec(req));
});
app.get("/openapi.yaml", (req, res) => {
  res.type("text/yaml").send(JSON.stringify(getOpenApiSpec(req), null, 2));
});
// Open WebUI fetches the URL you enter — if you enter http://host:port, it expects OpenAPI JSON there too
app.get("/", (req, res) => {
  const accept = req.headers.accept || "";
  if (accept.includes("text/html")) {
    res.type("html").send(`<!doctype html><html><head><title>BuddyTrails MCP</title></head><body><h1>BuddyTrails MCP</h1><p>OpenAPI spec at <a href="/openapi.json">/openapi.json</a></p><p>Health at <a href="/health">/health</a></p><p>MCP at <code>POST /mcp</code></p></body></html>`);
  } else {
    res.json(getOpenApiSpec(req));
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.error(`BuddyTrails MCP (http) on :${port}`));
