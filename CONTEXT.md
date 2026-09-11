# CONTEXT.md

> Glossary for BuddyTrails — MCP server + skills for GitHub Copilot & Open WebUI.
> Single-context repo. Terms below are the canonical vocabulary; use them verbatim in issues, specs, and code.

## Glossary

### Knowledge Hook DB
Continuous knowledge repository. Auto-hooks every user ↔ AI turn, chunks, embeds with a lightweight model, and stores raw + vector for semantic search. Index-based, digest-on-write.

### Knowledge Entry
One stored unit in Knowledge Hook DB. Fields: `id, raw_text, summary, tags[], embedding, source, created_at, created_by?`. Shared across all Open WebUI Users (no isolation); `created_by` is audit only.

### Open WebUI User
Identity from Open WebUI Custom Headers (`X-User-Id` = `{{USER_ID}}` or `{{USER_EMAIL}}`). Owns private data. `stdio` (Copilot) maps to `user_id = "local"`. Missing header → `anonymous` (private tools reject).

### Private Idea / Private Task
Idea/Task scoped to one Open WebUI User via `user_id`. All `idea.*`/`task.*`/`brief.*`/`search.all` filter by `user_id`; `knowledge.*` does not.

### User Discord Link
Mapping `openwebui_user_id → discord_user_id` created by verifying a one-time Link Code via `/buddytrails-verify code:<6-digit>`. Enables per-user DM for 3★ due-soon scheduler.

### Link Code
One-time 6-digit code (`link_codes: code PK, openwebui_user_id, created_at, expires_at`) created in Open WebUI via `link.create` (10 min expiry, single-use). Verified in Discord via `/buddytrails-verify` to create the User Discord Link; expired/invalid codes are rejected and cleaned up.

### Digest
Processing applied on write: chunk (turn or ~512 tokens) → embedding (lightweight model e.g. `all-MiniLM-L6-v2` / `bge-small`) → auto-summary → auto-tags. Stored alongside raw for exact recall + semantic search.

### Have-Idea
Idea capture subsystem. Stores lightweight ideas for future retrieval when the user is stuck or asks "what next". Separate from Knowledge — faster capture, no heavy digest.

### Idea
One captured idea. Fields: `id, text, tags[], context, embedding, created_at, promoted_task_id?, user_id`. Private per Open WebUI User. Retrieved via semantic search (`suggest`).

### Work Task
Daily task / to-do / homework item. Fields: `id, title, description, priority(1-3★), deadline, estimate_minutes, status(todo|doing|done), source, created_at, user_id`. Private per Open WebUI User. Priority 3★ = highest. `source` = manual, notification, or promoted from Idea.

### Raw Task Data
Unenriched task input — just titles/descriptions pasted by the user, without priority or estimate. System lists them back so the user can assign `priority` and `estimate_minutes/hours` in a second pass.

### Work Schedule (Time Blocks)
Time-blocked plan for today. Derived from Work Tasks filtered to `deadline == today` OR overdue `priority=3★`. Sorted by `priority ★★★ > ★★ > ★`, then `deadline`, then `estimate`. Packed into working window (default 09:00–18:00) with breaks; warns on overflow. Produced by `task.get_today_schedule`.

### Suggest Next
Next-action recommendation. Returns the top-ranked task for now plus related Knowledge Entries and Ideas (semantic search) for context. Manual promotion via `idea.promote_to_task`.

## Non-terms (avoid)

- "Memory" — use Knowledge Entry or Idea explicitly.
- "Job" alone — use Work Task.
- "Schedule" alone — use Work Schedule.
