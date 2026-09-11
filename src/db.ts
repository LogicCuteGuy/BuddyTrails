import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type Db = {
  exec(sql: string): void;
  prepare(sql: string): { run(...vals: any[]): any; get(...vals: any[]): any; all(...vals: any[]): any[] };
  close(): void;
};

let _db: Db | null = null;

export function getDbPath(): string {
  return process.env.BUDDYTRAILS_DB || path.join(process.cwd(), "buddytrails.db");
}

// Simple in-memory DB that mimics node:sqlite DatabaseSync for tests
class MemDb implements Db {
  tables: Map<string, Map<string, any>> = new Map();
  constructor(_path: string) {
    for (const t of ["knowledge_entries","ideas","tasks","raw_task_items","reminders","pomodoro_sessions","conversation_settings"]) {
      this.tables.set(t, new Map());
    }
  }
  exec(sql: string) {
    if (sql.includes("CREATE TABLE") || sql.includes("CREATE VIRTUAL TABLE")) return;
    if (sql.includes("DELETE FROM")) {
      const matches = sql.match(/DELETE FROM\s+(\w+)/g);
      if (matches) for (const mm of matches) {
        const tbl = mm.split(/\s+/)[2].replace(/;/g,"");
        this.tables.get(tbl)?.clear();
      }
    }
  }
  prepare(sql: string) {
    const self = this;
    return {
      run(...vals: any[]) {
        if (/INSERT INTO/i.test(sql)) {
          const m = sql.match(/INSERT INTO\s+(\w+)/i);
          const tbl = m![1];
          const map = self.tables.get(tbl)!;
          const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
          const cols = colsMatch ? colsMatch[1].split(",").map(s=>s.trim()) : [];
          const row: any = {};
          cols.forEach((c,i)=> row[c]=vals[i]);
          const key = row.id || row.temp_id || row.conversation_id || String(Math.random());
          map.set(key, row);
          return { changes: 1 };
        }
        if (/UPDATE/i.test(sql)) {
          const m = sql.match(/UPDATE\s+(\w+)/i);
          const tbl = m![1];
          const map = self.tables.get(tbl)!;
          const id = vals[vals.length-1];
          const row = map.get(id);
          if (!row) return { changes: 0 };
          const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
          if (setMatch) {
            const sets = setMatch[1].split(",").map(s=>s.trim());
            sets.forEach((s,i)=>{
              const col = s.split("=")[0].trim();
              row[col]=vals[i];
            });
          }
          return { changes: 1 };
        }
        if (/DELETE FROM/i.test(sql)) {
          const m = sql.match(/DELETE FROM\s+(\w+)/i);
          const tbl = m![1];
          const map = self.tables.get(tbl)!;
          const id = vals[0];
          map.delete(id);
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get(...vals: any[]) {
        if (/SELECT \* FROM (\w+) WHERE id = \?/i.test(sql)) {
          const m = sql.match(/FROM\s+(\w+)/i);
          const tbl = m![1];
          return self.tables.get(tbl)?.get(vals[0]) || undefined;
        }
        if (/FROM conversation_settings WHERE conversation_id/i.test(sql)) {
          return self.tables.get("conversation_settings")?.get(vals[0]) || undefined;
        }
        if (/SELECT raw_text FROM raw_task_items WHERE temp_id/i.test(sql)) {
          return self.tables.get("raw_task_items")?.get(vals[0]) || undefined;
        }
        if (/SELECT \* FROM pomodoro_sessions WHERE task_id/i.test(sql) && /ended_at IS NULL/i.test(sql)) {
          const all = [...(self.tables.get("pomodoro_sessions")?.values()||[])].filter((r:any)=>r.task_id===vals[0] && r.ended_at==null);
          return all[0];
        }
        if (/SELECT \* FROM tasks WHERE status != 'done' ORDER BY priority DESC, deadline ASC LIMIT 1/i.test(sql)) {
          const all = [...(self.tables.get("tasks")?.values()||[])].filter((r:any)=>r.status!=='done');
          all.sort((a:any,b:any)=> b.priority - a.priority || (a.deadline||"").localeCompare(b.deadline||""));
          return all[0];
        }
        return undefined;
      },
      all(...vals: any[]) {
        if (/FROM knowledge_entries/i.test(sql)) {
          let rows = [...(self.tables.get("knowledge_entries")?.values()||[])];
          if (/WHERE source = \?/i.test(sql) && vals.length>0) {
            const src = vals[0];
            rows = rows.filter((r:any)=>r.source===src);
            const limit = vals[1] ?? vals[0];
            if (/LIMIT \?/i.test(sql) && typeof limit === 'number') rows = rows.slice(0, limit);
          } else if (/LIMIT \?/i.test(sql)) {
            const limit = vals[0];
            if (typeof limit === 'number') rows = rows.slice(0, limit);
          }
          if (/ORDER BY created_at DESC/i.test(sql)) rows.sort((a:any,b:any)=> b.created_at.localeCompare(a.created_at));
          return rows;
        }
        if (/FROM ideas/i.test(sql) && !/knowledge/i.test(sql)) {
          let rows = [...(self.tables.get("ideas")?.values()||[])];
          if (/LIMIT \?/i.test(sql) && vals.length>0) {
            const limit = vals[vals.length-1];
            if (typeof limit === 'number') rows = rows.slice(0, limit);
          }
          if (/ORDER BY created_at DESC/i.test(sql)) rows.sort((a:any,b:any)=> b.created_at.localeCompare(a.created_at));
          return rows;
        }
        if (/FROM tasks/i.test(sql)) {
          let rows = [...(self.tables.get("tasks")?.values()||[])];
          if (/status != 'done'/i.test(sql)) rows = rows.filter((r:any)=>r.status!=='done');
          // Proper deadline filtering for get_today_schedule and due_soon
          if (/deadline = \?/i.test(sql) && /priority = 3 AND deadline < \?/i.test(sql)) {
            const today = vals[0];
            const today2 = vals[1];
            rows = rows.filter((r:any)=> r.deadline === today || (r.priority===3 && r.deadline && r.deadline < today2));
          } else if (/deadline >= \? AND deadline <= \?/i.test(sql)) {
            const from = vals[0], to = vals[1];
            rows = rows.filter((r:any)=> r.deadline && r.deadline >= from && r.deadline <= to);
          } else if (/deadline < date\('now'\)/i.test(sql)) {
            const today = new Date().toISOString().slice(0,10);
            rows = rows.filter((r:any)=> r.deadline && r.deadline < today);
          } else if (/deadline = \?/i.test(sql) && !/priority/i.test(sql)) {
            const today = vals.find((v:any)=> typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
            if (today) rows = rows.filter((r:any)=> r.deadline === today);
          }
          if (/ORDER BY priority DESC/i.test(sql)) rows.sort((a:any,b:any)=> b.priority - a.priority || (a.deadline||"").localeCompare(b.deadline||""));
          if (/LIMIT \?/i.test(sql)) {
            const limit = vals[vals.length-1];
            if (typeof limit === 'number') rows = rows.slice(0, limit);
          }
          return rows;
        }
        if (/FROM raw_task_items/i.test(sql)) {
          return [...(self.tables.get("raw_task_items")?.values()||[])];
        }
        if (/FROM reminders/i.test(sql)) {
          return [...(self.tables.get("reminders")?.values()||[])];
        }
        if (/FROM pomodoro_sessions/i.test(sql)) {
          let rows = [...(self.tables.get("pomodoro_sessions")?.values()||[])];
          if (/WHERE task_id = \?/i.test(sql)) rows = rows.filter((r:any)=>r.task_id===vals[0]);
          return rows;
        }
        return [];
      }
    };
  }
  close() {}
}

let useMem = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

export function openDb(dbPath?: string): Db {
  if (useMem) {
    const db = new MemDb(dbPath || ":memory:");
    initSchema(db);
    _db = db;
    return db;
  }
  const { DatabaseSync } = require("node:sqlite");
  const p = dbPath || getDbPath();
  const db = new DatabaseSync(p);
  initSchema(db);
  _db = db as unknown as Db;
  return db as unknown as Db;
}

export function getDb(): Db {
  if (!_db) _db = openDb();
  return _db;
}

export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
}

export function initSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      summary TEXT,
      tags TEXT,
      embedding BLOB,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      tags TEXT,
      context TEXT,
      embedding BLOB,
      created_at TEXT NOT NULL,
      promoted_task_id TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 3),
      deadline TEXT,
      estimate_minutes INTEGER,
      status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS raw_task_items (
      temp_id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      at TEXT NOT NULL,
      channel TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_settings (
      conversation_id TEXT PRIMARY KEY,
      opt_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pomodoro_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_minutes INTEGER
    );
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[384]);
      CREATE VIRTUAL TABLE IF NOT EXISTS ideas_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[384]);
    `);
  } catch {}
}

export function resetDb(db: Db): void {
  db.exec(`DELETE FROM knowledge_entries; DELETE FROM ideas; DELETE FROM tasks; DELETE FROM raw_task_items; DELETE FROM reminders; DELETE FROM pomodoro_sessions; DELETE FROM conversation_settings;`);
  try { db.exec(`DELETE FROM knowledge_vec; DELETE FROM ideas_vec;`); } catch {}
}
