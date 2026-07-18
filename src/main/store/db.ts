import Database from 'better-sqlite3'
import type { Definition, InstanceMeta, DefinitionSpec, MountMode, CredentialKind } from '@shared/types'

export interface Store {
  insertDefinition(d: Definition): void
  listDefinitions(): Definition[]
  getDefinition(id: string): Definition | null
  insertDefinitionSpec(spec: DefinitionSpec): void
  getDefinitionSpec(id: string): DefinitionSpec | null
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
CREATE TABLE IF NOT EXISTS mount_intent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS policy_domain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host TEXT NOT NULL,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS port_intent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_port INTEGER NOT NULL,
  container_port INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS credential_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
PRAGMA user_version = 2;
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
    insertDefinitionSpec(spec) {
      const insertAll = db.transaction((s: DefinitionSpec) => {
        db.prepare(
          `INSERT INTO definition (id, name, description, base_image, tier, created_at)
           VALUES (@id, @name, @description, @baseImage, @tier, @createdAt)`
        ).run(s.definition)
        const mIns = db.prepare(`INSERT INTO mount_intent (definition_id, host_path, mode, is_primary) VALUES (?, ?, ?, ?)`)
        for (const m of s.mounts) mIns.run(s.definition.id, m.hostPath, m.mode, m.isPrimary ? 1 : 0)
        const dIns = db.prepare(`INSERT INTO policy_domain (definition_id, host) VALUES (?, ?)`)
        for (const host of s.domains) dIns.run(s.definition.id, host)
        const pIns = db.prepare(`INSERT INTO port_intent (definition_id, host_port, container_port, label) VALUES (?, ?, ?, ?)`)
        for (const p of s.ports) pIns.run(s.definition.id, p.hostPort, p.containerPort, p.label)
        const cIns = db.prepare(`INSERT INTO credential_ref (definition_id, label, kind) VALUES (?, ?, ?)`)
        for (const c of s.credentials) cIns.run(s.definition.id, c.label, c.kind)
      })
      insertAll(spec)
    },
    getDefinitionSpec(id) {
      const def = db.prepare(`SELECT id, name, description, base_image AS baseImage, tier, created_at AS createdAt FROM definition WHERE id = ?`).get(id) as Definition | undefined
      if (!def) return null
      const mounts = (db.prepare(`SELECT host_path AS hostPath, mode, is_primary AS isPrimary FROM mount_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPath: String(r.hostPath), mode: String(r.mode) as MountMode, isPrimary: r.isPrimary === 1 }))
      const domains = (db.prepare(`SELECT host FROM policy_domain WHERE definition_id = ? ORDER BY id`).all(id) as Array<{ host: string }>).map((r) => r.host)
      const ports = (db.prepare(`SELECT host_port AS hostPort, container_port AS containerPort, label FROM port_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPort: Number(r.hostPort), containerPort: Number(r.containerPort), label: String(r.label) }))
      const credentials = (db.prepare(`SELECT label, kind FROM credential_ref WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ label: String(r.label), kind: String(r.kind) as CredentialKind }))
      return { definition: def, mounts, domains, ports, credentials }
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
