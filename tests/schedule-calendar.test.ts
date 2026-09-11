import { describe, it, expect } from "vitest";
import { schedule } from "../src/scheduler.js";

describe("schedule with Calendar Blocks", () => {
  const today = "2026-10-13";
  const tasks = [
    { id: "1", title: "สอบคณิต", priority: 2, deadline: today, estimate_minutes: 60, status: "todo" },
    { id: "2", title: "ทำการบ้าน", priority: 2, deadline: today, estimate_minutes: 30, status: "todo" },
    { id: "3", title: "อ่านหนังสือ", priority: 3, deadline: today, estimate_minutes: 30, status: "todo" },
  ];

  it("no blocks -> normal schedule", () => {
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today);
    expect(res.blocks.length).toBe(3);
    expect(res.activeBlocks?.length ?? 0).toBe(0);
  });

  it("skip block -> empty schedule with warning", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "ปิดเทอม", start_date: "2026-10-13", end_date: "2026-10-20", start_time: null, end_time: null, effect: { skip: true }, created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    expect(res.blocks.length).toBe(0);
    expect(res.warning).toContain("ปิดเทอม");
    expect(res.activeBlock?.label).toBe("ปิดเทอม");
    expect(res.overflow).toBe(false);
  });

  it("skip wins over timed block", () => {
    const blocks: any[] = [
      { id: "b1", user_id: "u", label: "ปิดเทอม", start_date: "2026-10-13", end_date: "2026-10-20", start_time: null, end_time: null, effect: { skip: true }, created_at: "2026-10-01T00:00:00Z" },
      { id: "b2", user_id: "u", label: "สอบ", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "09:00", end_time: "12:00", effect: { boost_tags: ["สอบ"] }, created_at: "2026-10-01T00:00:00Z" },
    ];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    expect(res.blocks.length).toBe(0);
    expect(res.warning).toContain("ปิดเทอม");
  });

  it("timed block subtracts from window", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "เรียน", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "09:00", end_time: "12:00", effect: {}, created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    // 09:00-18:00 = 540, minus 09:00-12:00 = 180 => 360
    expect(res.window_minutes).toBe(360);
    expect(res.blocks.length).toBe(3);
  });

  it("window override shrinks window", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "สอบบ่าย", start_date: "2026-10-13", end_date: "2026-10-13", start_time: null, end_time: null, effect: { window: { start: "13:00", end: "18:00" } }, created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    expect(res.window_minutes).toBe(300); // 13:00-18:00
    expect(res.workingWindow.start).toBe("13:00");
  });

  it("boost_tags re-ranks within same priority", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "สอบ", start_date: "2026-10-13", end_date: "2026-10-13", start_time: null, end_time: null, effect: { boost_tags: ["สอบ"] }, created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    // Priority 3 first, then within priority 2, "สอบคณิต" should come before "ทำการบ้าน"
    expect(res.blocks[0].title).toBe("อ่านหนังสือ"); // priority 3
    expect(res.blocks[1].title).toBe("สอบคณิต"); // priority 2 + boost
    expect(res.blocks[2].title).toBe("ทำการบ้าน");
  });

  it("boost does not override priority", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "สอบ", start_date: "2026-10-13", end_date: "2026-10-13", start_time: null, end_time: null, effect: { boost_tags: ["ทำการบ้าน"] }, created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    expect(res.blocks[0].title).toBe("อ่านหนังสือ"); // priority 3 still first
  });

  it("overlapping timed blocks unioned", () => {
    const blocks: any[] = [
      { id: "b1", user_id: "u", label: "เรียน", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "09:00", end_time: "11:00", effect: {}, created_at: "2026-10-01T00:00:00Z" },
      { id: "b2", user_id: "u", label: "สอบ", start_date: "2026-10-13", end_date: "2026-10-13", start_time: "13:00", end_time: "15:00", effect: {}, created_at: "2026-10-01T00:00:00Z" },
    ];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    // 540 - 120 - 120 = 300
    expect(res.window_minutes).toBe(300);
  });

  it("whole-day block with boost_tags still applies boost", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "สอบ", start_date: "2026-10-13", end_date: "2026-10-13", start_time: null, end_time: null, effect: { boost_tags: ["สอบ"] }, created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    expect(res.blocks[1].title).toBe("สอบคณิต");
  });

  it("block outside today not applied", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "ปิดเทอม", start_date: "2026-10-20", end_date: "2026-10-25", start_time: null, end_time: null, effect: { skip: true }, created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    expect(res.blocks.length).toBe(3);
  });

  it("effect as JSON string parsed", () => {
    const blocks: any[] = [{ id: "b1", user_id: "u", label: "ปิดเทอม", start_date: "2026-10-13", end_date: "2026-10-13", start_time: null, end_time: null, effect: JSON.stringify({ skip: true }), created_at: "2026-10-01T00:00:00Z" }];
    const res = schedule(tasks, { start: "09:00", end: "18:00" }, today, blocks);
    expect(res.blocks.length).toBe(0);
  });
});
