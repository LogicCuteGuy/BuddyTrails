# BuddyTrails MCP

Single local MCP server with three namespaces — **Knowledge Hook DB**, **Have-Idea**, and **Work Task** — serving GitHub Copilot (`stdio`), Open WebUI (`HTTP/SSE`), and a Discord bot from one SQLite file.

## Features

- **Knowledge Hook DB** — auto-hooks every user↔AI turn, digests on write (embedding + summary + tags), stores raw + vector for semantic search
- **Have-Idea** — lightweight idea capture with semantic `suggest` when stuck
- **Work Task** — daily tasks with 3★ priority, deadline, estimate; Raw Task Data two-step enrichment (paste titles → assign priority/estimate); time-blocked Work Schedule + Suggest Next
- **Auto-skills** — `knowledge.summarize`/`export`/`retag`, `idea.brainstorm`/`cluster`/`refine`, `task.breakdown`/`pomodoro`/`time_log`, `brief.daily`/`weekly`, `search.all` — all via function-calling (slash aliases remain)
- **Discord bot** — `DISCORD_TOKEN`/`GUILD_ID`/`CHANNEL_ID`, `/buddytrails-setup`, hourly 3★ scheduler, `remind`/`due_soon`

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
- `GET /sse` + `POST /messages?sessionId=...` — MCP SSE transport
- `PORT` env (default `3000`), `BUDDYTRAILS_DB` env (default `./buddytrails.db`)

Open WebUI: add Tools pointing at `http://localhost:3000`, add a **Today** button calling `task.get_today_schedule`.

### Discord Bot

```bash
DISCORD_TOKEN=... node dist/discord/bot.js
```

Run `/buddytrails-setup` in any guild text channel to save that guild/channel (stored in `discord_settings` table). Hourly 3★ reminders post there. Re-run to move it.

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
