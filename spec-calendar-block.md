# Spec: Calendar Block — flexible life period for Work Schedule

## Problem Statement

As a student/user of BuddyTrails, my life is not a flat list of Work Tasks with deadlines. Real life has stretches where the normal Work Schedule should not apply or should adapt: school breaks (`ปิดเทอม`), exam weeks (`สอบ`), holidays, camps (`ไปค่าย`), or ad-hoc busy weeks (`งานเยอะ`, `ขี้เกียจ`). Today `task.get_today_schedule` only knows `deadline == today` OR overdue `3★` packed into `09:00–18:00`. There is no way to say "13–20 ต.ค. ปิดเทอม — don't schedule me" or "this week is exams, only afternoons are free and exam-related tasks should come first" without manually deleting or moving tasks. Users want to declare these periods the way they would tell a friend — free-form label + date range + optional daily time window — and have the Work Schedule respect it automatically, per-user, without being forced into a rigid `break/exam/holiday` taxonomy.

## Solution

Introduce a single flexible primitive called **Calendar Block** (see `CONTEXT.md` + ADR 0002). A Calendar Block is a user-declared date range with a free-text `label`, optional daily blocked time window (`start_time`/`end_time`), and a combinable `effect` (`skip`, `window`, `boost_tags`). It is Private per Open WebUI User. Users create blocks explicitly via `calendar.*` tools or via natural-language detection in `hook.on_turn` that asks for confirmation before creating. `task.get_today_schedule` (and `brief.daily`) check whether `today` falls inside any of the caller's blocks and apply the effect: `skip` empties the schedule, blocked intervals are subtracted from the working window, `window` overrides the available window, and `boost_tags` re-ranks matching tasks as a tie-breaker after priority. No auto-rescheduling of skipped tasks; no weekly recurrence in v1.

## User Stories

1. As a student, I want to create a Calendar Block with label `ปิดเทอม` covering `2026-10-13` to `2026-10-20` with `effect.skip=true`, so that Work Schedule shows no blocks that week.
2. As a student, I want to create a Calendar Block for `สอบ` covering `2026-09-15` to `2026-09-19` with `start_time 09:00 end_time 12:00` (blocked mornings), so that tasks are only packed into the remaining window.
3. As a student, I want to create a Calendar Block with `effect.window {start:"13:00", end:"18:00"}` for exam week, so that the scheduler only uses afternoons even if my default window is `09:00–18:00`.
4. As a student, I want to set `effect.boost_tags ["สอบ","คณิต"]` on an exam block, so that within the same priority, tasks whose title contains those tags are scheduled first.
5. As a user, I want `label` to be free text (e.g. `ไปค่าย`, `งานเยอะ`, `ขี้เกียจ`), so that I am not forced into a fixed `break/exam/holiday` enum.
6. As a user, I want to omit `start_time`/`end_time` when the time is uncertain, so that the block covers the whole day without fake precision.
7. As a user, I want to type `13-20 ต.ค. ปิดเทอม` in chat and have the system propose a Calendar Block for confirmation, so that I can declare periods like talking to a friend.
8. As a user, I want the system to ask for confirmation before creating a block from chat, so that casual mentions don't create false blocks.
9. As a user, I want to explicitly call `calendar.set` with `label, start_date, end_date, start_time?, end_time?, effect?`, so that I have a deterministic API.
10. As a user, I want to call `calendar.list` to see all my blocks, so that I can audit what is active.
11. As a user, I want to call `calendar.delete {id}` to remove a block, so that I can cancel a break or fix a mistake.
12. As a user, I want Calendar Blocks to be Private per Open WebUI User, so that my break does not hide another user's schedule.
13. As an anonymous/unauthenticated caller, I want `calendar.*` to reject with a clear error, so that privacy is enforced like `task.*`/`idea.*`.
14. As a user, I want `task.get_today_schedule` to return `activeBlock` and a `warning` like `ติด ปิดเทอม (2026-10-13–2026-10-20)` when today is inside a block, so that I understand why the schedule is empty or shrunk.
15. As a user, I want `brief.daily` to surface the active Calendar Block alongside tasks, so that my daily brief explains the context.
16. As a user, I want `skip` to win when multiple blocks overlap on the same day (e.g. `ปิดเทอม skip` + `สอบ 09:00-12:00`), so that the result is predictable.
17. As a user, I want overlapping non-skip blocks to have their blocked intervals unioned and subtracted from the working window, so that `เรียน 09:00-11:00` + `สอบ 13:00-15:00` both shrink the day correctly.
18. As a user, I want `boost_tags` to be a tie-breaker after `priority` (★★★ still first), so that priority is never violated by a tag.
19. As a user, I want tasks skipped due to a `skip` block to simply not appear today and reappear next non-blocked day via the normal `deadline == today` / overdue `3★` filter, so that deadlines are not silently moved.
20. As a user, I want validation that `start_date <= end_date` and `start_time < end_time` when times are provided, and `effect` contains at least one meaningful key or times, so that invalid blocks are rejected.
21. As a user, I want `calendar.set` to validate `YYYY-MM-DD` and `HH:mm` formats, so that malformed input is caught early.
22. As a developer, I want the pure `schedule()` function to remain testable without DB, so that scheduler logic can be unit-tested in isolation.
23. As a developer, I want existing tests for `schedule` and `task.get_today_schedule` to continue passing, so that no regression is introduced.

## Implementation Decisions

- **Domain vocabulary:** Use `Calendar Block` exactly as defined in `CONTEXT.md` and ADR 0002. No `Class Schedule`/`Holiday` split. `label` is free text; no type enum.
- **Storage — new table `calendar_blocks`:**
  - Columns: `id TEXT PK, user_id TEXT NOT NULL, label TEXT NOT NULL, start_date TEXT NOT NULL (YYYY-MM-DD), end_date TEXT NOT NULL (YYYY-MM-DD inclusive), start_time TEXT (HH:mm) NULL, end_time TEXT (HH:mm) NULL, effect TEXT (JSON) NOT NULL DEFAULT '{}', created_at TEXT NOT NULL`.
  - `effect JSON` shape: `{ skip?: boolean, window?: {start:string,end:string}, boost_tags?: string[] }`.
  - Indexes: `idx_calendar_blocks_user (user_id)`, `idx_calendar_blocks_user_dates (user_id, start_date, end_date)`.
  - Migration in `src/db.ts:initSchema` + `MemDb` support in `src/db.ts` for tests (new Map entry, `prepare` handling for `calendar_blocks`).
  - Follows existing Private pattern: `user_id` column, `anonymous` rejected, `local` fallback for stdio.
- **MCP tools — new namespace `calendar.*` in `src/tools.ts`:**
  - `calendar.set { label:string(1..100), start_date:string(YYYY-MM-DD), end_date:string(YYYY-MM-DD), start_time?:string(HH:mm), end_time?:string(HH:mm), effect?:{skip?:boolean, window?:{start:string,end:string}, boost_tags?:string[]} }` → validates, inserts, returns `{id, label, start_date, end_date, start_time, end_time, effect}`. Requires `user_id != anonymous`.
  - `calendar.list {}` → returns `blocks: CalendarBlock[]` for caller, ordered by `start_date ASC`.
  - `calendar.delete { id:string }` → deletes where `id=? AND user_id=?`, returns `{deleted:id}` (idempotent if not found → still success or explicit not-found; choose idempotent success to match `task.delete` style).
  - All three enforce `getCurrentUserId()` check like `task.*`/`idea.*`.
- **Pure scheduler seam — extend `src/scheduler.ts:schedule()`:**
  - Signature becomes `schedule(tasks: Task[], workingWindow, today, calendarBlocks?: CalendarBlock[])` — new optional param keeps backward compat with existing tests.
  - Logic: filter `calendarBlocks` where `start_date <= today <= end_date` → `activeBlocks`. If any `effect.skip==true` → return `ScheduleResult` with `blocks:[]`, `warning:"ติด <label> (start–end)"`, `activeBlock` (first skip block), `window_minutes` unchanged, `overflow:false`. Else compute `blockedIntervals` from `start_time/end_time` (null = whole day already handled by skip), subtract from `workingWindow` to get effective window(s); if `effect.window` present, intersect/override; then pack tasks into effective window. `boost_tags` re-ranks `sorted` as tie-breaker after `priority` (stable sort: priority DESC, boost_match DESC, deadline ASC, estimate ASC).
  - Return type `ScheduleResult` extended with optional `activeBlock?: CalendarBlock | null` and `activeBlocks?: CalendarBlock[]` for transparency; `warning` carries human-readable reason.
  - Keeps existing behavior when `calendarBlocks` is undefined/empty (no regression).
- **MCP integration — `task.get_today_schedule` handler in `src/tools.ts`:**
  - Before calling `schedule()`, query `SELECT * FROM calendar_blocks WHERE user_id=? AND start_date <= ? AND end_date >= ?` for `today`, pass to `schedule()`. Return the enriched `ScheduleResult` directly.
  - `brief.daily` handler also queries active blocks for today and includes `activeBlock`/`activeBlocks` in response.
- **Natural-language hook — `hook.on_turn` in `src/tools.ts`:**
  - Extend existing `hook.on_turn` to detect candidate Calendar Block mentions (Thai keywords: `ปิดเทอม`, `สอบ`, `หยุด`, `ไปค่าย`, `ลา`, date patterns `13-20 ต.ค.`, `13/10`, `2026-10-13`). Do NOT auto-create. Instead return `{ detectedCalendarBlock: {label, start_date, end_date, start_time?, end_time?, effect?}, needsConfirmation:true, message:"เจอ 'ปิดเทอม 13-20 ต.ค.' จะสร้าง Calendar Block แบบ skip ใช่ไหม? เรียก calendar.set เพื่อยืนยัน" }`. Actual creation only via `calendar.set`.
  - Keeps existing knowledge-ingest behavior; detection is additive.
- **Validation rules:**
  - `start_date`/`end_date` must match `^\d{4}-\d{2}-\d{2}$` and be valid dates; `start_date <= end_date`.
  - `start_time`/`end_time` must match `^\d{2}:\d{2}$` with `00<=HH<=23`, `00<=mm<=59`; if one is provided both must be provided; `start_time < end_time`.
  - `effect.window` if present must have valid `HH:mm` and `start < end`.
  - `effect.boost_tags` if present must be `string[1..20]` each `1..30` chars.
  - At least one of `effect.skip`, `effect.window`, `effect.boost_tags`, or `start_time/end_time` should be present; otherwise block is a no-op — reject with "effect or time required".
- **Seams for testing (highest seam preferred):**
  - Primary seam: MCP tool seam (`tools.find(x=>x.name==="calendar.set").handler(...)` and `task.get_today_schedule` handler) — same seam as existing `tests/scaffold.test.ts` and `tests/schedule.test.ts` "MCP seam" tests. Preferred for integration tests.
  - Secondary seam: pure `schedule()` in `src/scheduler.ts` — for unit tests of skip/window/boost/overlap logic without DB.
  - No new seams introduced; reuse existing `src/db.ts` and `src/tools.ts` seams. Ideal number of seams touched: 2 (tools + scheduler) + 1 schema (db).
- **No recurrence in v1:** Weekly timetable is modeled as a date-range block covering the term with daily times. True `recurrence: weekly [Mon,Wed]` deferred to v2.

## Testing Decisions

- **What makes a good test:** Test external behavior at the MCP tool seam and pure scheduler seam, not implementation details (no asserting on SQL strings or internal JSON parsing). Each test sets up a temp DB via `openDb`/`resetDb` (pattern from `tests/scaffold.test.ts`), calls tool handlers, and asserts on returned `ScheduleResult`/`blocks`/`warning`/`activeBlock`.
- **Modules to test:**
  - `src/scheduler.ts` pure function: skip wins, blocked interval subtraction, window override, boost_tags tie-breaker, overlap union, nullable times (whole-day vs timed), no regression when no blocks.
  - `src/tools.ts` MCP handlers: `calendar.set` validation (bad dates/times, start>end, anonymous rejection), `calendar.list` privacy (user A cannot see user B's blocks), `calendar.delete` idempotency, `task.get_today_schedule` integration with blocks, `brief.daily` includes activeBlock, `hook.on_turn` detection returns needsConfirmation without creating.
  - `src/db.ts` schema: `calendar_blocks` table exists after `initSchema`, indexes present, `MemDb` supports the new table.
- **Prior art:**
  - `tests/schedule.test.ts` — pure `schedule()` tests (empty, sort, overdue, overflow, breaks) + MCP seam tests for `task.get_today_schedule`/`suggest_next`/`promote`. Follow same `setupDb()` helper (mkdtemp + `BUDDYTRAILS_DB` env + `openDb`/`resetDb`).
  - `tests/scaffold.test.ts` — tool listing, knowledge/idea/task flows via `tools.find(...).handler`. Same pattern for `calendar.*`.
  - `vitest.config.ts` — `pool:forks singleFork`, `fileParallelism:false`; new tests must be compatible (no parallel DB contention).
- **Specific cases to cover:**
  - `skip` block on today → `blocks:[]`, `warning` contains label, `activeBlock` set.
  - Timed block `09:00-12:00` → effective window shrinks, tasks pack after 12:00, `window_minutes` reduced.
  - `window:13:00-18:00` override → tasks pack only in that window.
  - `boost_tags:["สอบ"]` → within same priority, matching title ranks first.
  - Overlap: `skip` + timed → skip wins; two timed blocks → union subtraction.
  - Whole-day block without times and without skip but with boost_tags → still applies boost.
  - Validation: `start_date > end_date` rejected, `25:00` rejected, `start_time` without `end_time` rejected, anonymous rejected.
  - Privacy: user `alice` creates block, user `bob` lists → empty.
  - `hook.on_turn` with `ปิดเทอม 13-20 ต.ค.` → returns `needsConfirmation:true`, does not insert.

## Out of Scope

- Weekly recurrence (`ทุกจันทร์ 09:00-11:00`, `recurrence: weekly [Mon,Wed]`) — deferred to v2; v1 uses date-range blocks.
- Auto-rescheduling of tasks skipped due to `skip` blocks to the next available day — explicitly not done; tasks reappear via normal filter.
- Silent auto-creation from chat without confirmation — not done; confirmation required.
- Separate `class_slots`/`holidays` tables or fixed `type` enum — rejected per ADR 0002.
- UI/skill for visualizing calendar (e.g. month view) — not in this spec.
- Discord/Line/email integrations for calendar — not in this spec.
- Timezone handling beyond `YYYY-MM-DD`/`HH:mm` local time — out of scope.

## Further Notes

- Respects `CONTEXT.md` glossary: `Calendar Block`, `Work Schedule`, `Work Task`, `Private`, `Open WebUI User`.
- Respects ADR 0001 (single MCP server, SQLite, Private scoping) and ADR 0002 (flexible single-table design, nullable times, skip-wins, boost as tie-breaker).
- `effect` JSON is intentionally schemaless beyond the three keys to allow future extensions (e.g. `color`, `note`) without migration.
- `hook.on_turn` detection is heuristic and Thai-aware; it must be conservative (prefer false negative over false positive) since creation requires confirmation.
