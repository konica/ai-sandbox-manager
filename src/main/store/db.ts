import Database from 'better-sqlite3'
import type { Definition, InstanceMeta } from '@shared/types'

export interface Store {
  insertDefinition(d: Definition): void
  listDefinitions(): Definition[]
  getDefinition(id: string): Definition | null
  upsertInstanceMeta(m: InstanceMeta): void
  listInstanceMeta(): InstanceMeta[]
  deleteInstanceMeta(sbxName: string): void
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS definition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_image TEXT NOT NULL,
  tier TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS instance_meta (
  sbx_name TEXT PRIMARY KEY,
  definition_id TEXT,
  created_by_app INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS app_prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
`

export function openStore(filename: string): Store {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  return {
    insertDefinition(d) {
      db.prepare(
        `INSERT INTO definition (id, name, description, base_image, tier, created_at)
         VALUES (@id, @name, @description, @baseImage, @tier, @createdAt)`
      ).run(d)
    },
    listDefinitions() {
      return db.prepare(`SELECT id, name, description, base_image AS baseImage, tier, created_at AS createdAt FROM definition ORDER BY created_at DESC`).all() as Definition[]
    },
    getDefinition(id) {
      const row = db.prepare(`SELECT id, name, description, base_image AS baseImage, tier, created_at AS createdAt FROM definition WHERE id = ?`).get(id)
      return (row as Definition) ?? null
    },
    upsertInstanceMeta(m) {
      db.prepare(
        `INSERT INTO instance_meta (sbx_name, definition_id, created_by_app, created_at)
         VALUES (@sbxName, @definitionId, @createdByApp, @createdAt)
         ON CONFLICT(sbx_name) DO UPDATE SET
           definition_id = excluded.definition_id,
           created_by_app = excluded.created_by_app,
           created_at = excluded.created_at`
      ).run({ ...m, createdByApp: m.createdByApp ? 1 : 0 })
    },
    listInstanceMeta() {
      const rows = db.prepare(`SELECT sbx_name AS sbxName, definition_id AS definitionId, created_by_app AS createdByApp, created_at AS createdAt FROM instance_meta`).all() as Array<Record<string, unknown>>
      return rows.map((r) => ({ sbxName: String(r.sbxName), definitionId: r.definitionId ? String(r.definitionId) : null, createdByApp: r.createdByApp === 1, createdAt: String(r.createdAt) }))
    },
    deleteInstanceMeta(sbxName) {
      db.prepare(`DELETE FROM instance_meta WHERE sbx_name = ?`).run(sbxName)
    },
    close() { db.close() }
  }
}
