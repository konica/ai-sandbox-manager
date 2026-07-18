import { describe, it, expect } from 'vitest'
import {
  AGENT_KEYWORD,
  toSbxName,
  resolveSandboxName,
  tierToAllowlist,
  specToCreateArgs,
  portIntentToPublishSpec,
  shellQuote,
  shellCommand,
  launchCommand,
  agentAttachCommand,
  hostShellCommand
} from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(over: Partial<DefinitionSpec> = {}): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
    mounts: [{ hostPath: '/home/u/proj', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [],
    credentials: [],
    ...over
  }
}

describe('toSbxName', () => {
  it('lowercases, replaces spaces, strips invalid chars', () => {
    expect(toSbxName('My Project')).toBe('my-project')
    expect(toSbxName('Foo/Bar Baz!')).toBe('foo-bar-baz')
    expect(toSbxName('  a__b  ')).toBe('a-b')
  })
  it('never returns empty', () => {
    expect(toSbxName('!!!')).toBe('sandbox')
  })
})

describe('resolveSandboxName', () => {
  it('normalises the definition name', () => {
    expect(resolveSandboxName(spec())).toBe('my-project')
  })
})

describe('tierToAllowlist', () => {
  it('open allows all hosts', () => {
    expect(tierToAllowlist('open', ['x.com'])).toEqual(['**'])
  })
  it('locked allows only explicit domains', () => {
    expect(tierToAllowlist('locked', ['api.example.com'])).toEqual(['api.example.com'])
    expect(tierToAllowlist('locked', [])).toEqual([])
  })
  it('balanced merges baseline with extras and dedups', () => {
    const out = tierToAllowlist('balanced', ['api.example.com', 'registry.npmjs.org'])
    expect(out).toContain('api.example.com')
    expect(out).toContain('registry.npmjs.org')
    // dedup: registry.npmjs.org is also in baseline
    expect(out.filter((d) => d === 'registry.npmjs.org')).toHaveLength(1)
  })
})

describe('specToCreateArgs', () => {
  it('builds create argv with agent keyword, name and template', () => {
    expect(specToCreateArgs(spec())).toEqual([
      'create', AGENT_KEYWORD, '/home/u/proj',
      '--name', 'my-project',
      '--template', 'docker.io/docker/sandbox-templates:claude-code'
    ])
  })
  it('adds --clone when the primary mount is clone mode', () => {
    const args = specToCreateArgs(spec({ mounts: [{ hostPath: '/p', mode: 'clone', isPrimary: true }] }))
    expect(args).toContain('--clone')
  })
  it('appends extra mounts, read-only extras get :ro', () => {
    const args = specToCreateArgs(spec({
      mounts: [
        { hostPath: '/p', mode: 'direct', isPrimary: true },
        { hostPath: '/docs', mode: 'clone', isPrimary: false },
        { hostPath: '/rw', mode: 'direct', isPrimary: false }
      ]
    }))
    expect(args).toContain('/docs:ro')
    expect(args).toContain('/rw')
  })
  it('omits --template when baseImage is empty', () => {
    const args = specToCreateArgs(spec({ definition: { ...spec().definition, baseImage: '' } }))
    expect(args).not.toContain('--template')
  })
})

describe('portIntentToPublishSpec', () => {
  it('formats host:container', () => {
    expect(portIntentToPublishSpec({ hostPort: 3000, containerPort: 8080, label: 'web' })).toBe('3000:8080')
  })
})

describe('shell command builders', () => {
  it('quotes names and builds run/exec commands', () => {
    expect(shellQuote('a b')).toBe("'a b'")
    expect(agentAttachCommand('my-project')).toBe("sbx run --name 'my-project'")
    expect(hostShellCommand('my-project')).toBe("sbx exec -it 'my-project' bash")
  })
  it('shellCommand leaves safe args unquoted and quotes the rest', () => {
    expect(shellCommand(['sbx', 'run', '--name', 'my-project'])).toBe('sbx run --name my-project')
    expect(shellCommand(['sbx', 'x', 'a b'])).toBe("sbx x 'a b'")
    expect(shellCommand(['sbx', 'x', '**'])).toBe("sbx x '**'")
  })
})

describe('launchCommand', () => {
  it('chains create then run for a locked sandbox with no allowlist', () => {
    expect(launchCommand(spec())).toBe(
      'sbx create claude /home/u/proj --name my-project --template docker.io/docker/sandbox-templates:claude-code && sbx run --name my-project'
    )
  })
  it('inserts a policy step and quotes the wildcard for the open tier', () => {
    const cmd = launchCommand(spec({ definition: { ...spec().definition, tier: 'open' } }))
    expect(cmd).toContain("sbx policy allow network --sandbox my-project '**'")
    expect(cmd).toMatch(/&& sbx run --name my-project$/)
  })
  it('adds a ports step per intent', () => {
    const cmd = launchCommand(spec({ ports: [{ hostPort: 3000, containerPort: 8080, label: 'web' }] }))
    expect(cmd).toContain('sbx ports my-project --publish 3000:8080')
    expect(cmd).toMatch(/&& sbx run --name my-project$/)
  })
})
