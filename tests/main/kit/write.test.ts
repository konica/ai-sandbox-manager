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
  mounts: [{ hostPath: '/ws', mode: 'direct', isPrimary: true }], domains: ['api.acme.com'], ports: [],
  hostServices: [],
  credentials: [{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }]
}
const deps = (fs: KitFs) => ({ fs, kitDir: '/ws/.sandbox/kit', secretsDir: '/userdata/secrets/deadbeefcafe', gitignorePath: '/ws/.gitignore' })

describe('writeKit', () => {
  it('writes the allowlist spec.yaml into the kit dir and writes NO secret files', () => {
    const { fs, files } = fakeFs()
    const { kitDir, specYaml } = writeKit(buildKitSpec(spec), {}, deps(fs))
    expect(kitDir).toBe('/ws/.sandbox/kit')
    expect(files.get('/ws/.sandbox/kit/spec.yaml')?.data).toBe(specYaml)
    expect(specYaml).toContain('api.acme.com')
    // no secret files anywhere (injection is via sbx secret set-custom, not the kit)
    expect([...files.keys()].some((k) => k.includes('/secrets/'))).toBe(false)
  })
  it('appends .sandbox to .gitignore only once', () => {
    const { fs, files } = fakeFs()
    writeKit(buildKitSpec(spec), {}, deps(fs))
    expect(files.get('/ws/.gitignore')?.data).toContain('.sandbox')
    writeKit(buildKitSpec(spec), {}, deps(fs))
    expect((files.get('/ws/.gitignore')!.data.match(/^\.sandbox$/gm) || []).length).toBe(1)
  })
})
