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

describe("calendar.* CRUD", () => {
  beforeEach(() => setupDb());

  it("calendar.set creates and calendar.list returns it", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      const list = tools.find((x) => x.name === "calendar.list")!;
      const res = (await set.handler({ label: "ปิดเทอม", start_date: "2026-10-13", end_date: "2026-10-20", effect: { skip: true } })) as any;
      expect(res.id).toBeTruthy();
      expect(res.label).toBe("ปิดเทอม");
      const l = (await list.handler({})) as any;
      expect(l.blocks.length).toBe(1);
      expect(l.blocks[0].label).toBe("ปิดเทอม");
      expect(l.blocks[0].effect.skip).toBe(true);
    });
  });

  it("calendar.set with timed block", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      const res = (await set.handler({ label: "สอบ", start_date: "2026-09-15", end_date: "2026-09-19", start_time: "09:00", end_time: "12:00", effect: { boost_tags: ["สอบ"] } })) as any;
      expect(res.start_time).toBe("09:00");
      expect(res.end_time).toBe("12:00");
    });
  });

  it("calendar.set validates start_date > end_date", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-20", end_date: "2026-10-13", effect: { skip: true } })).rejects.toThrow(/start_date must be <= end_date/);
    });
  });

  it("calendar.set validates start_time without end_time", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "09:00", effect: { skip: true } } as any)).rejects.toThrow(/both be provided/);
    });
  });

  it("calendar.set validates start_time >= end_time", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "12:00", end_time: "09:00", effect: { skip: true } })).rejects.toThrow(/start_time must be < end_time/);
    });
  });

  it("calendar.set validates effect or time required", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13" } as any)).rejects.toThrow(/effect or time required/);
    });
  });

  it("calendar.set validates window start < end", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13", effect: { window: { start: "18:00", end: "09:00" } } })).rejects.toThrow(/effect\.window\.start must be < effect\.window\.end/);
    });
  });

  it("calendar.set rejects anonymous", async () => {
    await withUser("anonymous", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13", effect: { skip: true } })).rejects.toThrow(/Missing X-User-Id/);
    });
  });

  it("calendar.list is private per user", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await set.handler({ label: "alice block", start_date: "2026-10-13", end_date: "2026-10-13", effect: { skip: true } });
    });
    await withUser("bob", async () => {
      const list = tools.find((x) => x.name === "calendar.list")!;
      const l = (await list.handler({})) as any;
      expect(l.blocks.length).toBe(0);
    });
    await withUser("alice", async () => {
      const list = tools.find((x) => x.name === "calendar.list")!;
      const l = (await list.handler({})) as any;
      expect(l.blocks.length).toBe(1);
    });
  });

  it("calendar.list ordered by start_date ASC", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await set.handler({ label: "b", start_date: "2026-10-20", end_date: "2026-10-20", effect: { skip: true } });
      await set.handler({ label: "a", start_date: "2026-10-13", end_date: "2026-10-13", effect: { skip: true } });
      const list = tools.find((x) => x.name === "calendar.list")!;
      const l = (await list.handler({})) as any;
      expect(l.blocks[0].label).toBe("a");
      expect(l.blocks[1].label).toBe("b");
    });
  });

  it("calendar.delete is idempotent and private", async () => {
    let id: string;
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      const res = (await set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13", effect: { skip: true } })) as any;
      id = res.id;
    });
    await withUser("bob", async () => {
      const del = tools.find((x) => x.name === "calendar.delete")!;
      const res = (await del.handler({ id })) as any;
      expect(res.deleted).toBe(id);
      // alice's block still exists
    });
    await withUser("alice", async () => {
      const list = tools.find((x) => x.name === "calendar.list")!;
      const l = (await list.handler({})) as any;
      expect(l.blocks.length).toBe(1);
    });
    await withUser("alice", async () => {
      const del = tools.find((x) => x.name === "calendar.delete")!;
      await del.handler({ id });
      const list = tools.find((x) => x.name === "calendar.list")!;
      const l = (await list.handler({})) as any;
      expect(l.blocks.length).toBe(0);
      // second delete idempotent
      const res2 = (await del.handler({ id })) as any;
      expect(res2.deleted).toBe(id);
    });
  });

  it("calendar.delete rejects anonymous", async () => {
    await withUser("anonymous", async () => {
      const del = tools.find((x) => x.name === "calendar.delete")!;
      await expect(del.handler({ id: "x" })).rejects.toThrow(/Missing X-User-Id/);
    });
  });

  it("calendar.list rejects anonymous", async () => {
    await withUser("anonymous", async () => {
      const list = tools.find((x) => x.name === "calendar.list")!;
      await expect(list.handler({})).rejects.toThrow(/Missing X-User-Id/);
    });
  });

  it("calendar.set with only times (no effect) succeeds", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      const res = (await set.handler({ label: "เรียน", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "09:00", end_time: "11:00" } as any)) as any;
      expect(res.start_time).toBe("09:00");
      expect(res.end_time).toBe("11:00");
    });
  });

  it("calendar.set with window alone succeeds", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      const res = (await set.handler({ label: "สอบบ่าย", start_date: "2026-10-13", end_date: "2026-10-13", effect: { window: { start: "13:00", end: "18:00" } } })) as any;
      expect(res.effect.window.start).toBe("13:00");
    });
  });

  it("calendar.set with boost_tags alone succeeds", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      const res = (await set.handler({ label: "สอบ", start_date: "2026-10-13", end_date: "2026-10-13", effect: { boost_tags: ["สอบ"] } })) as any;
      expect(res.effect.boost_tags).toEqual(["สอบ"]);
    });
  });

  it("calendar.set rejects invalid calendar date 2026-02-30", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-02-30", end_date: "2026-02-30", effect: { skip: true } })).rejects.toThrow(/is not a valid calendar date/);
    });
  });

  it("calendar.set rejects invalid time 24:00", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "24:00", end_time: "25:00", effect: { skip: true } } as any)).rejects.toThrow(/HH:mm/);
    });
  });

  it("calendar.set trims label and respects trimmed length", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      const label = "   " + "a".repeat(100) + "   ";
      const res = (await set.handler({ label, start_date: "2026-10-13", end_date: "2026-10-13", effect: { skip: true } })) as any;
      expect(res.label).toBe("a".repeat(100));
      expect(res.label.length).toBe(100);
    });
  });

  it("calendar.set rejects non-string boost_tag", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await expect(set.handler({ label: "x", start_date: "2026-10-13", end_date: "2026-10-13", effect: { boost_tags: ["ok", 123 as any] } } as any)).rejects.toThrow(/each boost_tag must be a string/);
    });
  });

  it("calendar.list same start_date ordered by created_at", async () => {
    await withUser("alice", async () => {
      const set = tools.find((x) => x.name === "calendar.set")!;
      await set.handler({ label: "second", start_date: "2026-10-13", end_date: "2026-10-13", effect: { skip: true } });
      // small delay to ensure different created_at
      await new Promise((r) => setTimeout(r, 5));
      await set.handler({ label: "third", start_date: "2026-10-13", end_date: "2026-10-13", effect: { boost_tags: ["x"] } });
      const list = tools.find((x) => x.name === "calendar.list")!;
      const l = (await list.handler({})) as any;
      // Both have same start_date, should be ordered by created_at ASC
      expect(l.blocks[0].label).toBe("second");
      expect(l.blocks[1].label).toBe("third");
    });
  });
});
