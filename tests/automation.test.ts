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

describe("automation.* dynamic", () => {
  beforeEach(() => setupDb());

  it("create + list + delete", async () => {
    await withUser("alice", async () => {
      const create = tools.find((x) => x.name === "automation.create")!;
      const list = tools.find((x) => x.name === "automation.list")!;
      const del = tools.find((x) => x.name === "automation.delete")!;
      const res = (await create.handler({ name: "Morning", message: "08:30 แล้วค้าบ", rrule: "FREQ=DAILY", dtstart: "DTSTART:20260913T083000" })) as any;
      expect(res.id).toBeTruthy();
      expect(res.enabled).toBe(true);
      const l = (await list.handler({})) as any;
      expect(l.automations.length).toBe(1);
      expect(l.automations[0].name).toBe("Morning");
      await del.handler({ id: res.id });
      const l2 = (await list.handler({})) as any;
      expect(l2.automations.length).toBe(0);
    });
  });

  it("update name/message/rrule/enabled", async () => {
    await withUser("alice", async () => {
      const create = tools.find((x) => x.name === "automation.create")!;
      const update = tools.find((x) => x.name === "automation.update")!;
      const res = (await create.handler({ name: "Test", message: "hello", rrule: "FREQ=DAILY", dtstart: "DTSTART:20260913T083000" })) as any;
      const upd = (await update.handler({ id: res.id, message: "updated hello", enabled: false })) as any;
      expect(upd.message).toBe("updated hello");
      expect(upd.enabled).toBe(false);
    });
  });

  it("weekly BYDAY", async () => {
    await withUser("alice", async () => {
      const create = tools.find((x) => x.name === "automation.create")!;
      const res = (await create.handler({ name: "Mon only", message: "Monday!", rrule: "FREQ=WEEKLY;BYDAY=MO", dtstart: "DTSTART:20260915T163000" })) as any;
      expect(res.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    });
  });

  it("validates bad rrule", async () => {
    await withUser("alice", async () => {
      const create = tools.find((x) => x.name === "automation.create")!;
      await expect(create.handler({ name: "x", message: "hi", rrule: "FREQ=HOURLY", dtstart: "DTSTART:20260913T083000" } as any)).rejects.toThrow(/rrule/);
    });
  });

  it("validates bad dtstart", async () => {
    await withUser("alice", async () => {
      const create = tools.find((x) => x.name === "automation.create")!;
      await expect(create.handler({ name: "x", message: "hi", rrule: "FREQ=DAILY", dtstart: "bad" } as any)).rejects.toThrow(/dtstart/);
    });
  });

  it("private per user", async () => {
    await withUser("alice", async () => {
      const create = tools.find((x) => x.name === "automation.create")!;
      await create.handler({ name: "Alice auto", message: "hi", rrule: "FREQ=DAILY", dtstart: "DTSTART:20260913T083000" });
    });
    await withUser("bob", async () => {
      const list = tools.find((x) => x.name === "automation.list")!;
      const l = (await list.handler({})) as any;
      expect(l.automations.length).toBe(0);
    });
  });

  it("rejects anonymous", async () => {
    await withUser("anonymous", async () => {
      const create = tools.find((x) => x.name === "automation.create")!;
      await expect(create.handler({ name: "x", message: "hi", rrule: "FREQ=DAILY", dtstart: "DTSTART:20260913T083000" } as any)).rejects.toThrow(/Missing X-User-Id/);
    });
  });
});
