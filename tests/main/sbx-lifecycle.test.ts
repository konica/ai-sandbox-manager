import { describe, it, expect } from 'vitest'
import { createSbxAdapter, type SpawnFn, type SbxResult } from '../../src/main/sbx/adapter'
import type { DefinitionSpec } from '../../src/shared/types'

function recorder(): { calls: string[][]; spawn: SpawnFn } {
  const calls: string[][] = []
  const spawn: SpawnFn = async (_cmd, args): Promise<SbxResult> => {
    calls.push(args)
    return { stdout: '', stderr: '', code: 0 }
  }
  return { calls, spawn }
}

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'balanced', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, label: 'web' }],
  credentials: []
}

describe('adapter lifecycle', () => {
  it('createSandbox spawns sbx create with translated argv', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).createSandbox(spec)
    expect(calls[0]).toEqual(['create', 'claude', '/p', '--name', 'my-project', '--template', 'img:tag'])
  })

  it('applyPolicy scopes an allow-network rule to the sandbox', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).applyPolicy('my-project', 'locked', ['a.com', 'b.com'])
    expect(calls[0]).toEqual(['policy', 'allow', 'network', '--sandbox', 'my-project', 'a.com,b.com'])
  })

  it('applyPolicy on a fully-locked empty allowlist makes no call', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).applyPolicy('my-project', 'locked', [])
    expect(calls).toHaveLength(0)
  })

  it('publishPorts publishes each intent', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).publishPorts('my-project', spec.ports)
    expect(calls[0]).toEqual(['ports', 'my-project', '--publish', '3000:8080'])
  })

  it('stopSandbox and removeSandbox use the right verbs (rm is forced)', async () => {
    const { calls, spawn } = recorder()
    const a = createSbxAdapter(spawn)
    await a.stopSandbox('my-project')
    await a.removeSandbox('my-project')
    expect(calls[0]).toEqual(['stop', 'my-project'])
    expect(calls[1]).toEqual(['rm', 'my-project', '--force'])
  })
})
