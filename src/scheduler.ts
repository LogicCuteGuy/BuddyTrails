export type Task = {
  id: string;
  title: string;
  priority: number;
  deadline?: string | null;
  estimate_minutes?: number | null;
  status: string;
};

export type TimeBlock = {
  taskId: string;
  title: string;
  priority: number;
  start: string;
  end: string;
  estimate_minutes: number;
};

export type CalendarBlock = {
  id: string;
  user_id: string;
  label: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  effect: { skip?: boolean; window?: { start: string; end: string }; boost_tags?: string[] };
  created_at: string;
};

export type ScheduleResult = {
  date: string;
  workingWindow: { start: string; end: string };
  tasks: number;
  total_minutes: number;
  total_with_breaks: number;
  window_minutes: number;
  overflow: boolean;
  warning: string | null;
  blocks: TimeBlock[];
  activeBlock?: CalendarBlock | null;
  activeBlocks?: CalendarBlock[];
  blockedIntervals?: Array<{ start: string; end: string }>;
};

function toMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function toTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * Pure scheduler: (tasks, workingWindow, today, calendarBlocks?) -> timeBlocks
 * Filters deadline==today OR overdue priority=3, sorts ***> **> * -> deadline -> estimate,
 * packs into window with 10-min breaks, warns on overflow.
 * Calendar Blocks: skip wins, timed intervals unioned and subtracted, window overrides, boost_tags tie-breaker after priority.
 */
export function schedule(
  tasks: Task[],
  workingWindow: { start: string; end: string } = { start: "09:00", end: "18:00" },
  today: string = new Date().toISOString().slice(0, 10),
  calendarBlocks?: CalendarBlock[]
): ScheduleResult {
  const rawBlocks = calendarBlocks ?? [];
  // Normalize effect if stored as JSON string (from DB)
  const normalized: CalendarBlock[] = rawBlocks.map((b: any) => ({
    ...b,
    effect: typeof b.effect === "string" ? (() => { try { return JSON.parse(b.effect); } catch { return {}; } })() : (b.effect ?? {}),
  }));
  const activeBlocks = normalized.filter((b) => b.start_date <= today && b.end_date >= today);
  const skipBlock = activeBlocks.find((b) => b.effect?.skip === true);
  if (skipBlock) {
    const filtered = tasks.filter(
      (t) => t.status !== "done" && (t.deadline === today || (t.priority === 3 && t.deadline != null && t.deadline < today))
    );
    return {
      date: today,
      workingWindow,
      tasks: filtered.length,
      total_minutes: 0,
      total_with_breaks: 0,
      window_minutes: toMin(workingWindow.end) - toMin(workingWindow.start),
      overflow: false,
      warning: `ติด ${skipBlock.label} (${skipBlock.start_date}–${skipBlock.end_date})`,
      blocks: [],
      activeBlock: skipBlock,
      activeBlocks,
    };
  }

  // Collect boost tags from all active blocks
  const boostTags: string[] = [];
  for (const b of activeBlocks) {
    if (b.effect?.boost_tags) boostTags.push(...b.effect.boost_tags.map((t) => t.toLowerCase()));
  }

  // Compute effective window: apply window override (last wins, or intersect if multiple)
  // If multiple windows, take the most restrictive intersection; if empty, return no-window result
  let effStart = toMin(workingWindow.start);
  let effEnd = toMin(workingWindow.end);
  const windowBlocks = activeBlocks.filter((b) => b.effect?.window);
  if (windowBlocks.length > 0) {
    // Intersect all windows with workingWindow
    for (const b of windowBlocks) {
      const ws = toMin(b.effect.window!.start);
      const we = toMin(b.effect.window!.end);
      effStart = Math.max(effStart, ws);
      effEnd = Math.min(effEnd, we);
    }
    if (effStart >= effEnd) {
      return {
        date: today,
        workingWindow: { start: toTime(effStart), end: toTime(effEnd) },
        tasks: tasks.filter((t) => t.status !== "done" && (t.deadline === today || (t.priority === 3 && t.deadline != null && t.deadline < today))).length,
        total_minutes: 0,
        total_with_breaks: 0,
        window_minutes: 0,
        overflow: false,
        warning: "No available window (conflicting Calendar Blocks)",
        blocks: [],
        activeBlock: activeBlocks[0] ?? null,
        activeBlocks,
        blockedIntervals: [],
      };
    }
  }
  // Collect blocked intervals (start_time/end_time) and subtract
  const intervals: Array<[number, number]> = [];
  for (const b of activeBlocks) {
    if (b.start_time && b.end_time) {
      const s = toMin(b.start_time);
      const e = toMin(b.end_time);
      // Clamp to effective window
      const cs = Math.max(s, effStart);
      const ce = Math.min(e, effEnd);
      if (cs < ce) intervals.push([cs, ce]);
    }
  }
  // Union intervals
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of intervals) {
    if (merged.length === 0 || iv[0] > merged[merged.length - 1][1]) merged.push([...iv]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
  }
  // Effective window minutes = (effEnd - effStart) - blocked
  let blockedMin = 0;
  for (const [s, e] of merged) blockedMin += e - s;
  const windowMin = Math.max(0, effEnd - effStart - blockedMin);
  const effectiveWindow = { start: toTime(effStart), end: toTime(effEnd) };

  const filtered = tasks.filter(
    (t) => t.status !== "done" && (t.deadline === today || (t.priority === 3 && t.deadline != null && t.deadline < today))
  );
  const sorted = [...filtered].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // boost_tags tie-breaker after priority
    if (boostTags.length > 0) {
      const aBoost = boostTags.some((tag) => a.title.toLowerCase().includes(tag)) ? 1 : 0;
      const bBoost = boostTags.some((tag) => b.title.toLowerCase().includes(tag)) ? 1 : 0;
      if (bBoost !== aBoost) return bBoost - aBoost;
    }
    const dl = (a.deadline || "").localeCompare(b.deadline || "");
    if (dl !== 0) return dl;
    return (a.estimate_minutes || 0) - (b.estimate_minutes || 0);
  });

  // Pack tasks sequentially, never overlapping blocked intervals
  function advancePastBlocked(pos: number): number {
    for (const [s, e] of merged) {
      if (pos >= s && pos < e) return e;
    }
    return pos;
  }
  function nextBlockedStart(pos: number): number | null {
    for (const [s] of merged) if (s > pos) return s;
    return null;
  }
  let cursor = advancePastBlocked(effStart);
  const blocks: TimeBlock[] = [];
  let total = 0;
  for (const t of sorted) {
    const est = t.estimate_minutes ?? 30;
    total += est;
    cursor = advancePastBlocked(cursor);
    // If task would cross into a blocked interval, jump to after it
    let blockStart = cursor;
    let blockEnd = blockStart + est;
    const nextStart = nextBlockedStart(blockStart);
    if (nextStart !== null && blockEnd > nextStart) {
      // Find the blocked interval that starts at nextStart
      const hit = merged.find(([s]) => s === nextStart)!;
      blockStart = hit[1];
      blockStart = advancePastBlocked(blockStart);
      blockEnd = blockStart + est;
    }
    blocks.push({
      taskId: t.id,
      title: t.title,
      priority: t.priority,
      start: toTime(blockStart),
      end: toTime(blockEnd),
      estimate_minutes: est,
    });
    cursor = blockEnd + 10;
    cursor = advancePastBlocked(cursor);
  }
  const totalWithBreaks = blocks.length > 0 ? total + 10 * (blocks.length - 1) : 0;
  const overflow = totalWithBreaks > windowMin;
  const warning: string | null = overflow ? `Overflow by ${totalWithBreaks - windowMin} minutes` : null;
  return {
    date: today,
    workingWindow: effectiveWindow,
    tasks: sorted.length,
    total_minutes: total,
    total_with_breaks: totalWithBreaks,
    window_minutes: windowMin,
    overflow,
    warning,
    blocks,
    activeBlock: activeBlocks[0] ?? null,
    activeBlocks,
    blockedIntervals: merged.map(([s, e]) => ({ start: toTime(s), end: toTime(e) })),
  };
}
