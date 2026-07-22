import yaml from 'js-yaml'

const ALLOWED_CMD = new Set(['install', 'startup', 'initFiles'])

/**
 * Validate + normalize a user-supplied kit `commands:` block (install/startup/initFiles).
 * Shared by the wizard (Reformat + save gate) and the main process (kit merge + validate).
 * Empty/whitespace input is valid and yields ''. Only a single top-level `commands` key is
 * allowed; deeper structural validation is left to `sbx kit validate` (advisory).
 */
export function normalizeCommandsYaml(text: string): { ok: true; yaml: string } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, yaml: '' }
  let doc: unknown
  try {
    doc = yaml.load(trimmed)
  } catch (e) {
    return { ok: false, error: `Invalid YAML: ${(e as Error).message}` }
  }
  if (doc == null) return { ok: true, yaml: '' }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'Expected a YAML mapping with a top-level "commands:" key.' }
  }
  const obj = doc as Record<string, unknown>
  const extra = Object.keys(obj).filter((k) => k !== 'commands')
  if (extra.length) return { ok: false, error: `Only a top-level "commands:" key is allowed (found: ${extra.join(', ')}).` }
  const commands = obj.commands
  if (commands === undefined) return { ok: false, error: 'Missing "commands:" key.' }
  if (typeof commands !== 'object' || commands === null || Array.isArray(commands)) {
    return { ok: false, error: '"commands" must be a mapping of install/startup/initFiles.' }
  }
  const cmd = commands as Record<string, unknown>
  const badKeys = Object.keys(cmd).filter((k) => !ALLOWED_CMD.has(k))
  if (badKeys.length) return { ok: false, error: `commands supports only install, startup, initFiles (found: ${badKeys.join(', ')}).` }
  if ('install' in cmd && typeof cmd.install !== 'string') return { ok: false, error: 'commands.install must be a string.' }
  if ('startup' in cmd && typeof cmd.startup !== 'string') return { ok: false, error: 'commands.startup must be a string.' }
  if ('initFiles' in cmd && !Array.isArray(cmd.initFiles)) return { ok: false, error: 'commands.initFiles must be a list.' }
  return { ok: true, yaml: yaml.dump({ commands: cmd }, { lineWidth: -1 }).trimEnd() + '\n' }
}
