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
    for (const t of ["knowledge_entries","ideas","tasks","raw_task_items","reminders","pomodoro_sessions","conversation_settings","discord_settings","user_discord_link"]) {
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
          // Handle NULL literals in VALUES (e.g., VALUES (?, ?, NULL, ?))
          const valuesPart = sql.match(/VALUES\s*\(([^)]+)\)/i)?.[1] || "";
          const valueTokens = valuesPart.split(",").map(s=>s.trim());
          const row: any = {};
          let valIdx = 0;
          cols.forEach((c, i) => {
            const token = valueTokens[i] || "?";
            if (token.toUpperCase() === "NULL") {
              row[c] = null;
            } else {
              row[c] = vals[valIdx++];
            }
          });
          let key = row.id || row.temp_id || row.guild_id || row.openwebui_user_id || String(Math.random());
          if (tbl === "conversation_settings") key = `${row.user_id}:${row.conversation_id}`;
          else if (tbl === "user_discord_link") key = row.openwebui_user_id;
          else if (row.conversation_id && row.user_id) key = `${row.user_id}:${row.conversation_id}`;
          map.set(key, row);
          return { changes: 1 };
        }
        if (/UPDATE/i.test(sql)) {
          const m = sql.match(/UPDATE\s+(\w+)/i);
          const tbl = m![1];
          const map = self.tables.get(tbl)!;
          // Handle composite WHERE (id + user_id or conversation_id + user_id)
          let row: any = undefined;
          let id: any = undefined;
          if (/WHERE.*user_id/i.test(sql) && /conversation_settings/i.test(sql)) {
            const convId = vals[vals.length-2];
            const uid = vals[vals.length-1];
            row = map.get(`${uid}:${convId}`);
            id = `${uid}:${convId}`;
          } else if (/WHERE.*user_id/i.test(sql)) {
            // WHERE id = ? AND user_id = ?  -> vals = [setVals..., id, userId]
            const uid = vals[vals.length-1];
            id = vals[vals.length-2];
            const candidate = map.get(id);
            if (candidate && candidate.user_id === uid) row = candidate;
            else {
              // try composite key fallback
              row = map.get(`${uid}:${id}`);
              id = `${uid}:${id}`;
            }
          } else {
            id = vals[vals.length-1];
            row = map.get(id);
          }
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
          if (/WHERE.*user_id/i.test(sql) && tbl === "conversation_settings") {
            const convId = vals[0];
            const uid = vals[1];
            map.delete(`${uid}:${convId}`);
            // also try legacy
            map.delete(convId);
            return { changes: 1 };
          } else if (/WHERE.*user_id/i.test(sql)) {
            const id = vals[0];
            const uid = vals[1];
            const row = map.get(id);
            if (row && row.user_id === uid) { map.delete(id); return { changes: 1 }; }
            // composite fallback
            map.delete(`${uid}:${id}`);
            return { changes: 1 };
          }
          const id = vals[0];
          map.delete(id);
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get(...vals: any[]) {
        if (/SELECT \* FROM (\w+) WHERE id = \?/i.test(sql) && !/user_id/i.test(sql)) {
          const m = sql.match(/FROM\s+(\w+)/i);
          const tbl = m![1];
          return self.tables.get(tbl)?.get(vals[0]) || undefined;
        }
        if (/SELECT \* FROM (\w+) WHERE id = \? AND user_id = \?/i.test(sql)) {
          const m = sql.match(/FROM\s+(\w+)/i);
          const tbl = m![1];
          const row = self.tables.get(tbl)?.get(vals[0]) as any;
          if (row && row.user_id === vals[1]) return row;
          return undefined;
        }
        if (/SELECT user_id FROM ideas WHERE id = \?/i.test(sql)) {
          const row = self.tables.get("ideas")?.get(vals[0]) as any;
          return row ? { user_id: row.user_id } : undefined;
        }
        if (/SELECT id FROM tasks WHERE id = \? AND user_id = \?/i.test(sql)) {
          const row = self.tables.get("tasks")?.get(vals[0]) as any;
          if (row && row.user_id === vals[1]) return { id: row.id };
          return undefined;
        }
        if (/SELECT user_id FROM tasks WHERE id = \?/i.test(sql)) {
          const row = self.tables.get("tasks")?.get(vals[0]) as any;
          return row ? { user_id: row.user_id } : undefined;
        }
        if (/FROM conversation_settings WHERE conversation_id/i.test(sql)) {
          // composite key (user_id, conversation_id) — try composite first, fallback to legacy
          if (vals.length >= 2) return self.tables.get("conversation_settings")?.get(`${vals[1]}:${vals[0]}`) || self.tables.get("conversation_settings")?.get(vals[0]) || undefined;
          // single param: search by conversation_id suffix
          for (const v of self.tables.get("conversation_settings")?.values() || []) if ((v as any).conversation_id === vals[0]) return v;
          return undefined;
        }
        if (/FROM discord_settings WHERE guild_id/i.test(sql)) {
          return self.tables.get("discord_settings")?.get(vals[0]) || undefined;
        }
        if (/FROM user_discord_link WHERE openwebui_user_id/i.test(sql)) {
          return self.tables.get("user_discord_link")?.get(vals[0]) || undefined;
        }
        if (/SELECT raw_text, user_id FROM raw_task_items WHERE temp_id/i.test(sql)) {
          return self.tables.get("raw_task_items")?.get(vals[0]) || undefined;
        }
        if (/SELECT raw_text FROM raw_task_items WHERE temp_id/i.test(sql)) {
          return self.tables.get("raw_task_items")?.get(vals[0]) || undefined;
        }
        if (/SELECT \* FROM pomodoro_sessions WHERE task_id/i.test(sql) && /ended_at IS NULL/i.test(sql)) {
          const hasUser = /user_id/i.test(sql);
          const taskId = vals[0];
          const userId = hasUser ? vals[1] : undefined;
          const all = [...(self.tables.get("pomodoro_sessions")?.values()||[])].filter((r:any)=>r.task_id===taskId && r.ended_at==null && (!hasUser || r.user_id===userId));
          return all[0];
        }
        if (/SELECT \* FROM tasks WHERE status != 'done' ORDER BY priority DESC, deadline ASC LIMIT 1/i.test(sql) && !/user_id/i.test(sql)) {
          const all = [...(self.tables.get("tasks")?.values()||[])].filter((r:any)=>r.status!=='done');
          all.sort((a:any,b:any)=> b.priority - a.priority || (a.deadline||"").localeCompare(b.deadline||""));
          return all[0];
        }
        if (/SELECT \* FROM tasks WHERE status != 'done' AND user_id = \? ORDER BY priority DESC, deadline ASC LIMIT 1/i.test(sql)) {
          const userId = vals[0];
          const all = [...(self.tables.get("tasks")?.values()||[])].filter((r:any)=>r.status!=='done' && r.user_id===userId);
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
          if (/user_id = \?/i.test(sql)) {
            const userId = vals[0];
            rows = rows.filter((r:any)=>r.user_id===userId);
            // adjust vals for limit handling
            const limit = vals[vals.length-1];
            if (/LIMIT \?/i.test(sql) && typeof limit === 'number' && vals.length>1) rows = rows.slice(0, limit);
          } else if (/LIMIT \?/i.test(sql) && vals.length>0) {
            const limit = vals[vals.length-1];
            if (typeof limit === 'number') rows = rows.slice(0, limit);
          }
          if (/ORDER BY created_at DESC/i.test(sql)) rows.sort((a:any,b:any)=> b.created_at.localeCompare(a.created_at));
          return rows;
        }
        if (/FROM tasks/i.test(sql)) {
          let rows = [...(self.tables.get("tasks")?.values()||[])];
          const hasUserFilter = /user_id = \?/i.test(sql);
          const userIdForFilter = hasUserFilter ? vals[0] : undefined;
          if (hasUserFilter) {
            rows = rows.filter((r:any)=>r.user_id===userIdForFilter);
          }
          if (/status != 'done'/i.test(sql)) rows = rows.filter((r:any)=>r.status!=='done');
          // Proper deadline filtering for get_today_schedule and due_soon
          // When hasUserFilter, vals are offset by 1 (vals[0]=userId)
          if (/deadline = \?/i.test(sql) && /priority = 3 AND deadline < \?/i.test(sql)) {
            const today = hasUserFilter ? vals[1] : vals[0];
            const today2 = hasUserFilter ? vals[2] : vals[1];
            rows = rows.filter((r:any)=> r.deadline === today || (r.priority===3 && r.deadline && r.deadline < today2));
          } else if (/deadline >= \? AND deadline <= \?/i.test(sql)) {
            const from = hasUserFilter ? vals[1] : vals[0];
            const to = hasUserFilter ? vals[2] : vals[1];
            rows = rows.filter((r:any)=> r.deadline && r.deadline >= from && r.deadline <= to);
          } else if (/deadline < date\('now'\)/i.test(sql)) {
            const today = new Date().toISOString().slice(0,10);
            rows = rows.filter((r:any)=> r.deadline && r.deadline < today);
          } else if (/deadline = \?/i.test(sql) && !/priority/i.test(sql)) {
            const today = vals.find((v:any)=> typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v !== userIdForFilter);
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
          let rows = [...(self.tables.get("raw_task_items")?.values()||[])];
          if (/user_id = \?/i.test(sql)) {
            const userId = vals[0];
            rows = rows.filter((r:any)=>r.user_id===userId);
          }
          return rows;
        }
        if (/FROM reminders/i.test(sql)) {
          let rows = [...(self.tables.get("reminders")?.values()||[])];
          if (/user_id = \?/i.test(sql)) {
            const userId = vals[0];
            rows = rows.filter((r:any)=>r.user_id===userId);
          }
          return rows;
        }
        if (/FROM pomodoro_sessions/i.test(sql)) {
          let rows = [...(self.tables.get("pomodoro_sessions")?.values()||[])];
          if (/WHERE task_id = \? AND user_id = \?/i.test(sql)) rows = rows.filter((r:any)=>r.task_id===vals[0] && r.user_id===vals[1]);
          else if (/WHERE task_id = \?/i.test(sql)) rows = rows.filter((r:any)=>r.task_id===vals[0]);
          else if (/user_id = \?/i.test(sql)) rows = rows.filter((r:any)=>r.user_id===vals[0]);
          return rows;
        }
        if (/FROM discord_settings/i.test(sql)) {
          return [...(self.tables.get("discord_settings")?.values()||[])];
        }
        if (/FROM conversation_settings/i.test(sql)) {
          let rows = [...(self.tables.get("conversation_settings")?.values()||[])];
          if (/user_id = \?/i.test(sql)) {
            const userId = vals[0];
            rows = rows.filter((r:any)=>r.user_id===userId);
          }
          return rows;
        }
        if (/FROM user_discord_link/i.test(sql)) {
          return [...(self.tables.get("user_discord_link")?.values()||[])];
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
      created_at TEXT NOT NULL,
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      tags TEXT,
      context TEXT,
      embedding BLOB,
      created_at TEXT NOT NULL,
      promoted_task_id TEXT,
      user_id TEXT NOT NULL DEFAULT 'local'
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
      created_at TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local'
    );
    CREATE TABLE IF NOT EXISTS raw_task_items (
      temp_id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local'
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      at TEXT NOT NULL,
      channel TEXT,
      created_at TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local'
    );
    CREATE TABLE IF NOT EXISTS conversation_settings (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local',
      opt_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, conversation_id)
    );
    CREATE TABLE IF NOT EXISTS pomodoro_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_minutes INTEGER,
      user_id TEXT NOT NULL DEFAULT 'local'
    );
    CREATE TABLE IF NOT EXISTS discord_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_discord_link (
      openwebui_user_id TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Migrations for existing DBs (ignore if column already exists)
  for (const sql of [
    `ALTER TABLE knowledge_entries ADD COLUMN created_by TEXT`,
    `ALTER TABLE ideas ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`,
    `ALTER TABLE tasks ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`,
    `ALTER TABLE raw_task_items ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`,
    `ALTER TABLE reminders ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`,
    `ALTER TABLE pomodoro_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`,
    `ALTER TABLE conversation_settings ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'`,
  ]) { try { db.exec(sql); } catch {} }
  // Backfill existing rows to 'local' where null
  for (const sql of [
    `UPDATE ideas SET user_id='local' WHERE user_id IS NULL`,
    `UPDATE tasks SET user_id='local' WHERE user_id IS NULL`,
    `UPDATE raw_task_items SET user_id='local' WHERE user_id IS NULL`,
    `UPDATE reminders SET user_id='local' WHERE user_id IS NULL`,
    `UPDATE pomodoro_sessions SET user_id='local' WHERE user_id IS NULL`,
    `UPDATE conversation_settings SET user_id='local' WHERE user_id IS NULL`,
  ]) { try { db.exec(sql); } catch {} }
  // Fix conversation_settings PK for existing DBs: old schema had PRIMARY KEY(conversation_id) only.
  // New schema needs PRIMARY KEY(user_id, conversation_id) to allow same conversation_id per user.
  // Detect old PK and migrate via table recreate.
  try {
    const cols = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='conversation_settings'`).get() as any;
    const createSql: string = cols?.sql ?? "";
    const hasCompositePk = createSql.includes("PRIMARY KEY (user_id, conversation_id)") || createSql.includes("PRIMARY KEY(user_id, conversation_id)");
    if (!hasCompositePk && createSql.includes("conversation_settings")) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_settings_new (
          conversation_id TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'local',
          opt_out INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, conversation_id)
        );
        INSERT OR IGNORE INTO conversation_settings_new (conversation_id, user_id, opt_out, created_at)
          SELECT conversation_id, COALESCE(user_id, 'local'), opt_out, created_at FROM conversation_settings;
        DROP TABLE conversation_settings;
        ALTER TABLE conversation_settings_new RENAME TO conversation_settings;
      `);
    }
  } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ideas_user ON ideas(user_id)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user_deadline ON tasks(user_id, deadline)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_raw_user ON raw_task_items(user_id)`); } catch {}
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[384]);
      CREATE VIRTUAL TABLE IF NOT EXISTS ideas_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[384]);
    `);
  } catch {}
}

export function resetDb(db: Db): void {
  db.exec(`DELETE FROM knowledge_entries; DELETE FROM ideas; DELETE FROM tasks; DELETE FROM raw_task_items; DELETE FROM reminders; DELETE FROM pomodoro_sessions; DELETE FROM conversation_settings; DELETE FROM discord_settings; DELETE FROM user_discord_link;`);
  try { db.exec(`DELETE FROM knowledge_vec; DELETE FROM ideas_vec;`); } catch {}
}
