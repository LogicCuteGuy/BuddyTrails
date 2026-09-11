---
name: buddytrails-time
description: Time management for Work Tasks — scheduling, pomodoro, time logging, and daily/weekly briefs. Use when the user asks about time blocks, estimates vs actuals, pomodoro, today's schedule, or wants to manage time for tasks.
---

# BuddyTrails Time

Manage **estimate vs actual** and **time blocks** for Work Tasks.

## Vocabulary

- **Work Schedule** — time-blocked plan for today (`task.get_today_schedule { workingWindow: { start, end } }`). Filters `deadline == today` OR overdue `priority=3★`, sorted `priority DESC, deadline ASC`, packed into window (default 09:00–18:00) with breaks; warns on overflow.
- **Pomodoro** — `task.pomodoro { id, action: "start"|"pause"|"done" }` → `pomodoro_sessions: id, task_id, started_at, ended_at, duration_minutes, user_id`.
- **Time Log** — `task.time_log { id? }` → `estimate_minutes` vs `actual_minutes` (sum of pomodoro durations).

## Flows

### Today's schedule

1. `task.get_today_schedule` → blocks with `start, end, title, priority`.
2. If overflow, suggest: move 1★ to tomorrow, split via `task.breakdown`, or extend window.

### Pomodoro

1. `task.pomodoro { id, action: "start" }` → sessionId.
2. On finish: `task.pomodoro { id, action: "done" }` → `duration_minutes: 25`.
3. Check `task.time_log { id }` for actual vs estimate.

### Breakdown

`task.breakdown { id }` → 3 subtasks, each `estimate_minutes = max(10, floor(est/3))`, same priority/deadline.

### Briefs

- `brief.daily` → today's tasks (deadline today OR overdue 3★) + top Ideas + Knowledge.
- `brief.weekly` → done + overdue + ideas.
- `task.due_soon { within: "24h"|"3d" }` → deadline window.
- `task.suggest_next` → top-ranked task + related Knowledge/Ideas.

## Rules

- All task/time tools are private per `X-User-Id` (`user_id` filter); `knowledge.*` is shared.
- Validate `estimate_minutes >= 1`, `priority 1-3`, `deadline` as `YYYY-MM-DD`.
- Don't start pomodoro without a valid `task.id` owned by the user.
