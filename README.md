# BuddyTrails MCP

Single local MCP server with four namespaces — **Knowledge Hook DB**, **Have-Idea**, **Work Task**, and **Calendar Block** — serving GitHub Copilot (`stdio`), Open WebUI (`HTTP/SSE`), and a Discord bot from one SQLite file.

## Features

- **Knowledge Hook DB** — auto-hooks every user↔AI turn, digests on write (embedding + summary + tags), stores raw + vector for semantic search
- **Have-Idea** — lightweight idea capture with semantic `suggest` when stuck
- **Work Task** — daily tasks with 3★ priority, deadline, estimate; Raw Task Data two-step enrichment (paste titles → assign priority/estimate); time-blocked Work Schedule + Suggest Next
- **Calendar Block** — flexible life period (e.g. school break, exam week, camp, busy week) with free-text `label` + `start_date`/`end_date` + optional `start_time`/`end_time` + `effect {skip, window, boost_tags}`; `task.get_today_schedule`/`brief.daily` respect it (`skip` wins, timed intervals unioned and subtracted, `window` override, `boost_tags` tie-breaker after priority), `hook.on_turn` proposes blocks from natural language with confirmation
- **Auto-skills** — `knowledge.summarize`/`export`/`retag`, `idea.brainstorm`/`cluster`/`refine`, `task.breakdown`/`pomodoro`/`time_log`, `brief.daily`/`weekly`, `search.all` — all via function-calling (slash aliases remain)
- **Discord bot** — `DISCORD_TOKEN`, guild-only `/buddytrails-verify` (code flow), hourly 3★ DM + daily 09:00 Asia/Bangkok push (`brief.daily` + schedule) per linked user (`DAILY_PUSH_HOUR` env to override)
- **Multi-account** — Open WebUI Custom Headers (`X-User-Id: {{USER_ID}}`/`{{USER_EMAIL}}`), Knowledge shared, Ideas/Tasks private per user, `stdio` = `local`; link via `link.create` (Open WebUI) → `/buddytrails-verify` (Discord)

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

### Discord Bot (guild-only)

```bash
DISCORD_TOKEN=... node dist/discord/bot.js
```

- Guild Install only (`Guild` context) — invite to your guild.
- `link.create` (Open WebUI) → `/buddytrails-verify code:<6-digit>` (in a **guild channel**) — links `X-User-Id` → Discord for hourly 3★ DM reminders (10 min, single-use, DM confirmation).

## MCP Tools

| Namespace | Tools |
|-----------|-------|
| `knowledge.*` | `ingest`, `search`, `get`, `delete`, `summarize`, `export`, `retag` |
| `idea.*` | `capture`, `suggest`, `list`, `delete`, `promote_to_task`, `brainstorm`, `cluster`, `refine` |
| `task.*` | `create`, `update`, `list`, `delete`, `ingest_raw`, `enrich_raw`, `get_today_schedule`, `suggest_next`, `breakdown`, `pomodoro`, `time_log`, `remind`, `due_soon` |
| `calendar.*` | `set`, `list`, `delete` |
| `notify.*` | `send` — AI-initiated Discord message (`dm` to linked user or `channel` by ID) |
| `brief.*` | `daily`, `weekly` |
| `search.*` | `all` |
| `conversation.*` | `set_opt_out`, `get_opt_out` |
| `hook.*` | `on_turn` (auto-ingest + Calendar Block detection with confirmation) |
| `link.*` | `create` (6-digit code, 10 min, single-use) |
| `health` | — |

All tools validate via `zod` and return structured JSON. See `src/tools.ts` for schemas.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (72 tests)
npm run dev:stdio   # tsx stdio
npm run dev:http    # tsx http
```

## Storage

Single file `buddytrails.db` (SQLite, `BUDDYTRAILS_DB` env). Tables: `knowledge_entries` (shared, `created_by` audit), `ideas`/`tasks`/`raw_task_items`/`reminders`/`pomodoro_sessions`/`conversation_settings`/`calendar_blocks` (private per `user_id`), `discord_settings`, `user_discord_link`, `link_codes` (one-time 6-digit, 10 min). `calendar_blocks` stores `label`, `start_date`/`end_date`, `start_time`/`end_time`, `effect JSON {skip, window, boost_tags}` with indexes on `(user_id)` and `(user_id, start_date, end_date)`. Existing DBs auto-migrated. Local-only, no cloud sync.

## Setup Guide

See [docs/SETUP.md](docs/SETUP.md) for full prerequisites, env, Copilot/Open WebUI/Discord setup, and troubleshooting.

## License

MIT — see [LICENSE](LICENSE).
