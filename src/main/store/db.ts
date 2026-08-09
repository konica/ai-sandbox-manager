import Database from 'better-sqlite3'
import type { Definition, InstanceMeta, DefinitionSpec, MountMode, CredentialRef, CredentialStore, GlobalSecretMeta, PortProtocol, RegistryScope, CopyFileIntent } from '@shared/types'
import { DEFAULT_SSH } from '@shared/types'

export interface Store {
  insertDefinition(d: Definition): void
  listDefinitions(): Definition[]
  getDefinition(id: string): Definition | null
  insertDefinitionSpec(spec: DefinitionSpec): void
  updateDefinitionSpec(spec: DefinitionSpec): void
  getDefinitionSpec(id: string): DefinitionSpec | null
  deleteDefinition(id: string): void
  upsertInstanceMeta(m: InstanceMeta): void
  listInstanceMeta(): InstanceMeta[]
  deleteInstanceMeta(sbxName: string): void
  updateInstanceFingerprint(sbxName: string, fingerprint: string): void
  setInstanceTags(sbxName: string, tags: string[]): void
  listInstanceTags(): Map<string, string[]>
  deleteInstanceTags(sbxName: string): void
  listGlobalSecrets(): GlobalSecretMeta[]
  upsertGlobalSecret(g: GlobalSecretMeta): void
  deleteGlobalSecret(id: string): void
  getPref(key: string): string | null
  setPref(key: string, value: string): void
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS definition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_image TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'claude',
  tier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ssh_forward_agent INTEGER NOT NULL DEFAULT 1,
  ssh_commit_signing INTEGER NOT NULL DEFAULT 0,
  kit_commands_yaml TEXT,
  cpus INTEGER,
  memory TEXT,
  disk_size TEXT
);
CREATE TABLE IF NOT EXISTS instance_meta (
  sbx_name TEXT PRIMARY KEY,
  definition_id TEXT,
  created_by_app INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  cred_fingerprint TEXT,
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
CREATE TABLE IF NOT EXISTS copy_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_path TEXT NOT NULL,
  sandbox_path TEXT NOT NULL,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS credential_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'service' | 'custom' | 'registry'
  service_id TEXT,                 -- service kind
  cred_id TEXT,                    -- custom / registry kind (slug)
  label TEXT NOT NULL DEFAULT '',
  env_var TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',   -- JSON array (custom)
  headers TEXT NOT NULL DEFAULT '[]',   -- JSON array of {name,format} (custom)
  store TEXT NOT NULL DEFAULT 'sbx',
  host TEXT,                       -- registry kind: hostname
  username TEXT,                   -- registry kind: optional username
  scope TEXT,                      -- registry kind: 'host' | 'global' | 'sandbox'
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS global_secret (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  env_var TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT 'sbx',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS instance_tag (
  sbx_name TEXT NOT NULL,
  tag      TEXT NOT NULL,
  PRIMARY KEY (sbx_name, tag)
);
PRAGMA user_version = 12;
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
  // v4 → v5: registry credentials add host/username/scope. Non-destructive ADD COLUMN
  // preserves existing service/custom refs.
  if (!cols.includes('host')) {
    for (const col of ['host TEXT', 'username TEXT', 'scope TEXT']) {
      db.exec(`ALTER TABLE credential_ref ADD COLUMN ${col};`)
    }
  }
  // v5 → v6: definitions gain SSH agent forward + commit-signing flags. Non-destructive.
  const defCols = (db.prepare(`PRAGMA table_info(definition)`).all() as { name: string }[]).map((c) => c.name)
  if (!defCols.includes('ssh_forward_agent')) {
    db.exec(`ALTER TABLE definition ADD COLUMN ssh_forward_agent INTEGER NOT NULL DEFAULT 1;`)
    db.exec(`ALTER TABLE definition ADD COLUMN ssh_commit_signing INTEGER NOT NULL DEFAULT 0;`)
  }
  // v6 → v7: instance_meta records the credential fingerprint at create time so we can flag
  // credential drift (→ needs rebuild). Non-destructive; existing rows stay null (no drift shown).
  const imCols = (db.prepare(`PRAGMA table_info(instance_meta)`).all() as { name: string }[]).map((c) => c.name)
  if (!imCols.includes('cred_fingerprint')) {
    db.exec(`ALTER TABLE instance_meta ADD COLUMN cred_fingerprint TEXT;`)
  }
  // v7 → v8: definitions gain an optional custom kit commands block. Non-destructive.
  if (!defCols.includes('kit_commands_yaml')) {
    db.exec(`ALTER TABLE definition ADD COLUMN kit_commands_yaml TEXT;`)
  }
  // v9 → v10: definitions gain an agent keyword (multi-agent support). Non-destructive;
  // backfill from base_image's known variant suffix so pre-existing rows keep the agent
  // they were actually built for (unrecognized/custom images default to 'claude', which
  // is what every definition ran as before this column existed).
  if (!defCols.includes('agent')) {
    db.exec(`ALTER TABLE definition ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude';`)
    db.exec(`UPDATE definition SET agent = 'opencode' WHERE base_image LIKE '%:opencode';`)
    db.exec(`UPDATE definition SET agent = 'codex' WHERE base_image LIKE '%:codex';`)
    db.exec(`UPDATE definition SET agent = 'copilot' WHERE base_image LIKE '%:copilot';`)
  }
  // v10 → v11: definitions gain optional CPU/memory limits (create-time only).
  // Non-destructive; existing rows stay NULL → the flag is omitted at create and
  // sbx applies its own defaults.
  if (!defCols.includes('cpus')) {
    db.exec(`ALTER TABLE definition ADD COLUMN cpus INTEGER;`)
    db.exec(`ALTER TABLE definition ADD COLUMN memory TEXT;`)
  }
  // v11 → v12: definitions gain an optional block-volume size (create-time only, applied
  // via the DOCKER_SANDBOXES_DOCKER_SIZE env var — sbx has no CLI flag for it).
  // Non-destructive; NULL → env var omitted → sbx's 50 GB default.
  if (!defCols.includes('disk_size')) {
    db.exec(`ALTER TABLE definition ADD COLUMN disk_size TEXT;`)
  }

  // v3 → v4: port_intent gains `protocol` + nullable host_port; add host_service. Recreate
  // port_intent (old rows are dev throwaway — SQLite can't relax NOT NULL in place).
  const portCols = (db.prepare(`PRAGMA table_info(port_intent)`).all() as { name: string }[]).map((c) => c.name)
  if (!portCols.includes('protocol')) {
    db.exec(`DROP TABLE IF EXISTS port_intent;`)
    db.exec(SCHEMA) // re-creates port_intent (new shape) + host_service
  }

  // NULL columns come back as JS null; the Definition type uses optional (undefined).
  function defWithLimits(row: Record<string, unknown>): Definition {
    return {
      id: String(row.id), name: String(row.name), description: String(row.description),
      baseImage: String(row.baseImage), agent: row.agent as Definition['agent'], tier: row.tier as Definition['tier'],
      createdAt: String(row.createdAt),
      cpus: row.cpus == null ? undefined : Number(row.cpus),
      memory: row.memory == null ? undefined : String(row.memory),
      diskSize: row.disk_size == null ? undefined : String(row.disk_size)
    }
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
    const cfIns = db.prepare(`INSERT INTO copy_file (definition_id, host_path, sandbox_path) VALUES (?, ?, ?)`)
    for (const cf of s.copyFiles ?? []) cfIns.run(s.definition.id, cf.hostPath, cf.sandboxPath)
    const cIns = db.prepare(
      `INSERT INTO credential_ref (definition_id, kind, service_id, cred_id, label, env_var, domains, headers, store, host, username, scope)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    for (const c of s.credentials) {
      if (c.kind === 'service') {
        cIns.run(s.definition.id, 'service', c.serviceId, null, '', c.envVar, '[]', '[]', c.store, null, null, null)
      } else if (c.kind === 'registry') {
        cIns.run(s.definition.id, 'registry', null, c.id, '', '', '[]', '[]', c.store, c.host, c.username ?? null, c.scope)
      } else {
        cIns.run(s.definition.id, 'custom', null, c.id, c.label, c.envVar, JSON.stringify(c.domains), '[]', c.store, null, null, null)
      }
    }
  }

  function deleteChildren(definitionId: string): void {
    for (const table of ['mount_intent', 'policy_domain', 'port_intent', 'host_service', 'credential_ref', 'copy_file']) {
      db.prepare(`DELETE FROM ${table} WHERE definition_id = ?`).run(definitionId)
    }
  }

  return {
    insertDefinition(d) {
      db.prepare(
        `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at, cpus, memory, disk_size)
         VALUES (@id, @name, @description, @baseImage, @agent, @tier, @createdAt, @cpus, @memory, @diskSize)`
      ).run({ ...d, cpus: d.cpus ?? null, memory: d.memory ?? null, diskSize: d.diskSize ?? null })
    },
    listDefinitions() {
      const rows = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt, cpus, memory, disk_size FROM definition ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>
      return rows.map(defWithLimits)
    },
    getDefinition(id) {
      const row = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt, cpus, memory, disk_size FROM definition WHERE id = ?`).get(id) as Record<string, unknown> | undefined
      return row ? defWithLimits(row) : null
    },
    insertDefinitionSpec(spec) {
      const insertAll = db.transaction((s: DefinitionSpec) => {
        const ssh = s.ssh ?? DEFAULT_SSH
        db.prepare(
          `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at, ssh_forward_agent, ssh_commit_signing, kit_commands_yaml, cpus, memory, disk_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(s.definition.id, s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier, s.definition.createdAt,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.cpus ?? null, s.definition.memory ?? null, s.definition.diskSize ?? null)
        insertChildren(s)
      })
      insertAll(spec)
    },
    updateDefinitionSpec(spec) {
      const updateAll = db.transaction((s: DefinitionSpec) => {
        const ssh = s.ssh ?? DEFAULT_SSH
        const res = db.prepare(
          `UPDATE definition SET name = ?, description = ?, base_image = ?, agent = ?, tier = ?, ssh_forward_agent = ?, ssh_commit_signing = ?, kit_commands_yaml = ?, cpus = ?, memory = ?, disk_size = ? WHERE id = ?`
        ).run(s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.cpus ?? null, s.definition.memory ?? null, s.definition.diskSize ?? null, s.definition.id)
        if (res.changes === 0) throw new Error(`Definition ${s.definition.id} not found`)
        deleteChildren(s.definition.id)
        insertChildren(s)
      })
      updateAll(spec)
    },
    getDefinitionSpec(id) {
      const row = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt, cpus, memory, disk_size FROM definition WHERE id = ?`).get(id) as Record<string, unknown> | undefined
      if (!row) return null
      const def = defWithLimits(row)
      const mounts = (db.prepare(`SELECT host_path AS hostPath, mode, is_primary AS isPrimary FROM mount_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPath: String(r.hostPath), mode: String(r.mode) as MountMode, isPrimary: r.isPrimary === 1 }))
      const domains = (db.prepare(`SELECT host FROM policy_domain WHERE definition_id = ? ORDER BY id`).all(id) as Array<{ host: string }>).map((r) => r.host)
      const ports = (db.prepare(`SELECT host_port AS hostPort, container_port AS containerPort, protocol, label FROM port_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPort: r.hostPort === null ? null : Number(r.hostPort), containerPort: Number(r.containerPort), protocol: String(r.protocol) as PortProtocol, label: String(r.label) }))
      const hostServices = (db.prepare(`SELECT host_port AS hostPort, label FROM host_service WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPort: Number(r.hostPort), label: String(r.label) }))
      const copyFiles = (db.prepare(`SELECT host_path AS hostPath, sandbox_path AS sandboxPath FROM copy_file WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r): CopyFileIntent => ({ hostPath: String(r.hostPath), sandboxPath: String(r.sandboxPath) }))
      const credentials = (db.prepare(
        `SELECT kind, service_id AS serviceId, cred_id AS credId, label, env_var AS envVar, domains, store, host, username, scope
         FROM credential_ref WHERE definition_id = ? ORDER BY id`
      ).all(id) as Array<{ kind: string; serviceId: string | null; credId: string | null; label: string; envVar: string; domains: string; store: string; host: string | null; username: string | null; scope: string | null }>)
        .map((r): CredentialRef => {
          if (r.kind === 'service') return { kind: 'service', serviceId: r.serviceId!, envVar: r.envVar, store: r.store as CredentialStore }
          if (r.kind === 'registry') return { kind: 'registry', id: r.credId!, host: r.host!, username: r.username ?? undefined, scope: r.scope as RegistryScope, store: r.store as CredentialStore }
          return { kind: 'custom', id: r.credId!, label: r.label, envVar: r.envVar, domains: JSON.parse(r.domains), store: r.store as CredentialStore }
        })
      const sshRow = db.prepare(`SELECT ssh_forward_agent AS fwd, ssh_commit_signing AS sign FROM definition WHERE id = ?`).get(id) as { fwd: number; sign: number } | undefined
      const ssh = { forwardAgent: (sshRow?.fwd ?? 1) === 1, commitSigning: (sshRow?.sign ?? 0) === 1 }
      const kitRow = db.prepare(`SELECT kit_commands_yaml AS y FROM definition WHERE id = ?`).get(id) as { y: string | null } | undefined
      const kitCommandsYaml = kitRow?.y ?? undefined
      return { definition: def, mounts, domains, ports, hostServices, credentials, ssh, kitCommandsYaml, copyFiles }
    },
    deleteDefinition(id) {
      // FK cascade isn't enabled, so remove children explicitly, then the row.
      const del = db.transaction((defId: string) => {
        deleteChildren(defId)
        db.prepare(`DELETE FROM definition WHERE id = ?`).run(defId)
      })
      del(id)
    },
    upsertInstanceMeta(m) {
      db.prepare(
        `INSERT INTO instance_meta (sbx_name, definition_id, created_by_app, created_at, cred_fingerprint)
         VALUES (@sbxName, @definitionId, @createdByApp, @createdAt, @credFingerprint)
         ON CONFLICT(sbx_name) DO UPDATE SET
           definition_id = excluded.definition_id,
           created_by_app = excluded.created_by_app,
           created_at = excluded.created_at,
           cred_fingerprint = excluded.cred_fingerprint`
      ).run({ ...m, createdByApp: m.createdByApp ? 1 : 0, credFingerprint: m.credFingerprint ?? null })
    },
    listInstanceMeta() {
      const rows = db.prepare(`SELECT sbx_name AS sbxName, definition_id AS definitionId, created_by_app AS createdByApp, created_at AS createdAt, cred_fingerprint AS credFingerprint FROM instance_meta`).all() as Array<Record<string, unknown>>
      return rows.map((r) => ({ sbxName: String(r.sbxName), definitionId: r.definitionId ? String(r.definitionId) : null, createdByApp: r.createdByApp === 1, createdAt: String(r.createdAt), credFingerprint: r.credFingerprint != null ? String(r.credFingerprint) : null }))
    },
    deleteInstanceMeta(sbxName) {
      db.prepare(`DELETE FROM instance_tag WHERE sbx_name = ?`).run(sbxName)
      db.prepare(`DELETE FROM instance_meta WHERE sbx_name = ?`).run(sbxName)
    },
    updateInstanceFingerprint(sbxName, fingerprint) {
      db.prepare(`UPDATE instance_meta SET cred_fingerprint = ? WHERE sbx_name = ?`).run(fingerprint, sbxName)
    },
    setInstanceTags(sbxName, tags) {
      const tx = db.transaction((name: string, ts: string[]) => {
        db.prepare(`DELETE FROM instance_tag WHERE sbx_name = ?`).run(name)
        const ins = db.prepare(`INSERT OR IGNORE INTO instance_tag (sbx_name, tag) VALUES (?, ?)`)
        for (const tag of ts) ins.run(name, tag)
      })
      tx(sbxName, tags)
    },
    listInstanceTags() {
      const rows = db.prepare(`SELECT sbx_name AS sbxName, tag FROM instance_tag ORDER BY rowid`).all() as Array<{ sbxName: string; tag: string }>
      const map = new Map<string, string[]>()
      for (const r of rows) {
        const arr = map.get(r.sbxName) ?? []
        arr.push(r.tag)
        map.set(r.sbxName, arr)
      }
      return map
    },
    deleteInstanceTags(sbxName) {
      db.prepare(`DELETE FROM instance_tag WHERE sbx_name = ?`).run(sbxName)
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
    getPref(key) {
      const row = db.prepare(`SELECT value FROM app_prefs WHERE key = ?`).get(key) as { value: string } | undefined
      return row?.value ?? null
    },
    setPref(key, value) {
      db.prepare(`INSERT INTO app_prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
    },
    close() { db.close() }
  }
}
