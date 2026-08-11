// ready.mjs owns a contract the dispatcher parses rather than calls: it appends
// `key=value` lines to GITHUB_OUTPUT, and agent-burn.yml feeds `frontier`
// through fromJSON into a job matrix. A newline inside that value, or a
// diagnostic printed on stdout, breaks the dispatcher in a way no test of the
// pure decision logic would ever catch.
import { describe, it, expect, vi } from 'vitest'
import {
  outputLines,
  writeGithubOutput,
  diagnosticLines,
  readConfigFile
} from '../../scripts/burn/ready.mjs'
import { loadConfig } from '../../scripts/burn/config.mjs'

const cfg = loadConfig()

function result(over = {}) {
  return {
    ready: [],
    skipped: [],
    inFlight: [],
    slots: 2,
    handedOver: [],
    stalled: false,
    ...over
  }
}

const twoTickets = [
  { number: 10, title: '1 — First ticket', branch: 'agent/10-first-ticket' },
  { number: 11, title: '2 — Second ticket', branch: 'agent/11-second-ticket' }
]

describe('outputLines', () => {
  it('emits exactly the four keys the dispatcher reads, each on its own line', () => {
    const text = outputLines(result({ ready: twoTickets, slots: 2 }))
    expect(text.endsWith('\n')).toBe(true)
    expect(text.split('\n').filter(Boolean).map((l) => l.split('=')[0])).toEqual([
      'frontier', 'count', 'slots', 'stalled'
    ])
  })

  it('keeps the frontier JSON on a single line', () => {
    const text = outputLines(result({ ready: twoTickets }))
    const frontier = text.split('\n').find((l) => l.startsWith('frontier='))
    expect(frontier).toBe(`frontier=${JSON.stringify(twoTickets)}`)
    expect(frontier).not.toContain('\n')
    // The pretty-printed form is what stdout carries; it must never leak here.
    expect(text).not.toContain('  ')
  })

  it('round-trips through JSON.parse the way fromJSON does', () => {
    const frontier = outputLines(result({ ready: twoTickets }))
      .split('\n')[0]
      .slice('frontier='.length)
    expect(JSON.parse(frontier)).toEqual(twoTickets)
  })

  it('emits an empty array rather than nothing when there is no work', () => {
    expect(outputLines(result())).toContain('frontier=[]\n')
    expect(outputLines(result())).toContain('count=0\n')
  })

  it('reports count and slots as bare numbers', () => {
    const text = outputLines(result({ ready: twoTickets, slots: 0 }))
    expect(text).toContain('count=2\n')
    expect(text).toContain('slots=0\n')
  })

  it('reports stalled as a lowercase boolean literal', () => {
    expect(outputLines(result({ stalled: false }))).toContain('stalled=false\n')
    expect(outputLines(result({ stalled: true, slots: 0 }))).toContain('stalled=true\n')
  })

  it('survives a title containing quotes and newlines without breaking the line format', () => {
    const nasty = [{ number: 7, title: 'a "quoted"\nmultiline title', branch: 'agent/7-a' }]
    const text = outputLines(result({ ready: nasty }))
    expect(text.split('\n').filter(Boolean)).toHaveLength(4)
  })
})

describe('writeGithubOutput', () => {
  it('appends the output lines to the file named by GITHUB_OUTPUT', async () => {
    const appendFile = vi.fn().mockResolvedValue(undefined)
    const wrote = await writeGithubOutput(result({ ready: twoTickets }), {
      env: { GITHUB_OUTPUT: '/tmp/out.txt' },
      appendFile
    })
    expect(wrote).toBe(true)
    expect(appendFile).toHaveBeenCalledWith('/tmp/out.txt', outputLines(result({ ready: twoTickets })))
  })

  it('writes nothing outside Actions, where GITHUB_OUTPUT is unset', async () => {
    const appendFile = vi.fn()
    expect(await writeGithubOutput(result(), { env: {}, appendFile })).toBe(false)
    expect(appendFile).not.toHaveBeenCalled()
  })
})

describe('diagnosticLines', () => {
  it('summarises counts on the first line', () => {
    const lines = diagnosticLines(result({ inFlight: [1], slots: 1 }), cfg, { candidateCount: 3 })
    expect(lines[0]).toBe('candidates: 3  in-flight: 1  slots: 1')
  })

  it('lists every skip with its reason and every ready ticket with its branch', () => {
    const lines = diagnosticLines(
      result({ ready: twoTickets, skipped: [{ number: 5, reason: 'blocked-by:4' }] }),
      cfg,
      { candidateCount: 3 }
    )
    expect(lines).toContain('  skip #5: blocked-by:4')
    expect(lines).toContain('  ready #10: 1 — First ticket -> agent/10-first-ticket')
  })

  it('says nothing about a stall when the queue is merely idle', () => {
    expect(diagnosticLines(result(), cfg, { candidateCount: 0 }).join('\n')).not.toContain('STALLED')
  })

  // An empty frontier is indistinguishable from an empty backlog. This line is
  // the only thing that tells a human the queue is blocked on them.
  it('shouts, and names the tickets, when every slot is held by a handed-over ticket', () => {
    const lines = diagnosticLines(
      result({ slots: 0, inFlight: [10, 11], handedOver: [10, 11], stalled: true }),
      cfg,
      { candidateCount: 3 }
    )
    const stall = lines.find((l) => l.startsWith('STALLED'))
    expect(stall).toBeDefined()
    expect(stall).toContain('#10')
    expect(stall).toContain('#11')
    expect(stall).toContain(cfg.needsHumanLabel)
    expect(stall).toContain('blocked on you')
  })

  it('uses the configured needs-human label, not a hard-coded one', () => {
    const custom = loadConfig({ needsHumanLabel: 'stuck' })
    const lines = diagnosticLines(
      result({ slots: 0, inFlight: [10, 11], handedOver: [10, 11], stalled: true }),
      custom,
      { candidateCount: 2 }
    )
    expect(lines.find((l) => l.startsWith('STALLED'))).toContain('stuck')
  })

  it('returns lines only — the caller decides they go to stderr', () => {
    const lines = diagnosticLines(result({ ready: twoTickets }), cfg, { candidateCount: 2 })
    expect(Array.isArray(lines)).toBe(true)
    for (const l of lines) expect(typeof l).toBe('string')
    // No diagnostic may be valid JSON, or piping stdout and stderr together
    // would silently corrupt the matrix.
    expect(lines.join('\n')).not.toContain('"branch"')
  })
})

describe('readConfigFile', () => {
  it('treats a missing config file as an empty config', async () => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }))
    expect(await readConfigFile({ readFile })).toEqual({})
    expect(readFile).toHaveBeenCalledWith('.github/agent-burn.json', 'utf8')
  })

  it('parses a present config file', async () => {
    const readFile = vi.fn().mockResolvedValue('{"maxConcurrent":3}')
    expect(await readConfigFile({ readFile })).toEqual({ maxConcurrent: 3 })
  })

  it('fails loudly on malformed JSON rather than falling back to defaults', async () => {
    const readFile = vi.fn().mockResolvedValue('{nope}')
    await expect(readConfigFile({ readFile })).rejects.toThrow(/agent-burn\.json/)
  })

  it('fails loudly on an unreadable file', async () => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
    await expect(readConfigFile({ readFile })).rejects.toThrow(/denied/)
  })
})
