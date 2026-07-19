import Database from 'better-sqlite3'
import type { Definition, InstanceMeta, DefinitionSpec, MountMode, CredentialRef, CredentialStore, GlobalSecretMeta, PortProtocol } from '@shared/types'

export interface Store {
  insertDefinition(d: Definition): void
  listDefinitions(): Definition[]
  getDefinition(id: string): Definition | null
  insertDefinitionSpec(spec: DefinitionSpec): void
  updateDefinitionSpec(spec: DefinitionSpec): void
  getDefinitionSpec(id: string): DefinitionSpec | null
  upsertInstanceMeta(m: InstanceMeta): void
  listInstanceMeta(): InstanceMeta[]
  deleteInstanceMeta(sbxName: string): void
  listGlobalSecrets(): GlobalSecretMeta[]
  upsertGlobalSecret(g: GlobalSecretMeta): void
  deleteGlobalSecret(id: string): void
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
  host_port INTEGER,                       -- NULL = ephemeral
  container_port INTEGER NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'tcp',
  label TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS host_service (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_port INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS credential_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'service' | 'custom'
  service_id TEXT,                 -- service kind
  cred_id TEXT,                    -- custom kind (kit service id)
  label TEXT NOT NULL DEFAULT '',
  env_var TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',   -- JSON array (custom)
  headers TEXT NOT NULL DEFAULT '[]',   -- JSON array of {name,format} (custom)
  store TEXT NOT NULL DEFAULT 'sbx',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS global_secret (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  env_var TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT 'sbx',
  created_at TEXT NOT NULL
);
PRAGMA user_version = 4;
`

export function openStore(filename: string): Store {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  // Migrate pre-v3 credential_ref (old shape: label, kind) → new shape. Old rows held no
  // secret value and only throwaway metadata, so a drop+recreate is safe pre-release.
  const cols = (db.prepare(`PRAGMA table_info(credential_ref)`).all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('env_var')) {
    db.exec(`DROP TABLE IF EXISTS credential_ref;`)
    db.exec(SCHEMA) // re-creates credential_ref (new shape) + global_secret
  }

  // v3 → v4: port_intent gains `protocol` + nullable host_port; add host_service. Recreate
  // port_intent (old rows are dev throwaway — SQLite can't relax NOT NULL in place).
  const portCols = (db.prepare(`PRAGMA table_info(port_intent)`).all() as { name: string }[]).map((c) => c.name)
  if (!portCols.includes('protocol')) {
    db.exec(`DROP TABLE IF EXISTS port_intent;`)
    db.exec(SCHEMA) // re-creates port_intent (new shape) + host_service
  }

  function insertChildren(s: DefinitionSpec): void {
    const mIns = db.prepare(`INSERT INTO mount_intent (definition_id, host_path, mode, is_primary) VALUES (?, ?, ?, ?)`)
    for (const m of s.mounts) mIns.run(s.definition.id, m.hostPath, m.mode, m.isPrimary ? 1 : 0)
    const dIns = db.prepare(`INSERT INTO policy_domain (definition_id, host) VALUES (?, ?)`)
    for (const host of s.domains) dIns.run(s.definition.id, host)
    const pIns = db.prepare(`INSERT INTO port_intent (definition_id, host_port, container_port, protocol, label) VALUES (?, ?, ?, ?, ?)`)
    for (const p of s.ports) pIns.run(s.definition.id, p.hostPort, p.containerPort, p.protocol, p.label)
    const hsIns = db.prepare(`INSERT INTO host_service (definition_id, host_port, label) VALUES (?, ?, ?)`)
    for (const hs of s.hostServices) hsIns.run(s.definition.id, hs.hostPort, hs.label)
    const cIns = db.prepare(
      `INSERT INTO credential_ref (definition_id, kind, service_id, cred_id, label, env_var, domains, headers, store)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    for (const c of s.credentials) {
      if (c.kind === 'service') {
        cIns.run(s.definition.id, 'service', c.serviceId, null, '', c.envVar, '[]', '[]', c.store)
      } else {
        cIns.run(s.definition.id, 'custom', null, c.id, c.label, c.envVar, JSON.stringify(c.domains), '[]', c.store)
      }
    }
  }

  function deleteChildren(definitionId: string): void {
    for (const table of ['mount_intent', 'policy_domain', 'port_intent', 'host_service', 'credential_ref']) {
      db.prepare(`DELETE FROM ${table} WHERE definition_id = ?`).run(definitionId)
    }
  }

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
        insertChildren(s)
      })
      insertAll(spec)
    },
    updateDefinitionSpec(spec) {
      const updateAll = db.transaction((s: DefinitionSpec) => {
        const res = db.prepare(
          `UPDATE definition SET name = @name, description = @description, base_image = @baseImage, tier = @tier WHERE id = @id`
        ).run(s.definition)
        if (res.changes === 0) throw new Error(`Definition ${s.definition.id} not found`)
        deleteChildren(s.definition.id)
        insertChildren(s)
      })
      updateAll(spec)
    },
    getDefinitionSpec(id) {
      const def = db.prepare(`SELECT id, name, description, base_image AS baseImage, tier, created_at AS createdAt FROM definition WHERE id = ?`).get(id) as Definition | undefined
      if (!def) return null
      const mounts = (db.prepare(`SELECT host_path AS hostPath, mode, is_primary AS isPrimary FROM mount_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPath: String(r.hostPath), mode: String(r.mode) as MountMode, isPrimary: r.isPrimary === 1 }))
      const domains = (db.prepare(`SELECT host FROM policy_domain WHERE definition_id = ? ORDER BY id`).all(id) as Array<{ host: string }>).map((r) => r.host)
      const ports = (db.prepare(`SELECT host_port AS hostPort, container_port AS containerPort, protocol, label FROM port_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPort: r.hostPort === null ? null : Number(r.hostPort), containerPort: Number(r.containerPort), protocol: String(r.protocol) as PortProtocol, label: String(r.label) }))
      const hostServices = (db.prepare(`SELECT host_port AS hostPort, label FROM host_service WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPort: Number(r.hostPort), label: String(r.label) }))
      const credentials = (db.prepare(
        `SELECT kind, service_id AS serviceId, cred_id AS credId, label, env_var AS envVar, domains, store
         FROM credential_ref WHERE definition_id = ? ORDER BY id`
      ).all(id) as Array<{ kind: string; serviceId: string | null; credId: string | null; label: string; envVar: string; domains: string; store: string }>)
        .map((r): CredentialRef =>
          r.kind === 'service'
            ? { kind: 'service', serviceId: r.serviceId!, envVar: r.envVar, store: r.store as CredentialStore }
            : { kind: 'custom', id: r.credId!, label: r.label, envVar: r.envVar, domains: JSON.parse(r.domains), store: r.store as CredentialStore })
      return { definition: def, mounts, domains, ports, hostServices, credentials }
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
    listGlobalSecrets(): GlobalSecretMeta[] {
      return db.prepare(`SELECT id, label, env_var AS envVar, store, created_at AS createdAt FROM global_secret ORDER BY created_at`).all() as GlobalSecretMeta[]
    },
    upsertGlobalSecret(g: GlobalSecretMeta) {
      db.prepare(
        `INSERT INTO global_secret (id, label, env_var, store, created_at) VALUES (@id,@label,@envVar,@store,@createdAt)
         ON CONFLICT(id) DO UPDATE SET label=@label, env_var=@envVar, store=@store`
      ).run(g)
    },
    deleteGlobalSecret(id: string) {
      db.prepare(`DELETE FROM global_secret WHERE id = ?`).run(id)
    },
    close() { db.close() }
  }
}
