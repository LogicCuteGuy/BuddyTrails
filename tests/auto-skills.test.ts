import { describe, it, expect, beforeEach } from "vitest";
import { tools } from "../src/tools.js";
import { openDb, resetDb, closeDb } from "../src/db.js";
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

describe("knowledge auto-skills (#8)", () => {
  beforeEach(() => setupDb());

  it("knowledge.summarize returns summary with sources", async () => {
    const ingest = tools.find((x) => x.name === "knowledge.ingest")!;
    const summarize = tools.find((x) => x.name === "knowledge.summarize")!;
    await ingest.handler({ text: "MCP is a protocol for AI tools", source: "test" });
    await ingest.handler({ text: "MCP enables knowledge sharing", source: "test" });
    const res = (await summarize.handler({ query: "MCP", topK: 5 })) as any;
    expect(res.summary).toBeTruthy();
    expect(res.sources).toBeGreaterThan(0);
  });

  it("knowledge.export dumps markdown/json", async () => {
    const ingest = tools.find((x) => x.name === "knowledge.ingest")!;
    const exp = tools.find((x) => x.name === "knowledge.export")!;
    await ingest.handler({ text: "Export me", source: "test" });
    const md = (await exp.handler({ format: "markdown" })) as any;
    expect(md.format).toBe("markdown");
    expect(md.count).toBe(1);
    const js = (await exp.handler({ format: "json" })) as any;
    expect(js.format).toBe("json");
    expect(js.data.length).toBe(1);
  });

  it("knowledge.retag merges tags", async () => {
    const ingest = tools.find((x) => x.name === "knowledge.ingest")!;
    const retag = tools.find((x) => x.name === "knowledge.retag")!;
    await ingest.handler({ text: "Tagged entry", tags: ["old-tag"], source: "test" });
    const res = (await retag.handler({ from: "old-tag", to: "new-tag" })) as any;
    expect(res.updated).toBe(1);
    const search = tools.find((x) => x.name === "knowledge.search")!;
    const s = (await search.handler({ query: "Tagged", limit: 5 })) as any;
    expect(s.results[0].tags).toContain("new-tag");
  });
});

describe("idea auto-skills (#9)", () => {
  beforeEach(() => setupDb());

  it("idea.brainstorm generates and captures ideas", async () => {
    const brainstorm = tools.find((x) => x.name === "idea.brainstorm")!;
    const list = tools.find((x) => x.name === "idea.list")!;
    const res = (await brainstorm.handler({ prompt: "onboarding", count: 3 })) as any;
    expect(res.ids.length).toBe(3);
    const ideas = (await list.handler({ limit: 10 })) as any;
    expect(ideas.ideas.length).toBe(3);
  });

  it("idea.cluster groups ideas", async () => {
    const capture = tools.find((x) => x.name === "idea.capture")!;
    const cluster = tools.find((x) => x.name === "idea.cluster")!;
    await capture.handler({ text: "Idea A" });
    await capture.handler({ text: "Idea B" });
    const res = (await cluster.handler({})) as any;
    expect(res.clusters.length).toBeGreaterThan(0);
    expect(res.clusters[0].size).toBe(2);
  });

  it("idea.refine rewrites and re-embeds", async () => {
    const capture = tools.find((x) => x.name === "idea.capture")!;
    const refine = tools.find((x) => x.name === "idea.refine")!;
    const c = (await capture.handler({ text: "Original idea" })) as any;
    const r = (await refine.handler({ id: c.id, instruction: "make it better" })) as any;
    expect(r.text).toContain("make it better");
  });
});

describe("task auto-skills (#10)", () => {
  beforeEach(() => setupDb());

  it("task.breakdown splits into subtasks", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const breakdown = tools.find((x) => x.name === "task.breakdown")!;
    const c = (await create.handler({ title: "Big task", priority: 2, estimate_minutes: 60 })) as any;
    const res = (await breakdown.handler({ id: c.id })) as any;
    expect(res.subtasks.length).toBe(3);
    expect(res.subtasks[0].estimate_minutes).toBeGreaterThan(0);
  });

  it("task.pomodoro start/done logs session", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const pomo = tools.find((x) => x.name === "task.pomodoro")!;
    const c = (await create.handler({ title: "Focus task", priority: 2, estimate_minutes: 30 })) as any;
    const s = (await pomo.handler({ id: c.id, action: "start" })) as any;
    expect(s.sessionId).toBeTruthy();
    const d = (await pomo.handler({ id: c.id, action: "done" })) as any;
    expect(d.duration_minutes).toBe(25);
  });

  it("task.time_log returns actual vs estimate", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const pomo = tools.find((x) => x.name === "task.pomodoro")!;
    const timeLog = tools.find((x) => x.name === "task.time_log")!;
    const c = (await create.handler({ title: "Timed task", priority: 2, estimate_minutes: 30 })) as any;
    await pomo.handler({ id: c.id, action: "start" });
    await pomo.handler({ id: c.id, action: "done" });
    const res = (await timeLog.handler({ id: c.id })) as any;
    expect(res.estimate_minutes).toBe(30);
    expect(res.actual_minutes).toBe(25);
  });
});

describe("cross-cutting (#11)", () => {
  beforeEach(() => setupDb());

  it("brief.daily returns schedule + ideas + knowledge", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const capture = tools.find((x) => x.name === "idea.capture")!;
    const ingest = tools.find((x) => x.name === "knowledge.ingest")!;
    const today = new Date().toISOString().slice(0, 10);
    await create.handler({ title: "Daily task", priority: 3, deadline: today, estimate_minutes: 30 });
    await capture.handler({ text: "Daily idea" });
    await ingest.handler({ text: "Daily knowledge", source: "test" });
    const brief = tools.find((x) => x.name === "brief.daily")!;
    const res = (await brief.handler({})) as any;
    expect(res.tasks.length).toBeGreaterThan(0);
    expect(res.topIdeas.length).toBeGreaterThan(0);
    expect(res.relatedKnowledge.length).toBeGreaterThan(0);
  });

  it("brief.weekly returns done/overdue + ideas", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const brief = tools.find((x) => x.name === "brief.weekly")!;
    await create.handler({ title: "Done task", priority: 2, estimate_minutes: 30, status: "done" });
    const res = (await brief.handler({})) as any;
    expect(res.done.length).toBeGreaterThan(0);
  });

  it("search.all unified search", async () => {
    const ingest = tools.find((x) => x.name === "knowledge.ingest")!;
    const capture = tools.find((x) => x.name === "idea.capture")!;
    const create = tools.find((x) => x.name === "task.create")!;
    await ingest.handler({ text: "Search knowledge", source: "test" });
    await capture.handler({ text: "Search idea" });
    await create.handler({ title: "Search task", priority: 2, estimate_minutes: 30 });
    const search = tools.find((x) => x.name === "search.all")!;
    const res = (await search.handler({ query: "Search" })) as any;
    expect(res.knowledge.length).toBeGreaterThan(0);
    expect(res.ideas.length).toBeGreaterThan(0);
    expect(res.tasks.length).toBeGreaterThan(0);
  });
});

describe("discord bot (#12)", () => {
  beforeEach(() => setupDb());

  it("task.remind + task.due_soon", async () => {
    const create = tools.find((x) => x.name === "task.create")!;
    const remind = tools.find((x) => x.name === "task.remind")!;
    const dueSoon = tools.find((x) => x.name === "task.due_soon")!;
    const today = new Date().toISOString().slice(0, 10);
    const c = (await create.handler({ title: "Remind task", priority: 3, deadline: today, estimate_minutes: 30 })) as any;
    const r = (await remind.handler({ taskId: c.id, at: new Date().toISOString() })) as any;
    expect(r.id).toBeTruthy();
    const d = (await dueSoon.handler({ within: "24h" })) as any;
    expect(d.tasks.length).toBeGreaterThan(0);
  });
});

describe("skills & surfaces (#7)", () => {
  it("all MCP tools are registered and callable", () => {
    expect(tools.length).toBeGreaterThan(30);
    expect(tools.map((t) => t.name)).toContain("knowledge.ingest");
    expect(tools.map((t) => t.name)).toContain("hook.on_turn");
    expect(tools.map((t) => t.name)).toContain("conversation.set_opt_out");
  });

  it("hook.on_turn respects opt-out", async () => {
    setupDb();
    const setOptOut = tools.find((x) => x.name === "conversation.set_opt_out")!;
    const hook = tools.find((x) => x.name === "hook.on_turn")!;
    await setOptOut.handler({ conversation_id: "conv-opt", opt_out: true });
    const res = (await hook.handler({ text: "secret", role: "user", conversation_id: "conv-opt" })) as any;
    expect(res.skipped).toBe(true);
  });
});
