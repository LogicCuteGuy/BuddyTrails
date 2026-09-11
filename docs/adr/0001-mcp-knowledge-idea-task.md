# ADR 0001: Single MCP server for Knowledge Hook DB, Have-Idea, and Work Task

Date: 2026-09-11
Status: Accepted

## Context
Need one backend serving both GitHub Copilot and Open WebUI with three subsystems:
- Knowledge Hook DB (continuous repo, index-based, lightweight model digest)
- Have-Idea (quick capture, retrieve when stuck)
- Work Task (daily tasks, 3★ priority, deadlines, estimates, time-blocked schedule)

Repo is empty (`BuddyTrails`), single-context layout (`CONTEXT.md` + `docs/adr/`).

## Decision
- **Single MCP server**, TypeScript + `@modelcontextprotocol/sdk`, three tool namespaces: `knowledge.*`, `idea.*`, `task.*`.
- **Storage**: SQLite + sqlite-vec (file-based, local-only, single-user v1). No cloud sync, no auth.
- **Knowledge Hook**: auto-hook every user↔AI turn (Open WebUI pipeline + Copilot chat hook), chunk by turn / ~512 tokens, digest on write (embedding via `all-MiniLM-L6-v2`/`bge-small` + auto-summary + tags), store raw + vector, opt-out per conversation, retention forever v1.
- **Have-Idea**: `idea.capture(text, tags, context)` + `idea.suggest(query?, limit)` semantic search; separate from Knowledge.
- **Work Task**: `title, description, priority(1-3★), deadline, estimate_minutes, status(todo|doing|done), source`. v1 manual creation; integrations (email/Discord/Line) v2.
- **Raw Task Data flow**: user pastes raw titles/descriptions → system lists them back → user assigns `priority` + `estimate` in second pass → tasks become schedulable.
- **Work Schedule**: `task.get_today_schedule` filters `deadline==today` OR overdue `3★`, sorts `★★★ > ★★ > ★` → deadline → estimate, packs into 09:00–18:00 with breaks, warns on overflow. `task.suggest_next` returns top task + related Knowledge/Ideas.
- **Cross-linking**: light v1 — `suggest_next` searches Knowledge + Ideas for context; promotion is manual `idea.promote_to_task`.
- **Surfaces**: Copilot via `stdio` + slash skills (`/knowledge-search`, `/have-idea`, `/task-today`); Open WebUI via `HTTP/SSE` Tools + "Today" button. Same MCP server, two transports.

## Consequences
- One codebase, two transports — simpler ops, single SQLite file.
- Local-only keeps "hook everything" privacy-safe; multi-user/auth deferred to v2.
- Raw-task enrichment adds one extra round-trip but avoids guessing priority/estimate.

## Alternatives considered
- Three separate MCP servers — rejected (ops overhead, no shared search).
- Cloud vector DB (Pinecone/Qdrant cloud) — rejected for v1 (infra + privacy).
- Auto-create tasks from ideas — deferred (manual promotion safer v1).
