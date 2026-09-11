import { describe, it, expect, beforeEach } from "vitest";
import { tools } from "../src/tools.js";
import { openDb, resetDb, closeDb } from "../src/db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function setupDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "bt-"));
  const dbPath = path.join(dir, "test.db");
  process.env.BUDDYTRAILS_DB = dbPath;
  const db = openDb(dbPath);
  resetDb(db);
  return db;
}

describe("scaffold", () => {
  beforeEach(() => { setupDb(); });

  it("health responds", async () => {
    const t = tools.find(x => x.name === "health")!;
    const res = await t.handler({});
    expect(res.status).toBe("ok");
  });

  it("lists tools", () => {
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.map(t => t.name)).toContain("knowledge.ingest");
    expect(tools.map(t => t.name)).toContain("idea.capture");
    expect(tools.map(t => t.name)).toContain("task.create");
  });

  it("knowledge ingest + search via MCP seam", async () => {
    const ingest = tools.find(x => x.name === "knowledge.ingest")!;
    const search = tools.find(x => x.name === "knowledge.search")!;
    await ingest.handler({ text: "MCP is a protocol for tools", source: "test" });
    await ingest.handler({ text: "Cats are cute", source: "test" });
    const res = await search.handler({ query: "MCP protocol", limit: 5 }) as any;
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].raw_text).toContain("MCP");
  });

  it("idea capture + suggest", async () => {
    const cap = tools.find(x => x.name === "idea.capture")!;
    const sug = tools.find(x => x.name === "idea.suggest")!;
    await cap.handler({ text: "Build a discord bot", tags: ["bot"] });
    await cap.handler({ text: "Write docs", tags: ["docs"] });
    const res = await sug.handler({ query: "discord bot", limit: 5 }) as any;
    expect(res.results[0].text).toContain("discord");
  });

  it("task create + list", async () => {
    const create = tools.find(x => x.name === "task.create")!;
    const list = tools.find(x => x.name === "task.list")!;
    await create.handler({ title: "Do homework", priority: 3, estimate_minutes: 30 });
    const res = await list.handler({}) as any;
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].title).toBe("Do homework");
  });

  it("raw task ingest + enrich", async () => {
    const ingest = tools.find(x => x.name === "task.ingest_raw")!;
    const enrich = tools.find(x => x.name === "task.enrich_raw")!;
    const list = tools.find(x => x.name === "task.list")!;
    const r = await ingest.handler({ items: ["Buy milk", "Call mom"] }) as any;
    expect(r.items.length).toBe(2);
    expect(r.items[0].raw_text).toBe("Buy milk");
    await enrich.handler({ items: r.items.map((it: any, i: number) => ({ temp_id: it.temp_id, priority: 2, estimate_minutes: 15 + i * 5 })) });
    const res = await list.handler({}) as any;
    expect(res.tasks.length).toBe(2);
  });

  it("get_today_schedule packs into window", async () => {
    const create = tools.find(x => x.name === "task.create")!;
    const sched = tools.find(x => x.name === "task.get_today_schedule")!;
    const today = new Date().toISOString().slice(0, 10);
    await create.handler({ title: "A", priority: 3, deadline: today, estimate_minutes: 60 });
    await create.handler({ title: "B", priority: 2, deadline: today, estimate_minutes: 30 });
    const res = await sched.handler({}) as any;
    expect(res.blocks.length).toBe(2);
    expect(res.blocks[0].priority).toBe(3);
  });
});
