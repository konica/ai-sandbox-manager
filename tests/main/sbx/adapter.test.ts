import { describe, it, expect, vi } from 'vitest'
import { createSbxAdapter } from '@main/sbx/adapter'
import { SbxError } from '@shared/errors'

const ok = (stdout: string) => vi.fn().mockResolvedValue({ stdout, stderr: '', code: 0 })

describe('createSbxAdapter.listSandboxes', () => {
  it('prefers --json and parses it', async () => {
    const json = JSON.stringify([{ name: 'a', agent: 'claude', status: 'running', ports: [], workspace: '/w' }])
    const spawn = ok(json)
    const adapter = createSbxAdapter(spawn)
    const rows = await adapter.listSandboxes()
    expect(spawn).toHaveBeenCalledWith('sbx', ['ls', '--json'], expect.anything())
    expect(rows[0].name).toBe('a')
  })

  it('falls back to text parsing when --json is not valid JSON', async () => {
    const text = 'SANDBOX  AGENT   STATUS   PORTS  WORKSPACE\na  claude  running  -  /w'
    const spawn = vi.fn().mockResolvedValue({ stdout: text, stderr: '', code: 0 })
    const adapter = createSbxAdapter(spawn)
    const rows = await adapter.listSandboxes()
    expect(rows[0]).toMatchObject({ name: 'a', status: 'running', workspace: '/w' })
  })
})

describe('createSbxAdapter.runSbx', () => {
  it('throws a classified SbxError on non-zero exit', async () => {
    const spawn = vi.fn().mockResolvedValue({ stdout: '', stderr: 'not logged in. Run `sbx login`.', code: 1 })
    const adapter = createSbxAdapter(spawn)
    await expect(adapter.runSbx(['ls'])).rejects.toMatchObject({ kind: 'not-authed' })
    await expect(adapter.runSbx(['ls'])).rejects.toBeInstanceOf(SbxError)
  })
})

describe('createSbxAdapter.execScript', () => {
  it('execScript runs `sbx exec <name> bash -lc <script>`', async () => {
    const calls: string[][] = []
    const spawn = async (_cmd: string, args: string[]) => { calls.push(args); return { stdout: '', stderr: '', code: 0 } }
    const adapter = createSbxAdapter(spawn)
    await adapter.execScript('sbx-1', 'touch /etc/sandbox-persistent.sh')
    expect(calls[0]).toEqual(['exec', 'sbx-1', 'bash', '-lc', 'touch /etc/sandbox-persistent.sh'])
  })
})
