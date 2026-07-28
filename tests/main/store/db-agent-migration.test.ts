import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openStore } from '@main/store/db'

describe('agent column migration', () => {
  it('backfills agent from the base_image suffix for pre-migration rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-db-'))
    const file = join(dir, 'test.db')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE definition (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        base_image TEXT NOT NULL,
        tier TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ssh_forward_agent INTEGER NOT NULL DEFAULT 1,
        ssh_commit_signing INTEGER NOT NULL DEFAULT 0,
        kit_commands_yaml TEXT
      );
    `)
    const ins = raw.prepare(`INSERT INTO definition (id, name, description, base_image, tier, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    ins.run('d1', 'Proj', '', 'docker.io/docker/sandbox-templates:opencode', 'locked', 't')
    ins.run('d2', 'Other', '', 'docker.io/docker/sandbox-templates:claude-code', 'locked', 't')
    ins.run('d3', 'Custom', '', 'my/custom:tag', 'locked', 't')
    raw.close()

    const store = openStore(file)
    expect(store.getDefinition('d1')?.agent).toBe('opencode')
    expect(store.getDefinition('d2')?.agent).toBe('claude')
    expect(store.getDefinition('d3')?.agent).toBe('claude')
    store.close()
  })

  it('is idempotent across repeated opens of the same already-migrated database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-db-'))
    const file = join(dir, 'test.db')

    // First open: performs the migration (fresh DB has no definition rows yet, but the
    // ALTER TABLE / column-existence guard still runs).
    const store1 = openStore(file)
    store1.insertDefinitionSpec({
      definition: { id: 'd1', name: 'Proj', description: '', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:codex', tier: 'locked', createdAt: 't' },
      mounts: [], domains: [], ports: [], hostServices: [], credentials: [], ssh: { forwardAgent: true, commitSigning: false }, copyFiles: []
    })
    store1.close()

    // Second open of the SAME file: the `agent` column already exists, so openStore must
    // not error (no duplicate-column ALTER) and must not re-run the base_image backfill
    // (which would be a no-op here since agent already reflects reality, but a rerun that
    // throws would break every subsequent app launch).
    expect(() => {
      const store2 = openStore(file)
      expect(store2.getDefinition('d1')?.agent).toBe('claude')
      store2.close()
    }).not.toThrow()

    // Third open, to really hammer on repeated-open safety.
    const store3 = openStore(file)
    expect(store3.getDefinition('d1')?.agent).toBe('claude')
    store3.close()
  })
})
