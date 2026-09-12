# ADR 0003: Dynamic Automations — RRULE-based Discord notifications

Date: 2026-09-13
Status: Accepted

## Context
Users need recurring Discord DM reminders with custom messages and flexible schedules (e.g. daily 08:30 after assembly, or per-weekday after-school times like Mon 16:30 / Wed 15:30). Hardcoded daily 09:00 push and hourly 3★ `due_soon` DMs are not enough — schedules vary per user and per day. The system should allow users to create, list, update, and delete their own automations dynamically via MCP tools, with RRULE-style recurrence.

## Decision
- **Single table `automations`**: `id, user_id, name, message, rrule, dtstart, enabled, created_at, updated_at`. Private per `Open WebUI User` (`anonymous` rejected), same isolation as `calendar_blocks`/`tasks`.
- **Tools**: `automation.create {name, message, rrule, dtstart}`, `automation.list`, `automation.update {id, name?, message?, rrule?, dtstart?, enabled?}`, `automation.delete {id}`. Validation: `name` 1..100, `message` 1..2000, `rrule` must be `FREQ=DAILY` or `FREQ=WEEKLY` with optional `BYDAY`/`INTERVAL`, `dtstart` must be `DTSTART:YYYYMMDDTHHMMSS` or `YYYY-MM-DDTHH:mm` or `HH:mm`.
- **Delivery**: Discord bot checks every minute in Asia/Bangkok time (`UTC+7`). For each enabled automation, if current `HH:mm` matches `dtstart` and `rrule` fires today (DAILY always, WEEKLY only if `BYDAY` includes today), DM `message` to the linked Discord user (`user_discord_link`). No delivery if user not linked.
- **Existing pushes preserved**: Hourly 3★ `due_soon` DMs and daily 09:00 `brief.daily` + schedule push remain unchanged.
- **Storage**: SQLite table `automations` + indexes on `(user_id)` and `(enabled)`; `MemDb` support for tests.

## Consequences
- Users can model any recurring reminder without code changes (daily, weekly per-day, interval).
- Per-user isolation prevents cross-user spam.
- Minute-level polling is simple and sufficient; no external scheduler needed.
- RRULE subset keeps validation simple; full iCal RRULE deferred.

## Alternatives considered
- Full cron expression — rejected (less familiar to users than RRULE examples in spec).
- External scheduler (node-cron, BullMQ) — rejected (adds dependency; minute polling is enough for DM use case).
- Hardcoded per-weekday automations — rejected (not dynamic; requires code change per schedule).
