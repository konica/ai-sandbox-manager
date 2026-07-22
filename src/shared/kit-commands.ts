import yaml from 'js-yaml'

/**
 * Validate + normalize a user-supplied kit `commands:` block.
 *
 * This is only the SAVE GATE / merge-safety check: it guarantees the pasted text is
 * parseable YAML and a single top-level `commands:` mapping, so it merges cleanly into the
 * app-generated kit (which owns network/name). It deliberately does NOT validate the shape
 * of the commands themselves — the real kit schema is rich (`install`/`startup` are lists of
 * `{description, command}` steps, `initFiles` a list of `{path, contents}`), and asserting it
 * here both duplicates and can contradict the authority. Deep validation is `sbx kit validate`
 * (advisory, via the Validate button). Empty/whitespace input is valid and yields ''.
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
  if (extra.length) return { ok: false, error: `Only a top-level "commands:" key is allowed here (found: ${extra.join(', ')}). The app owns network/name.` }
  const commands = obj.commands
  if (commands === undefined) return { ok: false, error: 'Missing "commands:" key.' }
  if (typeof commands !== 'object' || commands === null || Array.isArray(commands)) {
    return { ok: false, error: '"commands" must be a mapping (e.g. install:/startup:/initFiles:).' }
  }
  return { ok: true, yaml: yaml.dump({ commands }, { lineWidth: -1 }).trimEnd() + '\n' }
}
