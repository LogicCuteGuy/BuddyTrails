import { describe, it, expect, beforeEach } from "vitest";
import { tools } from "../src/tools.js";
import { openDb, resetDb, closeDb } from "../src/db.js";
import { schedule } from "../src/scheduler.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function setupDb() {
  closeDb();
  const dir = mkdtempSync(path.join(tmpdir(), "bt-"));
  const dbPath = path.join(dir, "test.db");
  process.env.BUDDYTRAILS_DB = dbPath;
  const db = openDb(dbPath);
  resetDb(db);
  return db;
}

describe("pure scheduler", () => {
  it("empty day returns no blocks", () => {
    const res = schedule([], { start: "09:00", end: "18:00" }, "2026-09-11");
    expect(res.blocks.length).toBe(0);
    expect(res.overflow).toBe(false);
  });

  it("sorts by priority *** > ** > *", () => {
    const tasks = [
      { id: "1", title: "Low", priority: 1, deadline: "2026-09-11", estimate_minutes: 30, status: "todo" },
      { id: "2", title: "High", priority: 3, deadline: "2026-09-11", estimate_minutes: 30, status: "todo" },
      { id: "3", title: "Mid", priority: 2, deadline: "2026-09-11", estimate_minutes: 30, status: "todo" },
    ];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, "2026-09-11");
    expect(res.blocks[0].priority).toBe(3);
    expect(res.blocks[1].priority).toBe(2);
    expect(res.blocks[2].priority).toBe(1);
  });

  it("includes overdue 3* tasks", () => {
    const tasks = [
      { id: "1", title: "Overdue High", priority: 3, deadline: "2026-09-10", estimate_minutes: 30, status: "todo" },
      { id: "2", title: "Today Low", priority: 1, deadline: "2026-09-11", estimate_minutes: 30, status: "todo" },
    ];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, "2026-09-11");
    expect(res.blocks.length).toBe(2);
    expect(res.blocks[0].title).toBe("Overdue High");
  });

  it("excludes overdue non-3* tasks", () => {
    const tasks = [
      { id: "1", title: "Overdue Low", priority: 1, deadline: "2026-09-10", estimate_minutes: 30, status: "todo" },
    ];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, "2026-09-11");
    expect(res.blocks.length).toBe(0);
  });

  it("warns on overflow including breaks", () => {
    const tasks = [
      { id: "1", title: "A", priority: 3, deadline: "2026-09-11", estimate_minutes: 300, status: "todo" },
      { id: "2", title: "B", priority: 3, deadline: "2026-09-11", estimate_minutes: 300, status: "todo" },
    ];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, "2026-09-11");
    // 600 + 10 break = 610 > 540 window
    expect(res.overflow).toBe(true);
    expect(res.warning).toContain("Overflow");
  });

  it("packs with 10-min breaks", () => {
    const tasks = [
      { id: "1", title: "A", priority: 3, deadline: "2026-09-11", estimate_minutes: 60, status: "todo" },
      { id: "2", title: "B", priority: 2, deadline: "2026-09-11", estimate_minutes: 30, status: "todo" },
    ];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, "2026-09-11");
    expect(res.blocks[0].start).toBe("09:00");
    expect(res.blocks[0].end).toBe("10:00");
    expect(res.blocks[1].start).toBe("10:10");
    expect(res.blocks[1].end).toBe("10:40");
  });
});

describe("task.get_today_schedule + suggest_next + promote via MCP seam", () => {
  beforeEach(() => setupDb());

  it("4 tasks due today -> time-blocked schedule + next action with related knowledge", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const ingest = tools.find((x) => x.name === "knowledge.ingest")!;
    const today = new Date().toISOString().slice(0, 10);
    await ingest.handler({ text: "MCP knowledge about scheduling", source: "test" });
    await create.handler({ title: "Task A", priority: 3, deadline: today, estimate_minutes: 60 });
    await create.handler({ title: "Task B", priority: 2, deadline: today, estimate_minutes: 30 });
    await create.handler({ title: "Task C", priority: 1, deadline: today, estimate_minutes: 30 });
    await create.handler({ title: "Task D", priority: 3, deadline: today, estimate_minutes: 30 });

    const sched = tools.find((x) => x.name === "task.get_today_schedule")!;
    const res = (await sched.handler({})) as any;
    expect(res.blocks.length).toBe(4);
    expect(res.blocks[0].priority).toBe(3);

    const suggest = tools.find((x) => x.name === "task.suggest_next")!;
    const s = (await suggest.handler({})) as any;
    expect(s.task).toBeTruthy();
    expect(s.relatedKnowledge.length).toBeGreaterThan(0);
  });

  it("idea.promote_to_task creates task and sets promoted_task_id", async () => {
    const capture = tools.find((x) => x.name === "idea.capture")!;
    const promote = tools.find((x) => x.name === "idea.promote_to_task")!;
    const list = tools.find((x) => x.name === "task.list")!;
    const c = (await capture.handler({ text: "My great idea", tags: ["test"] })) as any;
    const p = (await promote.handler({ id: c.id, priority: 3 })) as any;
    expect(p.taskId).toBeTruthy();
    const tasks = (await list.handler({})) as any;
    expect(tasks.tasks.find((t: any) => t.id === p.taskId)).toBeTruthy();
    // Verify promoted_task_id set
    const ideaGet = tools.find((x) => x.name === "idea.suggest")!;
    const ideas = (await ideaGet.handler({ query: "great idea", limit: 5 })) as any;
    const promoted = ideas.results.find((r: any) => r.id === c.id);
    expect(promoted.promoted_task_id).toBe(p.taskId);
  });

  it("suggest_next returns top task + related knowledge/ideas", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const capture = tools.find((x) => x.name === "idea.capture")!;
    const ingest = tools.find((x) => x.name === "knowledge.ingest")!;
    await ingest.handler({ text: "Knowledge for suggest", source: "test" });
    await capture.handler({ text: "Idea for suggest" });
    await create.handler({ title: "Top task", priority: 3, estimate_minutes: 30 });
    const suggest = tools.find((x) => x.name === "task.suggest_next")!;
    const res = (await suggest.handler({})) as any;
    expect(res.task.title).toBe("Top task");
    expect(res.relatedKnowledge.length).toBeGreaterThan(0);
    expect(res.relatedIdeas.length).toBeGreaterThan(0);
  });
});
