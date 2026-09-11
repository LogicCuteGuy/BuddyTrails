# BuddyTrails Setup Guide

## 1. Prerequisites

- Node.js 22+ (`node -v` — uses `node:sqlite` built-in, no native build)
- npm 10+
- Git

## 2. Install

```bash
git clone https://github.com/LogicCuteGuy/BuddyTrails.git
cd BuddyTrails
npm install
npm run build
npm run typecheck   # should be clean
npm test            # 31 tests
```

## 3. Environment

```bash
cp .env.example .env
# edit .env
```

| Var | Default | Notes |
|-----|---------|-------|
| `BUDDYTRAILS_DB` | `./buddytrails.db` | Single SQLite file for all data |
| `PORT` | `3000` | HTTP/SSE port |
| `DISCORD_TOKEN` | — | Required only for Discord bot |

No `DISCORD_GUILD_ID`/`DISCORD_CHANNEL_ID` — Discord is guild-only via `/buddytrails-verify` (stored in `user_discord_link` + `link_codes`).

## 4. GitHub Copilot (stdio)

VS Code `mcp.json` (or Copilot MCP config):

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

- Uses `user_id = "local"` (single local user, no header).
- Sees shared Knowledge + its own private Ideas/Tasks (`local`).

## 5. Open WebUI (Streamable HTTP — recommended)

```bash
npm run start:http   # or npm run dev:http
curl http://localhost:3000/health
```

**Open WebUI Admin → Integrations → External Tool Servers:**

1. Type: **MCP (Streamable HTTP)**
2. URL: `http://host.docker.internal:3000/mcp` (Docker) or `http://localhost:3000/mcp` (bare metal)
3. Headers (JSON):
   ```json
   {"X-User-Id": "{{USER_ID}}"}
   ```
   or
   ```json
   {"X-User-Id": "{{USER_EMAIL}}"}
   ```
   See https://docs.openwebui.com/features/extensibility/mcp/#custom-headers — `{{USER_ID}}`, `{{USER_EMAIL}}`, `{{USER_NAME}}` etc. are expanded per request.

4. Save. Add a **Today** button calling `task.get_today_schedule` if desired.

**Multi-account:** Knowledge is **shared** across all Open WebUI users (with `created_by` audit). Ideas/Tasks/Reminders/Pomodoro/ConversationSettings are **private per `X-User-Id`**. Missing header → `anonymous` → private tools return `Missing X-User-Id`.

**Legacy SSE:** `GET /sse` + `POST /messages?sessionId=...` still works but prefer `/mcp`.

**REST (non-MCP):**
- `GET /health`, `GET /tools`, `POST /tools/:name` (also respects `X-User-Id` via `AsyncLocalStorage`)

## 6. Discord Bot (guild-only)

```bash
DISCORD_TOKEN=... node dist/discord/bot.js
```

- **Install:** Discord Developer Portal → Installation → Default Install Settings → **Guild Install** only (`bot` + `applications.commands`, `Guild` context). Invite to your guild.
- **Link:** In Open WebUI run the `link.create` tool → 6-digit code (10 min, single-use). Then in a **guild channel** run `/buddytrails-verify code:<code>` → creates `openwebui_user_id → discord_user_id`.
- **Notifications:** Hourly 3★ `due_soon` DMs to linked users (via `user_discord_link`); verify also sends a DM confirmation. No other slash commands; no User Install.

## 7. Verify

```bash
npm run build
npm test   # 31 tests, fileParallelism:false for shared DB
```

DB file `buddytrails.db` is created on first run. Single file, no cloud sync. Existing DBs are migrated automatically (adds `user_id`, `created_by`, `user_discord_link`, `link_codes`, fixes `conversation_settings` PK).

## 8. Troubleshooting

- **Private tools return `Missing X-User-Id`** — check Open WebUI Headers JSON is `{"X-User-Id": "{{USER_ID}}"}` (not `{{USER_ID}}` without quotes, not empty).
- **SSE `Failed to connect`** — use Streamable HTTP `/mcp` instead; SSE is legacy.
- **Discord DMs not arriving** — in Open WebUI run `link.create`, then in a guild channel run `/buddytrails-verify code:<code>`, then create a 3★ task with deadline today (hourly scheduler).
- **Verify says invalid/expired** — codes are 10 min single-use; run `link.create` again for a fresh code.
- **Tests fail with 0 tasks** — ensure `vitest.config.ts` has `pool: "forks"` and `fileParallelism: false` (shared `_db`).
