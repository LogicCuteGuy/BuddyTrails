---
name: buddytrails-triage
description: Triage raw task data into prioritized, estimated Work Tasks. Use when the user pastes raw titles/descriptions, wants to manage priority/due time, or asks to summarize/list raw data for triage. Handles task.ingest_raw → task.enrich_raw flow without burdening the MCP.
---

# BuddyTrails Triage

Turn **Raw Task Data** into **Work Tasks** with priority and estimate.

## Vocabulary

- **Raw Task Data** — unenriched titles/descriptions (`raw_task_items: temp_id, raw_text, user_id`).
- **Work Task** — `id, title, priority(1-3★), deadline, estimate_minutes, status, user_id`. Private per `X-User-Id`.

## Flow

1. **Ingest** — `task.ingest_raw { items: string[] }` → returns `temp_id` per item. Paste raw lines verbatim; don't invent priority/estimate yet.
2. **Summarize** — list back `raw_task_items` for the user: `SELECT temp_id, raw_text FROM raw_task_items WHERE user_id = ?` (or via `task.list` with `status` filter). Present as a table: `temp_id | raw_text | suggested priority | suggested estimate`.
3. **Enrich** — collect `priority` (1=low, 2=med, 3=high) and `estimate_minutes` per `temp_id`, then `task.enrich_raw { items: [{ temp_id, priority, estimate_minutes }] }` → creates Work Tasks, deletes raw rows. Validate: `priority 1-3`, `estimate_minutes >= 1`.
4. **Verify** — `task.list` to confirm created tasks; `task.get_today_schedule` to see time blocks.

## Priority guidance

- **3★** — due today or blocking; overdue 3★ surfaces in `brief.daily` and `task.get_today_schedule`.
- **2★** — this week.
- **1★** — backlog.

## Due time

Set `deadline` (ISO date `YYYY-MM-DD`) on `task.create` or after enrich via `task.update`. `task.due_soon { within: "24h"|"3d" }` and `brief.daily` filter by deadline.

## Anti-patterns

- Don't call `task.create` for raw paste — use `task.ingest_raw` first.
- Don't skip the summarize step — user must see raw list before assigning priority/estimate.
- Don't invent estimates — ask the user; default `30` only if they defer.
