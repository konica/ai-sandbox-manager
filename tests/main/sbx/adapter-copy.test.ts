import { describe, it, expect, vi } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '../../../src/main/sbx/adapter'

const spawnOk = (stdout = ''): SpawnFn => vi.fn(async () => ({ stdout, stderr: '', code: 0 }))

describe('adapter.copyToSandbox / copyFromSandbox', () => {
  it('builds `sbx cp SRC name:DST` and `sbx cp name:SRC DST`', async () => {
    const spawn = spawnOk()
    const adapter = createSbxAdapter(spawn)
    await adapter.copyToSandbox('proj', 'C:\\a\\report.csv', '/workspace')
    expect(spawn).toHaveBeenCalledWith('sbx', ['cp', 'C:\\a\\report.csv', 'proj:/workspace'], expect.anything())
    await adapter.copyFromSandbox('proj', '/workspace/out.log', 'C:\\dl')
    expect(spawn).toHaveBeenCalledWith('sbx', ['cp', 'proj:/workspace/out.log', 'C:\\dl'], expect.anything())
  })
})

describe('adapter.listSandboxDir', () => {
  it('execs the list script and parses cwd + entries', async () => {
    const spawn = spawnOk('__SBX_PWD__ /workspace\nout/\nREADME.md\n')
    const adapter = createSbxAdapter(spawn)
    const r = await adapter.listSandboxDir('proj', '/workspace')
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.cwd).toBe('/workspace'); expect(r.entries[0]).toEqual({ name: 'out', isDir: true }) }
    const args = (spawn as any).mock.calls[0][1]
    expect(args.slice(0, 4)).toEqual(['exec', 'proj', 'bash', '-lc'])
  })
})

describe('adapter.probeSandboxPath / sandboxTargetsExist', () => {
  it('probes a path and target existence', async () => {
    const adapter1 = createSbxAdapter(spawnOk('dir\n'))
    expect(await adapter1.probeSandboxPath('proj', '/workspace')).toBe('dir')
    const adapter2 = createSbxAdapter(spawnOk('1\n0\n'))
    expect(await adapter2.sandboxTargetsExist('proj', ['/workspace/a', '/workspace/b'])).toEqual([true, false])
    // empty list short-circuits without spawning
    const spawn = spawnOk('')
    const adapter3 = createSbxAdapter(spawn)
    expect(await adapter3.sandboxTargetsExist('proj', [])).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
  })
})
