import { describe, it, expect } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '../../../src/main/sbx/adapter'

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
