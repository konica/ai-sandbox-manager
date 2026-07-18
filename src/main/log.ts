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
    command: (argv) => emit('CMD', `$ sbx ${argv.join(' ')}`),
    error: (m) => emit('ERROR', m)
  }
}
