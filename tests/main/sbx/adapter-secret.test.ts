import { describe, it, expect } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '../../../src/main/sbx/adapter'
import { createLogger } from '../../../src/main/log'

function fakeSpawn() {
  const calls: { args: string[]; stdin?: string }[] = []
  const spawn: SpawnFn = (_cmd, args, opts) => {
    calls.push({ args, stdin: opts?.stdin })
    return Promise.resolve({ stdout: '', stderr: '', code: 0 })
  }
  return { spawn, calls }
}

describe('adapter.setSecret / removeSecret', () => {
  it('pipes the value on stdin for a global service secret', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.setSecret('anthropic', 'sk-ant-xyz', { global: true })
    expect(calls[0].args).toEqual(['secret', 'set', '-g', 'anthropic'])
    expect(calls[0].stdin).toBe('sk-ant-xyz')
  })
  it('uses the sandbox name when scoped', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.setSecret('openai', 'v', { sandbox: 'my-box' })
    expect(calls[0].args).toEqual(['secret', 'set', 'my-box', 'openai'])
  })
  it('removes a global secret with -f', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.removeSecret('github', { global: true })
    expect(calls[0].args).toEqual(['secret', 'rm', '-g', 'github', '-f'])
  })
})

describe('adapter.setCustomSecret / removeCustomSecret', () => {
  it('registers a sandbox-scoped custom secret with one --host per domain', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.setCustomSecret(['api.acme.com', '*.acme.io'], 'ACME_KEY', 's3cr3t', { sandbox: 'box-1' })
    expect(calls[0].args).toEqual(['secret', 'set-custom', 'box-1', '--host', 'api.acme.com', '--host', '*.acme.io', '--env', 'ACME_KEY', '--value', 's3cr3t'])
  })
  it('removes a sandbox-scoped custom secret by host', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.removeCustomSecret(['api.acme.com'], { sandbox: 'box-1' })
    expect(calls[0].args).toEqual(['secret', 'rm', 'box-1', '--host', 'api.acme.com', '-f'])
  })
})

// sbx refuses a target carrying a scheme or port, so reject it here with a message that says what
// to use instead — and reject it BEFORE spawning, so a bad host can't half-apply a credential.
describe('adapter custom-secret host validation', () => {
  it('refuses a URL-shaped host rather than passing it to sbx', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await expect(a.setCustomSecret(['https://api.mem0.ai/v1/'], 'MEM0_API_KEY', 'k', { sandbox: 'box-1' }))
      .rejects.toThrow(/no scheme, port, or path/)
    expect(calls).toHaveLength(0)
  })
  it('refuses it on removal too', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await expect(a.removeCustomSecret(['https://api.smith.langchain.com'], { sandbox: 'box-1' }))
      .rejects.toThrow(/not a usable target host/)
    expect(calls).toHaveLength(0)
  })
  it('passes a valid host through verbatim', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.setCustomSecret(['api.mem0.ai'], 'MEM0_API_KEY', 'k', { sandbox: 'box-1' })
    expect(calls[0].args).toEqual(['secret', 'set-custom', 'box-1', '--host', 'api.mem0.ai', '--env', 'MEM0_API_KEY', '--value', 'k'])
  })
})

// Removing by host deletes every custom secret sharing that host. The placeholder is the only
// handle sbx offers for deleting exactly one.
describe('adapter.removeCustomSecretByPlaceholder', () => {
  it('removes a single custom secret by its placeholder token', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.removeCustomSecretByPlaceholder('sbx-cs-IDtoken01', { sandbox: 'box-1' })
    expect(calls[0].args).toEqual(['secret', 'rm', 'box-1', '--placeholder', 'sbx-cs-IDtoken01', '-f'])
  })
})

// End-to-end guard on the wiring, not just the logger: the value the adapter is forced to put on
// argv must not reach the log file that users paste into bug reports.
describe('adapter secret logging', () => {
  it('never logs a custom secret value', async () => {
    const { spawn } = fakeSpawn()
    const lines: string[] = []
    const a = createSbxAdapter(spawn, createLogger({ sink: (l) => lines.push(l), clock: () => 'T' }))
    await a.setCustomSecret(['api.acme.com'], 'ACME_KEY', 'sk-live-do-not-log', { sandbox: 'box-1' })
    expect(lines.join('\n')).not.toContain('sk-live-do-not-log')
    expect(lines.join('\n')).toContain('--env ACME_KEY --value ••••')
  })
})
