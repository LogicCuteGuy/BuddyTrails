import express from "express";
import cors from "cors";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMcpServer } from "../server.js";
import { tools } from "../tools.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Simple JSON-RPC over HTTP for Open WebUI Tools (thin wrapper)
app.post("/tools/:name", async (req, res) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) return res.status(404).json({ error: `Unknown tool: ${req.params.name}` });
  const parsed = tool.inputSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const result = await tool.handler(parsed.data);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/tools", (_req, res) => {
  res.json({ tools: tools.map((t) => ({ name: t.name, description: t.description })) });
});

// SSE transport for MCP
let sseTransport: SSEServerTransport | null = null;
app.get("/sse", async (req, res) => {
  const server = createMcpServer();
  sseTransport = new SSEServerTransport("/messages", res);
  await server.connect(sseTransport);
});
app.post("/messages", async (req, res) => {
  if (sseTransport) await sseTransport.handlePostMessage(req, res);
  else res.status(404).end();
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.error(`BuddyTrails MCP (http) on :${port}`));
