// Materialises a GeneratedKit: spec.yaml into <workspace>/.sandbox/kit, and each
// secret value into a 0600 host file UNDER secretsDir (outside the workspace, so the
// mounted sandbox can't read it). Secret values live ONLY in these host files —
// never in SQLite, never in the mounted workspace, never on the terminal command line.
import type { GeneratedKit } from './generate'

export interface KitFs {
  mkdir(path: string): void
  writeFile(path: string, data: string, mode: number): void
  readFile(path: string): string | null
  rm(path: string): void
}
export interface WriteKitDeps {
  fs: KitFs
  kitDir: string // <workspace>/.sandbox/kit — spec.yaml goes here (mounted into sandbox)
  secretsDir: string // host-only, OUTSIDE the workspace — secret files go here
  gitignorePath: string // <workspace>/.gitignore
}

function ensureGitignored(deps: WriteKitDeps): void {
  const existing = deps.fs.readFile(deps.gitignorePath) ?? ''
  const lines = existing.split('\n').map((l) => l.trim())
  if (lines.includes('.sandbox')) return
  const next = existing.length === 0 ? '.sandbox\n' : existing.replace(/\n?$/, '\n') + '.sandbox\n'
  deps.fs.writeFile(deps.gitignorePath, next, 0o644)
}

export function writeKit(
  kit: GeneratedKit,
  secretValues: Record<string, string>,
  deps: WriteKitDeps
): { kitDir: string; specYaml: string } {
  deps.fs.mkdir(deps.kitDir)

  let specYaml = kit.specYaml
  if (kit.secretFiles.length) {
    deps.fs.mkdir(deps.secretsDir) // host-only, outside the workspace
    for (const f of kit.secretFiles) {
      const value = secretValues[f.credId]
      if (value === undefined) throw new Error(`missing secret value for custom credential "${f.credId}"`)
      const abs = `${deps.secretsDir}/${f.credId}`
      deps.fs.writeFile(abs, value, 0o600)
      specYaml = specYaml.replace(JSON.stringify(f.relPath), JSON.stringify(abs))
    }
  }
  deps.fs.writeFile(`${deps.kitDir}/spec.yaml`, specYaml, 0o644)
  ensureGitignored(deps)
  return { kitDir: deps.kitDir, specYaml }
}
