import { appendFileSync } from 'fs'

export type LogLevel = 'INFO' | 'CMD' | 'ERROR'

export interface Logger {
  info(message: string): void
  command(argv: string[]): void
  error(message: string): void
}

export interface LoggerOptions {
  /** Append every line to this file (best-effort; write errors are swallowed). */
  file?: string
  /** Where formatted lines go. Defaults to console.log (visible in the dev terminal). */
  sink?: (line: string) => void
  /** Timestamp source; injectable for tests. */
  clock?: () => string
}

export function formatLine(level: LogLevel, text: string, ts: string): string {
  return `${ts} [${level}] ${text}`
}

/**
 * Flags whose argument is a secret. `sbx secret set-custom` offers no stdin path — the value can
 * only be passed on argv — so the logger is the last place we can stop it becoming a plaintext
 * copy in a file people paste into bug reports. Redacting here rather than at each call site means
 * a future command that puts a secret on argv is covered by default.
 *
 * Service and registry credentials never reach argv (`secret set` uses stdin, `--password-stdin`
 * for registries), so this only has to cover the custom-secret flags.
 */
const SECRET_FLAGS = new Set(['--value', '--token', '-t'])
const MASK = '••••'

export function redactArgv(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const inline = /^(--value|--token)=/.exec(arg)
    if (inline) { out.push(`${inline[1]}=${MASK}`); continue }
    out.push(arg)
    // A trailing flag with nothing after it has no value to mask.
    if (SECRET_FLAGS.has(arg) && i + 1 < argv.length) { out.push(MASK); i++ }
  }
  return out
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const clock = opts.clock ?? (() => new Date().toISOString())
  const sink = opts.sink ?? ((line: string) => console.log(line))
  function emit(level: LogLevel, text: string): void {
    const line = formatLine(level, text, clock())
    sink(line)
    if (opts.file) {
      try {
        appendFileSync(opts.file, line + '\n')
      } catch {
        /* logging must never break the app */
      }
    }
  }
  return {
    info: (m) => emit('INFO', m),
    command: (argv) => emit('CMD', `$ sbx ${redactArgv(argv).join(' ')}`),
    error: (m) => emit('ERROR', m)
  }
}
