import { describe, it, expect, beforeEach } from "vitest";
import { tools } from "../src/tools.js";
import { openDb, resetDb, closeDb } from "../src/db.js";
import { requestContext } from "../src/context.js";
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
async function withUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ userId }, fn);
}

describe("calendar integration: get_today_schedule + brief.daily + hook.on_turn", () => {
  beforeEach(() => setupDb());

  it("get_today_schedule with skip block returns empty + warning", async () => {
    await withUser("alice", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const create = tools.find((x) => x.name === "task.create")!;
      const calSet = tools.find((x) => x.name === "calendar.set")!;
      const sched = tools.find((x) => x.name === "task.get_today_schedule")!;
      await create.handler({ title: "Task A", priority: 3, deadline: today, estimate_minutes: 60 });
      await calSet.handler({ label: "ปิดเทอม", start_date: today, end_date: today, effect: { skip: true } });
      const res = (await sched.handler({})) as any;
      expect(res.blocks.length).toBe(0);
      expect(res.warning).toContain("ปิดเทอม");
      expect(res.activeBlock).toBeTruthy();
      expect(res.activeBlocks.length).toBe(1);
    });
  });

  it("get_today_schedule with timed block shrinks window", async () => {
    await withUser("alice", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const create = tools.find((x) => x.name === "task.create")!;
      const calSet = tools.find((x) => x.name === "calendar.set")!;
      const sched = tools.find((x) => x.name === "task.get_today_schedule")!;
      await create.handler({ title: "Task A", priority: 3, deadline: today, estimate_minutes: 60 });
      await calSet.handler({ label: "เรียน", start_date: today, end_date: today, start_time: "09:00", end_time: "12:00", effect: { skip: false } as any });
      // Need effect or time: times alone is valid, but we pass skip:false which is falsy -> need boost or window or skip true
      // Actually times alone is valid without effect, so use that
      const res = (await sched.handler({})) as any;
      // The block has start_time/end_time, so window should be reduced
      expect(res.window_minutes).toBeLessThan(540);
    });
  });

  it("brief.daily includes activeBlock", async () => {
    await withUser("alice", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const calSet = tools.find((x) => x.name === "calendar.set")!;
      const brief = tools.find((x) => x.name === "brief.daily")!;
      await calSet.handler({ label: "สอบ", start_date: today, end_date: today, effect: { boost_tags: ["สอบ"] } });
      const res = (await brief.handler({})) as any;
      expect(res.activeBlock).toBeTruthy();
      expect(res.activeBlock.label).toBe("สอบ");
      expect(res.activeBlocks.length).toBe(1);
    });
  });

  it("hook.on_turn detects Thai with date and does not write DB", async () => {
    await withUser("alice", async () => {
      const hook = tools.find((x) => x.name === "hook.on_turn")!;
      const list = tools.find((x) => x.name === "calendar.list")!;
      const res = (await hook.handler({ text: "ปิดเทอม 13-20 ต.ค. ครับ", role: "user" })) as any;
      expect(res.detectedCalendarBlock).toBeTruthy();
      expect(res.needsConfirmation).toBe(true);
      expect(res.detectedCalendarBlock.label).toBe("ปิดเทอม");
      // No DB write
      const l = (await list.handler({})) as any;
      expect(l.blocks.length).toBe(0);
    });
  });

  it("hook.on_turn detects ISO date", async () => {
    await withUser("alice", async () => {
      const hook = tools.find((x) => x.name === "hook.on_turn")!;
      const res = (await hook.handler({ text: "สอบ 2026-10-13 ครับ", role: "user" })) as any;
      expect(res.detectedCalendarBlock).toBeTruthy();
      expect(res.detectedCalendarBlock.start_date).toBe("2026-10-13");
    });
  });

  it("hook.on_turn no false positive on casual chat", async () => {
    await withUser("alice", async () => {
      const hook = tools.find((x) => x.name === "hook.on_turn")!;
      const res = (await hook.handler({ text: "วันนี้อากาศดีจัง ไปเที่ยวกัน", role: "user" })) as any;
      expect(res.detectedCalendarBlock).toBeUndefined();
      expect(res.needsConfirmation).toBeUndefined();
    });
  });

  it("hook.on_turn keyword without date does not trigger", async () => {
    await withUser("alice", async () => {
      const hook = tools.find((x) => x.name === "hook.on_turn")!;
      const res = (await hook.handler({ text: "ปิดเทอมแล้ว เย้", role: "user" })) as any;
      expect(res.detectedCalendarBlock).toBeUndefined();
    });
  });

  it("hook.on_turn respects opt-out", async () => {
    await withUser("alice", async () => {
      const setOpt = tools.find((x) => x.name === "conversation.set_opt_out")!;
      const hook = tools.find((x) => x.name === "hook.on_turn")!;
      await setOpt.handler({ conversation_id: "conv1", opt_out: true });
      const res = (await hook.handler({ text: "ปิดเทอม 13-20 ต.ค.", role: "user", conversation_id: "conv1" })) as any;
      expect(res.skipped).toBe(true);
    });
  });

  it("hook.on_turn still ingests knowledge", async () => {
    await withUser("alice", async () => {
      const hook = tools.find((x) => x.name === "hook.on_turn")!;
      const res = (await hook.handler({ text: "ปิดเทอม 13-20 ต.ค. ครับ", role: "user" })) as any;
      expect(res.ingested).toBeTruthy();
    });
  });
});
