# ADR 0002: Calendar Block — flexible life period for Work Schedule

Date: 2026-09-12
Status: Accepted

## Context
Work Schedule (`task.get_today_schedule` → `src/scheduler.ts`) currently filters `deadline == today` OR overdue `3★` and packs into `09:00–18:00`. No notion of class timetable, holidays, school breaks, or exam weeks. Users want to declare life periods like `ปิดเทอม`, `สอบ`, `ไปค่าย`, `งานเยอะ` in natural language ("13-20 ต.ค. ปิดเทอม", "อาทิตย์นี้สอบ ขอเบาๆ") and have the schedule adapt — but without a rigid `break/exam/holiday` enum that forces every case into a fixed type.

Prior discussion (2026-09-12) explored a fixed-type model (`break|exam|holiday`) and a weekly recurrence model; both were rejected as too rigid for v1.

## Decision
- **Single term: `Calendar Block`** (see `CONTEXT.md`). One table, no type enum.
  - Fields: `id, user_id, label TEXT (free text), start_date TEXT YYYY-MM-DD, end_date TEXT YYYY-MM-DD inclusive, start_time TEXT HH:mm | null, end_time TEXT HH:mm | null, effect JSON, created_at`.
  - `label` is user-chosen free text (`ปิดเทอม`, `สอบ`, `ไปค่าย`, `ขี้เกียจ`, etc.).
  - `start_time/end_time` = **blocked interval** on each day in the range (e.g. `เรียน 09:00-11:00` blocks 09:00–11:00). `null` = whole day. Nullable because times are often uncertain / not fixed — user may omit them.
  - `effect JSON` with three optional keys, combinable: `skip?: boolean` (no schedule that day), `window?: {start,end}` (override available window, e.g. `ว่างแค่ 13:00-18:00`), `boost_tags?: string[]` (re-rank tasks whose title contains tag).
  - `Private` per `Open WebUI User` (`user_id` FK, `anonymous` rejected) — same isolation as `Private Task/Idea`.
- **Creation:** explicit tools `calendar.set`, `calendar.list`, `calendar.delete` + natural-language detection in `hook.on_turn` that **asks for confirmation** before creating (no silent auto-create from chat).
- **Scheduler integration (`src/scheduler.ts` + `task.get_today_schedule`):**
  - If `today` falls in any block with `effect.skip == true` → return `blocks: []`, `warning: "ติด <label> (start–end)"`, `activeBlock` in response. `skip` wins over all other blocks that day.
  - Otherwise, subtract all blocked intervals (`start_time–end_time`) from `workingWindow` and apply `window` override if present; then pack tasks. `boost_tags` is a tie-breaker **after** `priority` (★★★ still first; within same priority, matching tasks rank higher).
  - No auto-rescheduling of skipped tasks — they reappear next non-blocked day via normal `deadline == today` / overdue `3★` filter.
- **Display:** `task.get_today_schedule` and `brief.daily` surface `activeBlock` + `warning` when a block applies.
- **Recurrence deferred:** v1 is date-range only. Weekly class timetable (`ทุกจันทร์ 09:00-11:00`) is modeled as a date-range block covering the term with daily times; true `recurrence: weekly [Mon,Wed]` is v2 if needed.
- **Storage:** SQLite table `calendar_blocks` + index on `(user_id, start_date, end_date)`; migration in `src/db.ts:initSchema`.

## Consequences
- One flexible primitive covers breaks, exams, holidays, camps, and ad-hoc "busy week" without schema changes.
- Confirmation step prevents false positives from casual chat.
- `skip`-wins rule is simple to explain and avoids ambiguous overlap resolution.
- Nullable times handle the "ไม่แน่นอนและไม่ตายตัว" reality without forcing fake precision.
- Weekly recurrence remains manual in v1 (create one block per term); acceptable trade-off for simplicity.

## Alternatives considered
- Fixed enum `type: break|exam|holiday` with per-type behavior — rejected (too rigid, forces every label into a bucket).
- Separate `class_slots` + `holidays` tables — rejected (two concepts for one user need; adds join complexity).
- Silent auto-create from `hook.on_turn` without confirmation — rejected (chat false positives).
- Auto-reschedule skipped tasks to next day — rejected (risks deadline violations; explicit is safer).
- Weekly recurrence in v1 (`recurrence JSON`) — deferred to v2 (adds cron-like complexity for uncertain benefit).
