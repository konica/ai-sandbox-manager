import { describe, it, expect } from 'vitest'
import { writeKit, type KitFs } from '../../../src/main/kit/write'
import { buildKitSpec } from '../../../src/main/kit/generate'
import type { DefinitionSpec } from '../../../src/shared/types'

function fakeFs() {
  const files = new Map<string, { data: string; mode: number }>()
  const dirs = new Set<string>()
  const fs: KitFs = {
    mkdir: (p) => { dirs.add(p) },
    writeFile: (p, data, mode) => { files.set(p, { data, mode }) },
    readFile: (p) => (files.has(p) ? files.get(p)!.data : null),
    rm: (p) => { files.delete(p) }
  }
  return { fs, files, dirs }
}

const spec: DefinitionSpec = {
  definition: { id: 'deadbeefcafe', name: 'Proj', description: '', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
  mounts: [{ hostPath: '/ws', mode: 'direct', isPrimary: true }], domains: [], ports: [],
  credentials: [{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }]
}
const deps = (fs: KitFs) => ({ fs, kitDir: '/ws/.sandbox/kit', secretsDir: '/userdata/secrets/deadbeefcafe', gitignorePath: '/ws/.gitignore' })

describe('writeKit', () => {
  it('writes spec.yaml in the kit dir but the 0600 secret file OUTSIDE the workspace', () => {
    const { fs, files } = fakeFs()
    const { kitDir, specYaml } = writeKit(buildKitSpec(spec), { acme: 's3cr3t' }, deps(fs))
    expect(kitDir).toBe('/ws/.sandbox/kit')
    expect(specYaml).toContain('/userdata/secrets/deadbeefcafe/acme')
    expect(specYaml).not.toContain('.sandbox/kit/secrets')
    expect(specYaml).not.toContain('path: "secrets/acme"')
    const secret = files.get('/userdata/secrets/deadbeefcafe/acme')
    expect(secret?.data).toBe('s3cr3t')
    expect(secret?.mode).toBe(0o600)
    expect(files.get('/ws/.sandbox/kit/spec.yaml')?.data).toBe(specYaml)
  })
  it('appends .sandbox to .gitignore only once', () => {
    const { fs, files } = fakeFs()
    writeKit(buildKitSpec(spec), { acme: 'v' }, deps(fs))
    expect(files.get('/ws/.gitignore')?.data).toContain('.sandbox')
    writeKit(buildKitSpec(spec), { acme: 'v' }, deps(fs))
    expect((files.get('/ws/.gitignore')!.data.match(/^\.sandbox$/gm) || []).length).toBe(1)
  })
  it('throws when a required secret value is missing', () => {
    const { fs } = fakeFs()
    expect(() => writeKit(buildKitSpec(spec), {}, deps(fs))).toThrow(/acme/)
  })
})
