# BuddyTrails MCP

Single local MCP server with three namespaces — **Knowledge Hook DB**, **Have-Idea**, and **Work Task** — serving GitHub Copilot (`stdio`), Open WebUI (`HTTP/SSE`), and a Discord bot from one SQLite file.

## Features

- **Knowledge Hook DB** — auto-hooks every user↔AI turn, digests on write (embedding + summary + tags), stores raw + vector for semantic search
- **Have-Idea** — lightweight idea capture with semantic `suggest` when stuck
- **Work Task** — daily tasks with 3★ priority, deadline, estimate; Raw Task Data two-step enrichment (paste titles → assign priority/estimate); time-blocked Work Schedule + Suggest Next
- **Auto-skills** — `knowledge.summarize`/`export`/`retag`, `idea.brainstorm`/`cluster`/`refine`, `task.breakdown`/`pomodoro`/`time_log`, `brief.daily`/`weekly`, `search.all` — all via function-calling (slash aliases remain)
- **Discord bot** — `DISCORD_TOKEN`, `/buddytrails-setup`, `/buddytrails-link`, hourly 3★ DM per linked user, `remind`/`due_soon`
- **Multi-account** — Open WebUI Custom Headers (`X-User-Id: {{USER_ID}}`/`{{USER_EMAIL}}`), Knowledge shared, Ideas/Tasks private per user, `stdio` = `local`

## Requirements

- Node.js 22+ (uses `node:sqlite` built-in)
- No native build tools needed

## Install

```bash
npm install
npm run build
```

## Usage

### Stdio (GitHub Copilot)

Add to your MCP config (e.g. VS Code `mcp.json`):

```json
{
  "servers": {
    "buddytrails": {
      "command": "node",
      "args": ["dist/transports/stdio.js"],
      "env": { "BUDDYTRAILS_DB": "./buddytrails.db" }
    }
  }
}
```

### HTTP/SSE (Open WebUI)

```bash
npm run start:http
# or dev: npm run dev:http
```

- `GET /health` — health check
- `GET /tools` — list tools
- `POST /tools/:name` — call a tool (JSON body = tool input)
- `POST /mcp` — MCP Streamable HTTP (recommended, Open WebUI native)
- `GET /sse` + `POST /messages?sessionId=...` — MCP SSE (legacy)
- `PORT` env (default `3000`), `BUDDYTRAILS_DB` env (default `./buddytrails.db`)

Open WebUI: Settings → Admin → Integrations → External Tool Servers → Type **MCP (Streamable HTTP)** → URL `http://host.docker.internal:3000/mcp` (or `http://localhost:3000/mcp` if not in Docker) → Headers `{"X-User-Id": "{{USER_ID}}"} ` or `{"X-User-Id": "{{USER_EMAIL}}"}` (see https://docs.openwebui.com/features/extensibility/mcp/#custom-headers). Add a **Today** button calling `task.get_today_schedule`. Knowledge is shared; Ideas/Tasks are isolated per `X-User-Id`. Copilot `stdio` uses `user_id = "local"`.

### Discord Bot

```bash
DISCORD_TOKEN=... node dist/discord/bot.js
```

- `/buddytrails-setup` in any guild text channel to save that guild/channel (stored in `discord_settings`).
- `/buddytrails-link <openwebui_user>` — link your Open WebUI `X-User-Id` (email/ID) to your Discord account for per-user 3★ DM reminders. Hourly scheduler DMs each linked user their own due-soon tasks.

## MCP Tools

| Namespace | Tools |
|-----------|-------|
| `knowledge.*` | `ingest`, `search`, `get`, `delete`, `summarize`, `export`, `retag` |
| `idea.*` | `capture`, `suggest`, `list`, `delete`, `promote_to_task`, `brainstorm`, `cluster`, `refine` |
| `task.*` | `create`, `update`, `list`, `delete`, `ingest_raw`, `enrich_raw`, `get_today_schedule`, `suggest_next`, `breakdown`, `pomodoro`, `time_log`, `remind`, `due_soon` |
| `brief.*` | `daily`, `weekly` |
| `search.*` | `all` |
| `conversation.*` | `set_opt_out`, `get_opt_out` |
| `hook.*` | `on_turn` |
| `health` | — |

All tools validate via `zod` and return structured JSON. See `src/tools.ts` for schemas.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (31 tests)
npm run dev:stdio   # tsx stdio
npm run dev:http    # tsx http
```

## Storage

Single file `buddytrails.db` (SQLite, `BUDDYTRAILS_DB` env). Tables: `knowledge_entries`, `ideas`, `tasks`, `raw_task_items`, `reminders`, `pomodoro_sessions`, `conversation_settings`. Local-only, single-user, no cloud sync.

## License

MIT — see [LICENSE](LICENSE).
