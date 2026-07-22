import Database from 'better-sqlite3'

/**
 * Exercise the packaged native module end-to-end: open an in-memory SQLite
 * database and round-trip a value. Returns true iff better-sqlite3 loaded and
 * executed — the exact failure a packaged Electron app hits on an ABI mismatch
 * or an un-unpacked .node. Kept dependency-free of the app schema so it tests
 * only the native binary.
 */
export function runSmoke(): boolean {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE t (x INTEGER)')
    db.prepare('INSERT INTO t (x) VALUES (?)').run(42)
    const row = db.prepare('SELECT x FROM t').get() as { x: number } | undefined
    return row?.x === 42
  } finally {
    db.close()
  }
}
