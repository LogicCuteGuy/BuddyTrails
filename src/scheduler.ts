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
};

function toMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function toTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * Pure scheduler: (tasks, workingWindow) -> timeBlocks
 * Filters deadline==today OR overdue priority=3, sorts ***> **> * -> deadline -> estimate,
 * packs into window with 10-min breaks, warns on overflow.
 */
export function schedule(
  tasks: Task[],
  workingWindow: { start: string; end: string } = { start: "09:00", end: "18:00" },
  today: string = new Date().toISOString().slice(0, 10)
): ScheduleResult {
  const filtered = tasks.filter(
    (t) => t.status !== "done" && (t.deadline === today || (t.priority === 3 && t.deadline != null && t.deadline < today))
  );
  const sorted = [...filtered].sort(
    (a, b) => b.priority - a.priority || (a.deadline || "").localeCompare(b.deadline || "") || (a.estimate_minutes || 0) - (b.estimate_minutes || 0)
  );

  const startMin = toMin(workingWindow.start);
  const endMin = toMin(workingWindow.end);
  const windowMin = endMin - startMin;
  let cursor = startMin;
  const blocks: TimeBlock[] = [];
  let total = 0;
  for (const t of sorted) {
    const est = t.estimate_minutes ?? 30;
    total += est;
    const blockStart = cursor;
    const blockEnd = cursor + est;
    blocks.push({
      taskId: t.id,
      title: t.title,
      priority: t.priority,
      start: toTime(blockStart),
      end: toTime(blockEnd),
      estimate_minutes: est,
    });
    cursor = blockEnd + 10;
  }
  const totalWithBreaks = blocks.length > 0 ? total + 10 * (blocks.length - 1) : 0;
  const overflow = totalWithBreaks > windowMin;
  return {
    date: today,
    workingWindow,
    tasks: sorted.length,
    total_minutes: total,
    total_with_breaks: totalWithBreaks,
    window_minutes: windowMin,
    overflow,
    warning: overflow ? `Overflow by ${totalWithBreaks - windowMin} minutes` : null,
    blocks,
  };
}
