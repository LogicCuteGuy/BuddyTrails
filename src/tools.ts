import { z } from "zod";
import { getDb } from "./db.js";
import { embed } from "./embed.js";
import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "./context.js";

// Tool definitions — stubbed for scaffold, real logic in later tickets.
// Each tool validates via zod and returns structured result.

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: any) => Promise<any>;
};

function nowIso() {
  return new Date().toISOString();
}

// Calendar Block helpers
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function isValidDateMsg(s: string): string | null {
  if (!DATE_RE.test(s)) return "must be YYYY-MM-DD";
  const d = new Date(s + "T00:00:00.000Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return "is not a valid calendar date";
  return null;
}
function isValidTime(s: string): boolean {
  if (!TIME_RE.test(s)) return false;
  const [h, m] = s.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}
function parseEffect(raw: any): { skip?: boolean; window?: { start: string; end: string }; boost_tags?: string[] } {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: any = {};
  if (typeof raw.skip === "boolean") out.skip = raw.skip;
  if (raw.window && typeof raw.window === "object" && typeof raw.window.start === "string" && typeof raw.window.end === "string") {
    out.window = { start: raw.window.start, end: raw.window.end };
  }
  if (Array.isArray(raw.boost_tags)) out.boost_tags = raw.boost_tags.filter((x: any) => typeof x === "string");
  return out;
}
function validateCalendarBlock(input: { label: string; start_date: string; end_date: string; start_time?: string | null; end_time?: string | null; effect?: any }): string | null {
  if (!input.label || typeof input.label !== "string" || input.label.trim().length === 0) return "label is required";
  if (input.label.trim().length > 100) return "label must be 1..100 chars (trimmed)";
  {
    const m = isValidDateMsg(input.start_date);
    if (m) return `start_date ${m}`;
  }
  {
    const m = isValidDateMsg(input.end_date);
    if (m) return `end_date ${m}`;
  }
  if (input.start_date > input.end_date) return "start_date must be <= end_date";
  const hasStart = input.start_time != null && input.start_time !== "";
  const hasEnd = input.end_time != null && input.end_time !== "";
  if (hasStart !== hasEnd) return "start_time and end_time must both be provided or both omitted";
  if (hasStart) {
    if (!isValidTime(input.start_time!)) return "start_time must be HH:mm";
    if (!isValidTime(input.end_time!)) return "end_time must be HH:mm";
    if (input.start_time! >= input.end_time!) return "start_time must be < end_time";
  }
  const eff = parseEffect(input.effect);
  if (eff.window) {
    if (!isValidTime(eff.window.start)) return "effect.window.start must be HH:mm";
    if (!isValidTime(eff.window.end)) return "effect.window.end must be HH:mm";
    if (eff.window.start >= eff.window.end) return "effect.window.start must be < effect.window.end";
  }
  if (eff.boost_tags) {
    if (eff.boost_tags.length > 20) return "effect.boost_tags max 20";
    for (const t of eff.boost_tags) {
      if (typeof t !== "string" || t.trim().length === 0 || t.length > 30) return "each boost_tag must be 1..30 chars";
    }
  }
  // Strict: reject non-string boost_tags that were silently dropped by parseEffect
  if (input.effect && Array.isArray((input.effect as any).boost_tags)) {
    for (const t of (input.effect as any).boost_tags) {
      if (typeof t !== "string") return "each boost_tag must be a string";
    }
  }
  const hasEffect = !!(eff.skip || eff.window || (eff.boost_tags && eff.boost_tags.length > 0));
  if (!hasEffect && !hasStart) return "effect or time required: provide effect.skip/window/boost_tags or start_time/end_time";
  return null;
}

export const tools: ToolDef[] = [
  // knowledge.*
  {
    name: "knowledge.ingest",
    description: "Ingest text into Knowledge Hook DB (stubbed)",
    inputSchema: z.object({ text: z.string().min(1), source: z.string().optional(), tags: z.array(z.string()).optional(), conversation_id: z.string().optional() }),
    handler: async ({ text, source, tags, conversation_id }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (conversation_id) {
        const setting = db.prepare(`SELECT opt_out FROM conversation_settings WHERE conversation_id = ? AND user_id = ?`).get(conversation_id, userId) as any;
        if (setting?.opt_out) return { id: null, skipped: true, reason: "opted out" };
      }
      const id = randomUUID();
      const emb = embed(text);
      const summary = text.slice(0, 120);
      const tagStr = JSON.stringify(tags ?? []);
      const createdBy = userId !== "anonymous" ? userId : null;
      db.prepare(`INSERT INTO knowledge_entries (id, raw_text, summary, tags, embedding, source, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, text, summary, tagStr, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength), source ?? "manual", nowIso(), createdBy
      );
      try {
        db.prepare(`INSERT INTO knowledge_vec (id, embedding) VALUES (?, ?)`).run(id, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength));
      } catch {}
      return { id, summary, tags: tags ?? [] };
    },
  },
  {
    name: "knowledge.search",
    description: "Semantic search Knowledge Entries",
    inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).optional(), source: z.string().optional() }),
    handler: async ({ query, limit = 5, source }) => {
      const db = getDb();
      const qEmb = embed(query);
      const rows = db.prepare(`SELECT id, raw_text, summary, tags, embedding, source, created_at FROM knowledge_entries ${source ? "WHERE source = ?" : ""} ORDER BY created_at DESC LIMIT 100`).all(...(source ? [source] : [])) as any[];
      const scored = rows.map((r) => {
        let score = 0;
        if (r.embedding) {
          try {
            const emb = new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength));
            let dot = 0;
            for (let i = 0; i < qEmb.length; i++) dot += qEmb[i] * emb[i];
            score = dot;
          } catch {}
        }
        const qLower2 = query.toLowerCase();
        const tLower2 = (r.raw_text || "").toLowerCase();
        for (const w of qLower2.split(/\s+/)) if (w.length>2 && tLower2.includes(w)) score += 1;
        return { ...r, score, tags: r.tags ? JSON.parse(r.tags) : [] };
      });
      scored.sort((a, b) => b.score - a.score);
      return { results: scored.slice(0, limit) };
    },
  },
  {
    name: "knowledge.get",
    description: "Get Knowledge Entry by id",
    inputSchema: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      const db = getDb();
      const row = db.prepare(`SELECT * FROM knowledge_entries WHERE id = ?`).get(id) as any;
      if (!row) throw new Error(`Knowledge entry not found: ${id}`);
      return { ...row, tags: row.tags ? JSON.parse(row.tags) : [] };
    },
  },
  {
    name: "knowledge.delete",
    description: "Delete Knowledge Entry",
    inputSchema: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      const db = getDb();
      db.prepare(`DELETE FROM knowledge_entries WHERE id = ?`).run(id);
      try { db.prepare(`DELETE FROM knowledge_vec WHERE id = ?`).run(id); } catch {}
      return { deleted: id };
    },
  },
  {
    name: "knowledge.summarize",
    description: "Summarize top-K hits for query (stub)",
    inputSchema: z.object({ query: z.string(), topK: z.number().optional() }),
    handler: async ({ query, topK = 5 }) => {
      const db = getDb();
      const rows = db.prepare(`SELECT raw_text FROM knowledge_entries ORDER BY created_at DESC LIMIT ?`).all(topK) as any[];
      return { query, summary: rows.map((r) => r.raw_text.slice(0, 80)).join(" | ") || "(no entries)", sources: rows.length };
    },
  },
  {
    name: "knowledge.export",
    description: "Export entries as markdown/json",
    inputSchema: z.object({ format: z.enum(["markdown", "json"]).optional(), source: z.string().optional() }),
    handler: async ({ format = "markdown", source }) => {
      const db = getDb();
      const rows = db.prepare(`SELECT * FROM knowledge_entries ${source ? "WHERE source = ?" : ""} ORDER BY created_at DESC`).all(...(source ? [source] : [])) as any[];
      if (format === "json") return { format, count: rows.length, data: rows };
      const md = rows.map((r) => `## ${r.id}\n${r.raw_text}\n`).join("\n");
      return { format, count: rows.length, data: md };
    },
  },
  {
    name: "knowledge.retag",
    description: "Merge/dedupe tags",
    inputSchema: z.object({ from: z.string(), to: z.string() }),
    handler: async ({ from, to }) => {
      const db = getDb();
      const rows = db.prepare(`SELECT id, tags FROM knowledge_entries`).all() as any[];
      let updated = 0;
      for (const r of rows) {
        const tags: string[] = r.tags ? JSON.parse(r.tags) : [];
        if (tags.includes(from)) {
          const next = [...new Set(tags.map((t) => (t === from ? to : t)))];
          db.prepare(`UPDATE knowledge_entries SET tags = ? WHERE id = ?`).run(JSON.stringify(next), r.id);
          updated++;
        }
      }
      return { updated };
    },
  },
  // idea.*
  {
    name: "idea.capture",
    description: "Capture an idea",
    inputSchema: z.object({ text: z.string().min(1), tags: z.array(z.string()).optional(), context: z.string().optional() }),
    handler: async ({ text, tags, context }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id — private ideas require authentication");
      const id = randomUUID();
      const emb = embed(text);
      db.prepare(`INSERT INTO ideas (id, text, tags, context, embedding, created_at, promoted_task_id, user_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`).run(
        id, text, JSON.stringify(tags ?? []), context ?? null, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength), nowIso(), userId
      );
      try { db.prepare(`INSERT INTO ideas_vec (id, embedding) VALUES (?, ?)`).run(id, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength)); } catch {}
      return { id, text, tags: tags ?? [] };
    },
  },
  {
    name: "idea.suggest",
    description: "Suggest ideas by semantic search",
    inputSchema: z.object({ query: z.string().optional(), limit: z.number().optional() }),
    handler: async ({ query, limit = 5 }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const rows = db.prepare(`SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(userId) as any[];
      if (!query) return { results: rows.slice(0, limit).map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]"), score: 0 })) };
      const qEmb = embed(query);
      const scored = rows.map((r) => {
        let score = 0;
        if (r.embedding) {
          try {
            const emb = new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.byteLength));
            let dot = 0;
            for (let i = 0; i < qEmb.length; i++) dot += qEmb[i] * emb[i];
            score = dot;
          } catch {}
        }
        // Keyword boost for scaffold (real model will be semantic)
        const qLower = query.toLowerCase();
        const tLower = (r.text || "").toLowerCase();
        for (const w of qLower.split(/\s+/)) if (w.length>2 && tLower.includes(w)) score += 1;
        return { ...r, tags: JSON.parse(r.tags || "[]"), score };
      });
      scored.sort((a, b) => b.score - a.score);
      return { results: scored.slice(0, limit) };
    },
  },
  {
    name: "idea.list",
    description: "List ideas",
    inputSchema: z.object({ limit: z.number().optional() }),
    handler: async ({ limit = 20 }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const rows = db.prepare(`SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit) as any[];
      return { ideas: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") })) };
    },
  },
  {
    name: "idea.delete",
    description: "Delete idea",
    inputSchema: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const existing = db.prepare(`SELECT user_id FROM ideas WHERE id = ?`).get(id) as any;
      if (existing && existing.user_id !== userId) throw new Error("Not found or not owned");
      db.prepare(`DELETE FROM ideas WHERE id = ? AND user_id = ?`).run(id, userId);
      try { db.prepare(`DELETE FROM ideas_vec WHERE id = ?`).run(id); } catch {}
      return { deleted: id };
    },
  },
  {
    name: "idea.promote_to_task",
    description: "Promote idea to task",
    inputSchema: z.object({ id: z.string(), priority: z.number().optional(), deadline: z.string().optional() }),
    handler: async ({ id, priority = 2, deadline }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const idea = db.prepare(`SELECT * FROM ideas WHERE id = ? AND user_id = ?`).get(id, userId) as any;
      if (!idea) throw new Error(`Idea not found: ${id}`);
      const taskId = randomUUID();
      db.prepare(`INSERT INTO tasks (id, title, description, priority, deadline, estimate_minutes, status, source, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        taskId, idea.text.slice(0, 120), idea.text, priority, deadline ?? null, 30, "todo", "idea", nowIso(), userId
      );
      db.prepare(`UPDATE ideas SET promoted_task_id = ? WHERE id = ?`).run(taskId, id);
      return { taskId, ideaId: id };
    },
  },
  {
    name: "idea.brainstorm",
    description: "Brainstorm ideas (stub)",
    inputSchema: z.object({ prompt: z.string(), count: z.number().optional() }),
    handler: async ({ prompt, count = 3 }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const text = `${prompt} — idea ${i + 1}`;
        const id = randomUUID();
        const emb = embed(text);
        db.prepare(`INSERT INTO ideas (id, text, tags, context, embedding, created_at, promoted_task_id, user_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`).run(
          id, text, JSON.stringify(["brainstorm"]), prompt, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength), nowIso(), userId
        );
        ids.push(id);
      }
      return { prompt, count, ids };
    },
  },
  {
    name: "idea.cluster",
    description: "Cluster ideas by embedding",
    inputSchema: z.object({}),
    handler: async () => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const rows = db.prepare(`SELECT id, text FROM ideas WHERE user_id = ?`).all(userId) as any[];
      // Stub: single cluster
      return { clusters: [{ ids: rows.map((r) => r.id), size: rows.length }] };
    },
  },
  {
    name: "idea.refine",
    description: "Refine idea",
    inputSchema: z.object({ id: z.string(), instruction: z.string() }),
    handler: async ({ id, instruction }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const idea = db.prepare(`SELECT * FROM ideas WHERE id = ? AND user_id = ?`).get(id, userId) as any;
      if (!idea) throw new Error(`Idea not found: ${id}`);
      const newText = `${idea.text} [refined: ${instruction}]`;
      const emb = embed(newText);
      db.prepare(`UPDATE ideas SET text = ?, embedding = ? WHERE id = ? AND user_id = ?`).run(newText, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength), id, userId);
      return { id, text: newText };
    },
  },
  // task.*
  {
    name: "task.create",
    description: "Create a task",
    inputSchema: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.number().int().min(1).max(3),
      deadline: z.string().optional(),
      estimate_minutes: z.number().int().min(1).optional(),
      status: z.enum(["todo", "doing", "done"]).optional(),
      source: z.string().optional(),
    }),
    handler: async ({ title, description, priority, deadline, estimate_minutes, status = "todo", source }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id — tasks require authentication");
      const id = randomUUID();
      db.prepare(`INSERT INTO tasks (id, title, description, priority, deadline, estimate_minutes, status, source, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, title, description ?? null, priority, deadline ?? null, estimate_minutes ?? null, status, source ?? "manual", nowIso(), userId
      );
      return { id, title, priority, status };
    },
  },
  {
    name: "task.ingest_raw",
    description: "Ingest raw task items",
    inputSchema: z.object({ items: z.array(z.string().min(1)).min(1) }),
    handler: async ({ items }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const out: any[] = [];
      for (const raw of items) {
        const temp_id = randomUUID();
        db.prepare(`INSERT INTO raw_task_items (temp_id, raw_text, created_at, user_id) VALUES (?, ?, ?, ?)`).run(temp_id, raw, nowIso(), userId);
        out.push({ temp_id, raw_text: raw });
      }
      return { items: out };
    },
  },
  {
    name: "task.enrich_raw",
    description: "Enrich raw items into tasks",
    inputSchema: z.object({ items: z.array(z.object({ temp_id: z.string(), priority: z.number().int().min(1).max(3), estimate_minutes: z.number().int().min(1) })) }),
    handler: async ({ items }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const created: any[] = [];
      for (const it of items) {
        const raw = db.prepare(`SELECT raw_text, user_id FROM raw_task_items WHERE temp_id = ?`).get(it.temp_id) as any;
        if (!raw) throw new Error(`Raw item not found: ${it.temp_id}`);
        if (raw.user_id !== userId) throw new Error(`Not owned: ${it.temp_id}`);
        const id = randomUUID();
        db.prepare(`INSERT INTO tasks (id, title, description, priority, deadline, estimate_minutes, status, source, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, raw.raw_text.slice(0, 120), raw.raw_text, it.priority, null, it.estimate_minutes, "todo", "raw", nowIso(), userId
        );
        db.prepare(`DELETE FROM raw_task_items WHERE temp_id = ? AND user_id = ?`).run(it.temp_id, userId);
        created.push({ id, title: raw.raw_text.slice(0, 120), priority: it.priority, estimate_minutes: it.estimate_minutes });
      }
      return { created };
    },
  },
  {
    name: "task.update",
    description: "Update task",
    inputSchema: z.object({ id: z.string(), status: z.enum(["todo", "doing", "done"]).optional(), priority: z.number().optional(), title: z.string().optional() }),
    handler: async ({ id, status, priority, title }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const sets: string[] = [];
      const vals: any[] = [];
      if (status) { sets.push("status = ?"); vals.push(status); }
      if (priority) { sets.push("priority = ?"); vals.push(priority); }
      if (title) { sets.push("title = ?"); vals.push(title); }
      if (sets.length === 0) throw new Error("No fields to update");
      vals.push(id, userId);
      db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals);
      return { id, updated: sets };
    },
  },
  {
    name: "task.list",
    description: "List tasks",
    inputSchema: z.object({ status: z.string().optional(), priority: z.number().optional(), limit: z.number().optional() }),
    handler: async ({ status, priority, limit = 50 }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      let sql = `SELECT * FROM tasks WHERE user_id = ?`;
      const vals: any[] = [userId];
      if (status) { sql += ` AND status = ?`; vals.push(status); }
      if (priority) { sql += ` AND priority = ?`; vals.push(priority); }
      sql += ` ORDER BY priority DESC, deadline ASC LIMIT ?`;
      vals.push(limit);
      const rows = db.prepare(sql).all(...vals) as any[];
      return { tasks: rows };
    },
  },
  {
    name: "task.delete",
    description: "Delete task",
    inputSchema: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      db.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`).run(id, userId);
      return { deleted: id };
    },
  },
  {
    name: "task.get_today_schedule",
    description: "Get today's time-blocked schedule",
    inputSchema: z.object({ workingWindow: z.object({ start: z.string().optional(), end: z.string().optional() }).optional() }),
    handler: async ({ workingWindow }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const { schedule } = await import("./scheduler.js");
      const today = new Date().toISOString().slice(0, 10);
      const rows = db.prepare(`SELECT * FROM tasks WHERE status != 'done' AND user_id = ?`).all(userId) as any[];
      return schedule(rows, workingWindow ?? { start: "09:00", end: "18:00" }, today);
    },
  },
  {
    name: "task.suggest_next",
    description: "Suggest next task with related knowledge/ideas",
    inputSchema: z.object({}),
    handler: async () => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const today = new Date().toISOString().slice(0, 10);
      const task = db.prepare(`SELECT * FROM tasks WHERE status != 'done' AND user_id = ? ORDER BY priority DESC, deadline ASC LIMIT 1`).get(userId) as any;
      if (!task) return { task: null, relatedKnowledge: [], relatedIdeas: [] };
      const kRows = db.prepare(`SELECT id, raw_text FROM knowledge_entries ORDER BY created_at DESC LIMIT 3`).all() as any[];
      const iRows = db.prepare(`SELECT id, text FROM ideas WHERE user_id = ? ORDER BY created_at DESC LIMIT 3`).all(userId) as any[];
      return { task, relatedKnowledge: kRows, relatedIdeas: iRows };
    },
  },
  {
    name: "task.breakdown",
    description: "Break down task into subtasks",
    inputSchema: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const task = db.prepare(`SELECT * FROM tasks WHERE id = ? AND user_id = ?`).get(id, userId) as any;
      if (!task) throw new Error(`Task not found: ${id}`);
      const est = task.estimate_minutes ?? 60;
      const per = Math.max(10, Math.floor(est / 3));
      const created: any[] = [];
      for (let i = 0; i < 3; i++) {
        const nid = randomUUID();
        db.prepare(`INSERT INTO tasks (id, title, description, priority, deadline, estimate_minutes, status, source, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          nid, `${task.title} — subtask ${i + 1}`, `Part ${i + 1} of ${task.title}`, task.priority, task.deadline, per, "todo", "breakdown", nowIso(), userId
        );
        created.push({ id: nid, title: `${task.title} — subtask ${i + 1}`, estimate_minutes: per });
      }
      return { parentId: id, subtasks: created };
    },
  },
  {
    name: "task.pomodoro",
    description: "Pomodoro timer",
    inputSchema: z.object({ id: z.string(), action: z.enum(["start", "pause", "done"]) }),
    handler: async ({ id, action }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const owned = db.prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`).get(id, userId) as any;
      if (!owned) throw new Error(`Task not found: ${id}`);
      if (action === "start") {
        const sid = randomUUID();
        db.prepare(`INSERT INTO pomodoro_sessions (id, task_id, started_at, ended_at, duration_minutes, user_id) VALUES (?, ?, ?, NULL, NULL, ?)`).run(sid, id, nowIso(), userId);
        return { sessionId: sid, action, taskId: id };
      }
      if (action === "done") {
        const sess = db.prepare(`SELECT * FROM pomodoro_sessions WHERE task_id = ? AND user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(id, userId) as any;
        if (!sess) throw new Error("No active pomodoro");
        const duration = 25;
        db.prepare(`UPDATE pomodoro_sessions SET ended_at = ?, duration_minutes = ? WHERE id = ? AND user_id = ?`).run(nowIso(), duration, sess.id, userId);
        return { sessionId: sess.id, action, duration_minutes: duration };
      }
      return { action, taskId: id };
    },
  },
  {
    name: "task.time_log",
    description: "Time log actual vs estimate",
    inputSchema: z.object({ id: z.string().optional() }),
    handler: async ({ id }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      if (id) {
        const task = db.prepare(`SELECT * FROM tasks WHERE id = ? AND user_id = ?`).get(id, userId) as any;
        const sessions = db.prepare(`SELECT * FROM pomodoro_sessions WHERE task_id = ? AND user_id = ?`).all(id, userId) as any[];
        const actual = sessions.reduce((s: number, r: any) => s + (r.duration_minutes || 0), 0);
        return { taskId: id, estimate_minutes: task?.estimate_minutes ?? null, actual_minutes: actual, sessions };
      }
      const tasks = db.prepare(`SELECT * FROM tasks WHERE user_id = ?`).all(userId) as any[];
      return { tasks: tasks.map((t: any) => ({ id: t.id, title: t.title, estimate_minutes: t.estimate_minutes })) };
    },
  },
  {
    name: "task.remind",
    description: "Schedule reminder",
    inputSchema: z.object({ taskId: z.string(), at: z.string(), channel: z.string().optional() }),
    handler: async ({ taskId, at, channel }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const owned = db.prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`).get(taskId, userId) as any;
      if (!owned) throw new Error(`Task not found: ${taskId}`);
      const id = randomUUID();
      db.prepare(`INSERT INTO reminders (id, task_id, at, channel, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`).run(id, taskId, at, channel ?? null, nowIso(), userId);
      return { id, taskId, at };
    },
  },
  {
    name: "task.due_soon",
    description: "Tasks due soon",
    inputSchema: z.object({ within: z.string().optional() }),
    handler: async ({ within = "24h" }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const hours = within === "3d" ? 72 : 24;
      const cutoff = new Date(Date.now() + hours * 3600 * 1000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const rows = db.prepare(`SELECT * FROM tasks WHERE status != 'done' AND user_id = ? AND deadline IS NOT NULL AND deadline >= ? AND deadline <= ? ORDER BY priority DESC, deadline ASC`).all(userId, today, cutoff) as any[];
      return { within, cutoff, tasks: rows };
    },
  },
  {
    name: "brief.daily",
    description: "Daily brief",
    inputSchema: z.object({}),
    handler: async () => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const today = new Date().toISOString().slice(0, 10);
      const tasks = db.prepare(`SELECT * FROM tasks WHERE status != 'done' AND user_id = ? AND (deadline = ? OR (priority = 3 AND deadline < ?)) ORDER BY priority DESC LIMIT 5`).all(userId, today, today) as any[];
      const ideas = db.prepare(`SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC LIMIT 3`).all(userId) as any[];
      const knowledge = db.prepare(`SELECT * FROM knowledge_entries ORDER BY created_at DESC LIMIT 3`).all() as any[];
      return { date: today, tasks, topIdeas: ideas, relatedKnowledge: knowledge };
    },
  },
  {
    name: "brief.weekly",
    description: "Weekly review",
    inputSchema: z.object({}),
    handler: async () => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const done = db.prepare(`SELECT * FROM tasks WHERE status = 'done' AND user_id = ? ORDER BY created_at DESC LIMIT 10`).all(userId) as any[];
      const overdue = db.prepare(`SELECT * FROM tasks WHERE status != 'done' AND user_id = ? AND deadline < date('now') ORDER BY priority DESC`).all(userId) as any[];
      const ideas = db.prepare(`SELECT * FROM ideas WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`).all(userId) as any[];
      return { done, overdue, ideas };
    },
  },
  {
    name: "search.all",
    description: "Unified search",
    inputSchema: z.object({ query: z.string() }),
    handler: async ({ query }) => {
      const qEmb = embed(query);
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const kRows = db.prepare(`SELECT id, raw_text FROM knowledge_entries LIMIT 20`).all() as any[];
      const iRows = db.prepare(`SELECT id, text FROM ideas WHERE user_id = ? LIMIT 20`).all(userId) as any[];
      const tRows = db.prepare(`SELECT id, title FROM tasks WHERE user_id = ? LIMIT 20`).all(userId) as any[];
      return { query, knowledge: kRows.slice(0, 5), ideas: iRows.slice(0, 5), tasks: tRows.slice(0, 5) };
    },
  },
  {
    name: "conversation.set_opt_out",
    description: "Set opt-out flag for a conversation",
    inputSchema: z.object({ conversation_id: z.string().min(1), opt_out: z.boolean() }),
    handler: async ({ conversation_id, opt_out }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const existing = db.prepare(`SELECT conversation_id FROM conversation_settings WHERE conversation_id = ? AND user_id = ?`).get(conversation_id, userId) as any;
      if (existing) {
        db.prepare(`UPDATE conversation_settings SET opt_out = ? WHERE conversation_id = ? AND user_id = ?`).run(opt_out ? 1 : 0, conversation_id, userId);
      } else {
        db.prepare(`INSERT INTO conversation_settings (conversation_id, user_id, opt_out, created_at) VALUES (?, ?, ?, ?)`).run(conversation_id, userId, opt_out ? 1 : 0, nowIso());
      }
      return { conversation_id, opt_out };
    },
  },
  {
    name: "conversation.get_opt_out",
    description: "Get opt-out flag for a conversation",
    inputSchema: z.object({ conversation_id: z.string().min(1) }),
    handler: async ({ conversation_id }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id");
      const row = db.prepare(`SELECT opt_out FROM conversation_settings WHERE conversation_id = ? AND user_id = ?`).get(conversation_id, userId) as any;
      return { conversation_id, opt_out: row ? !!row.opt_out : false };
    },
  },
  {
    name: "hook.on_turn",
    description: "Auto-hook wiring stub: called on every user/AI turn, respects opt-out",
    inputSchema: z.object({ text: z.string().min(1), role: z.enum(["user", "assistant"]), conversation_id: z.string().optional(), source: z.string().optional() }),
    handler: async ({ text, role, conversation_id, source }) => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (conversation_id) {
        const setting = db.prepare(`SELECT opt_out FROM conversation_settings WHERE conversation_id = ? AND user_id = ?`).get(conversation_id, userId) as any;
        if (setting?.opt_out) return { skipped: true, reason: "opted out" };
      }
      const ingest = tools.find((t) => t.name === "knowledge.ingest")!;
      const result = await ingest.handler({ text, source: source ?? `turn:${role}`, conversation_id });
      return { ingested: result.id, role, conversation_id };
    },
  },
  {
    name: "link.create",
    description: "Create a one-time 6-digit link code for Discord verification (10 min expiry, single-use). Run this in Open WebUI to link your account, then verify in Discord with /buddytrails-verify <code>.",
    inputSchema: z.object({}),
    handler: async () => {
      const db = getDb();
      const userId = getCurrentUserId();
      if (userId === "anonymous" || userId === "local") throw new Error("Missing X-User-Id — link requires authentication via Open WebUI Custom Headers");
      // Cleanup expired codes
      try { db.prepare(`DELETE FROM link_codes WHERE expires_at < ?`).run(nowIso()); } catch {}
      // Generate 6-digit code (100000-999999), ensure uniqueness
      let code: string;
      let attempts = 0;
      do {
        code = String(Math.floor(100000 + Math.random() * 900000));
        const existing = db.prepare(`SELECT code FROM link_codes WHERE code = ?`).get(code) as any;
        if (!existing) break;
        attempts++;
      } while (attempts < 5);
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.prepare(`INSERT INTO link_codes (code, openwebui_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(code, userId, createdAt, expiresAt);
      return { code, openwebui_user_id: userId, expires_at: expiresAt, expires_in: "10m", next_step: "In Discord, run /buddytrails-verify code:<code> (works in DMs, no guild needed) to link your Discord account." };
    },
  },
  // calendar.*
  {
    name: "calendar.set",
    description: "Create a Calendar Block (flexible life period that modifies Work Schedule)",
    inputSchema: z.object({
      label: z.string().trim().min(1).max(100),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      // Semantic date/time validation (e.g. 2026-02-30, 24:00) is done in validateCalendarBlock
      // so error messages are precise ("is not a valid calendar date" vs generic regex).
      start_time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      end_time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      effect: z.object({
        skip: z.boolean().optional(),
        window: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).optional(),
        boost_tags: z.array(z.string().min(1).max(30)).max(20).optional(),
      }).optional(),
    }),
    handler: async ({ label, start_date, end_date, start_time, end_time, effect }) => {
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id — calendar requires authentication");
      const err = validateCalendarBlock({ label, start_date, end_date, start_time: start_time ?? null, end_time: end_time ?? null, effect });
      if (err) throw new Error(err);
      const db = getDb();
      const id = randomUUID();
      const effStr = JSON.stringify(parseEffect(effect ?? {}));
      db.prepare(`INSERT INTO calendar_blocks (id, user_id, label, start_date, end_date, start_time, end_time, effect, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, userId, label.trim(), start_date, end_date, start_time ?? null, end_time ?? null, effStr, nowIso()
      );
      return { id, label: label.trim(), start_date, end_date, start_time: start_time ?? null, end_time: end_time ?? null, effect: JSON.parse(effStr) };
    },
  },
  {
    name: "calendar.list",
    description: "List my Calendar Blocks",
    inputSchema: z.object({}),
    handler: async () => {
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id — calendar requires authentication");
      const db = getDb();
      const rows = db.prepare(`SELECT * FROM calendar_blocks WHERE user_id = ? ORDER BY start_date ASC, created_at ASC`).all(userId) as any[];
      return { blocks: rows.map((r) => ({ ...r, effect: parseEffect(r.effect) })) };
    },
  },
  {
    name: "calendar.delete",
    description: "Delete a Calendar Block",
    inputSchema: z.object({ id: z.string().min(1) }),
    handler: async ({ id }) => {
      const userId = getCurrentUserId();
      if (userId === "anonymous") throw new Error("Missing X-User-Id — calendar requires authentication");
      const db = getDb();
      db.prepare(`DELETE FROM calendar_blocks WHERE id = ? AND user_id = ?`).run(id, userId);
      return { deleted: id };
    },
  },
  {
    name: "health",
    description: "Health check",
    inputSchema: z.object({}),
    handler: async () => ({ status: "ok", time: nowIso() }),
  },
];

export function getTool(name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}
