# Spec: MCP Knowledge Hook DB + Have-Idea + Work Task for GitHub Copilot & Open WebUI

## Problem Statement

The user works across GitHub Copilot and Open WebUI and has no continuous, searchable memory of what was said and done. Conversations disappear, ideas are lost when not acted on immediately, and daily tasks live as scattered notes without priority, estimate, or a time-blocked plan for today. When the user is unsure what to do next, there is no single place to surface relevant past knowledge, saved ideas, and the next best task. Raw task dumps (just titles) require manual re-entry to become schedulable. The user also wants skills to trigger automatically from normal chat (no slash memorization) and to receive timely reminders via Discord.

## Solution

A single local MCP server with three namespaces â€” Knowledge Hook DB, Have-Idea, and Work Task â€” serving GitHub Copilot (via `stdio` + slash skills), Open WebUI (via `HTTP/SSE` Tools + Today button), and a Discord bot (via `DISCORD_TOKEN`) from one SQLite + sqlite-vec store. Knowledge Hook DB auto-hooks every user â†” AI turn, digests on write (embedding via lightweight model + auto-summary + tags), and stores raw + vector for semantic search. Have-Idea captures lightweight ideas and suggests them when the user is stuck. Work Task manages daily tasks with 3â˜… priority, deadline, and estimate, supports a Raw Task Data enrichment flow (paste raw titles â†’ list back â†’ assign priority/estimate), and produces a Work Schedule (time-blocked plan for today) plus Suggest Next (top task + related Knowledge Entries and Ideas). Additional auto-skills â€” Knowledge summarize/export/tag-manage, Idea brainstorm/cluster/refine, Task breakdown/pomodoro/time-track, cross-cutting daily-brief/weekly-review/search-all, and Discord remind/due-soon/push â€” are all MCP tools auto-triggered by normal chat via function-calling (slash aliases remain). Skills on all surfaces are thin wrappers over the same MCP tools.

## User Stories

1. As a user, I want every user â†” AI turn auto-hooked into Knowledge Hook DB, so that I never lose context.
2. As a user, I want to opt out of hooking per conversation, so that sensitive chats stay private.
3. As a user, I want each Knowledge Entry to keep both raw text and vector, so that I get exact recall and semantic search.
4. As a user, I want Knowledge Hook DB to digest on write (embedding + summary + tags) via a lightweight model, so that search is fast and cheap.
5. As a user, I want to manually ingest text, URLs, and files into Knowledge Hook DB, so that external knowledge is searchable too.
6. As a user, I want to semantic-search Knowledge Entries by query, so that I find relevant past turns without remembering keywords.
7. As a user, I want to filter Knowledge search by source and date, so that I narrow results.
8. As a user, I want to capture an idea in one call with text, tags, and context, so that I don't lose fleeting thoughts.
9. As a user, I want Have-Idea to store ideas separately from Knowledge Entries, so that quick capture stays lightweight.
10. As a user, I want to semantic-search ideas via `suggest`, so that I surface relevant ideas when stuck.
11. As a user, I want to explicitly ask "what next / I'm stuck" to get idea suggestions, so that retrieval is intentional not noisy.
12. As a user, I want to promote an Idea to a Work Task manually, so that I control what becomes actionable.
13. As a user, I want to create a Work Task with title, description, priority (1â€“3â˜…), deadline, estimate, and status, so that tasks are fully specified.
14. As a user, I want priority 3â˜… to mean highest, so that sorting is intuitive.
15. As a user, I want to paste Raw Task Data (just titles/descriptions) and have the system list it back, so that I can assign priority and estimate in a second pass.
16. As a user, I want to assign priority and estimate (minutes/hours) to each raw task after listing, so that raw dumps become schedulable without re-typing.
17. As a user, I want to update a task's status (todo/doing/done), so that progress is tracked.
18. As a user, I want to list tasks filtered by status, priority, and deadline, so that I see what matters.
19. As a user, I want to get today's Work Schedule as time blocks, so that I know what to do and when.
20. As a user, I want Work Schedule to include overdue 3â˜… tasks plus tasks due today, so that critical overdue work isn't hidden.
21. As a user, I want Work Schedule sorted by priority â˜…â˜…â˜… > â˜…â˜… > â˜…, then deadline, then estimate, so that the most important work comes first.
22. As a user, I want Work Schedule packed into my working window (default 09:00â€“18:00) with breaks, so that the plan is realistic.
23. As a user, I want a warning when tasks overflow the working window, so that I can reprioritize.
24. As a user, I want Suggest Next to return the top-ranked task for now plus related Knowledge Entries and Ideas, so that I have context to act.
25. As a user, I want cross-linking to be light v1 (search Knowledge + Ideas for context, no auto-creation of tasks from ideas), so that automation doesn't surprise me.
26. As a user, I want to invoke Knowledge search via GitHub Copilot slash skill, so that I stay in my editor.
27. As a user, I want to invoke Have-Idea capture/suggest via Copilot slash skill, so that ideas are captured without leaving the IDE.
28. As a user, I want to invoke today's schedule via Copilot slash skill (`/task-today`), so that I get my plan in Copilot Chat.
29. As a user, I want Open WebUI Tools auto-available in chat, so that I can call knowledge/idea/task without setup.
30. As a user, I want an Open WebUI "Today" button that calls `get_today_schedule`, so that one click shows my time-blocked day.
31. As a user, I want the same MCP server to serve Copilot via stdio and Open WebUI via HTTP/SSE, so that I run one backend.
32. As a user, I want all data stored locally in a single SQLite file, single-user, no cloud sync v1, so that "hook everything" stays private.
33. As a user, I want the system to run offline after initial model download, so that I don't depend on external APIs.
34. As a user, I want to delete or update a Knowledge Entry, Idea, or Work Task, so that I can correct mistakes.
35. As a user, I want to see raw task data listed back verbatim before enrichment, so that I can verify what was captured.
36. As a user, I want to say naturally "summarize what I know about X" and get a summary with sources, so that I don't need a slash command.
37. As a user, I want to export my knowledge as markdown/json, so that I can share or backup.
38. As a user, I want to clean up tags (merge/dedupe), so that my knowledge stays organized.
39. As a user, I want to say "brainstorm ideas for Z" and get 3-5 ideas auto-captured, so that brainstorming is frictionless.
40. As a user, I want to cluster my ideas by similarity, so that I see themes.
41. As a user, I want to refine an idea with an instruction and have it re-embedded, so that ideas improve.
42. As a user, I want to say "break down this task" and get subtasks with estimates, so that large tasks become actionable.
43. As a user, I want to run a pomodoro timer on a task and log time, so that I track focus.
44. As a user, I want to see actual vs estimate time per task, so that I improve estimates.
45. As a user, I want to say "what's my day" and get a daily brief (schedule + overdue + top idea + related knowledge), so that I start the day informed.
46. As a user, I want a weekly review (done/overdue + idea clusters), so that I reflect.
47. As a user, I want to say "search everything about X" and get unified results across Knowledge + Ideas + Tasks, so that I find anything.
48. As a user, I want to say "remind me at 3pm to do X" in Discord and get a DM/ping at that time, so that I don't miss tasks.
49. As a user, I want to ask "what's due soon" and get a digest of tasks due in 24h/3d, so that I stay ahead.
50. As a user, I want the Discord bot to auto-DM me when a 3â˜… task is due in 24h or overdue, so that critical work isn't missed.
51. As a user, I want all new skills to work via normal chat (function-calling) on Copilot, Open WebUI, and Discord, with slash aliases as fallback, so that I don't memorize commands.

## Implementation Decisions

- **Single MCP server, three namespaces**: `knowledge.*`, `idea.*`, `task.*` on one codebase. Chosen over three separate servers to avoid ops overhead and enable cross-search in Suggest Next and search.all. Extended with `brief.*` and `search.all` for cross-cutting skills.
- **Language and SDK**: TypeScript with `@modelcontextprotocol/sdk`. Provides stdio and HTTP/SSE transports from one implementation. Discord bot shares the same DB and MCP tools via direct import, not a separate transport.
- **Storage**: SQLite + sqlite-vec, file-based, local-only, single-user v1. No auth, no cloud sync. Keeps "hook everything" privacy-safe and zero-infra. One file `buddytrails.db` shared by MCP server and Discord bot.
- **Embedding and Digest**: Lightweight model (e.g. `all-MiniLM-L6-v2` or `bge-small`) run locally. Digest on write: chunk by turn or ~512 tokens â†’ embedding â†’ auto-summary â†’ auto-tags. Store raw + vector + summary + tags per Knowledge Entry.
- **Knowledge Hook mechanism**: Open WebUI pipeline hook + Copilot chat hook that call `knowledge.ingest` in background on every turn. Opt-out flag per conversation. Retention forever v1, TTL deferred.
- **Have-Idea model**: Idea fields `id, text, tags[], context, embedding, created_at, promoted_task_id?`. Tools `idea.capture(text, tags, context)` and `idea.suggest(query?, limit)` via semantic search. Separate table from Knowledge Entries for lightweight capture.
- **Work Task model**: Work Task fields `id, title, description, priority(1-3â˜…), deadline, estimate_minutes, status(todo|doing|done), source, created_at`. Source tracks manual, notification, or promoted from Idea. Tools for create, update, list, delete, and enrichment.
- **Raw Task Data flow**: Two-step enrichment. Step 1 `task.ingest_raw(items: string[])` stores raw items and returns them listed back with temp ids. Step 2 `task.enrich_raw(items: {temp_id, priority, estimate_minutes}[])` assigns priority and estimate and creates schedulable Work Tasks. This avoids guessing priority/estimate.
- **Work Schedule generation**: Pure function `(tasks, workingWindow) â†’ timeBlocks`. Filter `deadline == today` OR overdue `priority=3â˜…`. Sort `â˜…â˜…â˜… > â˜…â˜… > â˜…` â†’ deadline â†’ estimate. Pack into working window (default 09:00â€“18:00) with breaks; emit overflow warning if total estimates exceed window. Exposed as `task.get_today_schedule`.
- **Suggest Next**: `task.suggest_next` returns top-ranked task for now plus semantic search over Knowledge Entries and Ideas for related context. No auto-creation of tasks from ideas v1; promotion is manual via `idea.promote_to_task`.
- **Cross-linking v1**: Light linking only. Suggest Next searches Knowledge + Ideas; no background job creates tasks from ideas.
- **MCP tool contracts (core)**: Knowledge tools `knowledge.ingest`, `knowledge.search`, `knowledge.get`, `knowledge.delete`; Idea tools `idea.capture`, `idea.suggest`, `idea.promote_to_task`, `idea.list`, `idea.delete`; Task tools `task.create`, `task.ingest_raw`, `task.enrich_raw`, `task.update`, `task.list`, `task.get_today_schedule`, `task.suggest_next`, `task.delete`. All tools validate inputs and return structured results with ids and scores.
- **MCP tool contracts (auto-skills)**: Knowledge auto-skills `knowledge.summarize(query, topK?)` (LLM summary over top-K hits with citations), `knowledge.export(filter?)` (markdown/json dump), `knowledge.retag` (merge/dedupe tags, re-embed if needed); Idea auto-skills `idea.brainstorm(prompt, count?)` (generate 3-5 ideas via LLM and capture each), `idea.cluster` (group by embedding similarity), `idea.refine(id, instruction)` (rewrite + re-embed); Task auto-skills `task.breakdown(id)` (split into subtasks with estimates), `task.pomodoro(id, action: start|pause|done)` (25-min timer + log), `task.time_log` (actual vs estimate); Cross-cutting `brief.daily` (today's schedule + overdue 3â˜… + top idea + related knowledge), `brief.weekly` (done/overdue + idea clusters), `search.all(query)` (unified Knowledge+Idea+Task); Discord `task.remind(id, at)` (persisted schedule), `task.due_soon(within: 24h|3d)` (digest).
- **Auto-trigger by normal ask**: All auto-skills are MCP tools invoked via LLM function-calling when the user says naturally "summarize what I know about X" / "brainstorm ideas for Z" / "break down this task" / "what's my day" / "remind me at 3pm" â€” no slash required. Slash wrappers (`/knowledge-summarize`, `/idea-brainstorm`, `/task-breakdown`, `/daily-brief`, `/remind`, etc.) remain as explicit aliases. Same MCP tools, three surfaces (Copilot stdio, Open WebUI HTTP/SSE, Discord bot).
- **Transports**: Copilot uses stdio; Open WebUI uses HTTP/SSE; Discord bot uses discord.js sharing the same DB. Guild/channel via DISCORD_GUILD_ID / DISCORD_CHANNEL_ID env, setup via /buddytrails-setup command. Same server codebase, three entry points. No separate deployment per surface for core logic.
- **Skills as thin wrappers**: GitHub Copilot skills are slash-command wrappers that call the MCP tools. Open WebUI Tools/Functions are thin wrappers plus a Today button. Discord bot commands are thin wrappers over MCP tools. Skills contain no business logic; all logic lives in MCP tools. This answers "where skills?" â€” they are the surface, not the seam.
- **Discord bot**: Built with discord.js, connects via `DISCORD_TOKEN` env, shares `buddytrails.db` + MCP tools. `task.remind` persists schedule and survives restart. Hourly scheduler checks for 3â˜… tasks due in 24h or overdue and auto-DMs (DM fallback, channel configurable). Normal chat in Discord triggers via bot's LLM + MCP function-calling.
- **Schema**: Three tables `knowledge_entries`, `ideas`, `tasks` plus vector index via sqlite-vec. Knowledge Entry stores `raw_text, summary, tags, embedding, source, created_at`; Idea stores `text, tags, context, embedding, created_at, promoted_task_id`; Work Task stores `title, description, priority, deadline, estimate_minutes, status, source, created_at`. Additional tables for pomodoro sessions and reminders if needed, or reuse tasks with metadata.
- **Notifications/messages from key contacts**: Discord push is v1 for task reminders/due-soon. Other OAuth integrations (email/Line) remain v2. v1 source field records provenance.
- **ADRs and glossary**: Respect `CONTEXT.md` vocabulary (Knowledge Hook DB, Knowledge Entry, Digest, Have-Idea, Idea, Work Task, Raw Task Data, Work Schedule, Suggest Next) and ADR 0001 (single MCP server decision).

## Testing Decisions

- **What makes a good test**: Test external behavior through the MCP tool API, not implementation details. Assert on tool inputs/outputs, search relevance, schedule ordering, and enrichment flow. Do not assert on SQLite internals, embedding internals, or transport framing.
- **Primary seam â€” MCP Tool API (ideal: one seam)**: All behavior tested via an in-process MCP client calling `knowledge.*`, `idea.*`, `task.*`, `brief.*`, `search.all`. Covers ingest/search/summarize/export/retag, capture/suggest/brainstorm/cluster/refine/promote, CRUD/Raw Task enrichment/breakdown/pomodoro/time_log, Work Schedule/Suggest Next, daily-brief/weekly-review/search-all, and remind/due_soon. Auto-trigger is function-calling â€” not a separate seam, just the LLM calling the same tools. This is the highest seam and the only seam needed for most tests.
- **Secondary pure seam â€” Scheduler**: `task.get_today_schedule` logic is a pure function `(tasks, workingWindow) â†’ timeBlocks`. Tested through the MCP seam and also unit-tested in isolation for edge cases (overflow, priority ordering, breaks, empty day, all overdue).
- **Not seams**: SQLite/sqlite-vec, embedding model, stdio/HTTP/SSE transports, Discord bot (discord.js), Open WebUI pipeline, Copilot skill wrappers â€” thin adapters, not tested directly; covered via the MCP seam.
- **Prior art**: No existing tests in this empty repo; new tests establish the pattern. Follow Arrange-Act-Assert with in-process MCP client; use deterministic embeddings or mocked lightweight model for stable assertions where needed.

## Out of Scope

- Multi-user, auth, cloud sync, or hosted vector DB (Pinecone/Qdrant cloud) â€” v2.
- OAuth integrations beyond Discord (email, Line) â€” v2; v1 only records source for those.
- TTL or retention policies for Knowledge Entries â€” v1 retains forever.
- Auto-creation of Work Tasks from Ideas or Knowledge â€” v1 requires manual `promote_to_task` (except brainstorm which explicitly creates ideas).
- Background scheduling beyond Discord hourly check and pomodoro timer â€” v1 is otherwise pull-based (`get_today_schedule`, `suggest_next`, `brief.daily`).
- Custom working hours UI â€” v1 defaults to 09:00â€“18:00; configurable via tool param, no UI.
- Replacing SQLite with another store or adding a separate vector DB process â€” deferred.

## Further Notes

- Privacy: Local-only single-user store keeps "hook everything" safe. No data leaves the machine except via explicit user action. Discord bot runs locally with your token.
- Model choice: Lightweight embedding model runs locally after initial download; no external API key required. Swap via config if needed. Summarize/brainstorm use local LLM or configured provider.
- Skills question: Skills live as thin wrappers over MCP tools on all surfaces; they are not separate test seams. All logic and tests go through the MCP Tool API. Auto-trigger via function-calling means normal chat just works â€” slash is alias.
- Discord setup: Requires `DISCORD_TOKEN` env, DM fallback by default, channel configurable. Hourly scheduler for 3â˜… due-soon/overdue.
- Next step after spec: `/to-tickets` already created #2-#12; new auto-skills are #8-#12. Implement per ticket in frontier order (TDD + code-review).

