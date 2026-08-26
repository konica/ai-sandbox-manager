import { describe, it, expect } from 'vitest'
import {
  toSbxName,
  resolveSandboxName,
  uniqueSandboxName,
  hashedSandboxName,
  tierToAllowlist,
  specToCreateArgs,
  portIntentToPublishSpec,
  shellQuote,
  shellCommand,
  launchCommand,
  agentAttachCommand,
  hostShellCommand,
  sshHostKeySetupCommand
} from '../../../src/main/sbx/translate'
import { AGENT_PROFILES } from '../../../src/shared/agents'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(over: Partial<DefinitionSpec> = {}): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
    mounts: [{ hostPath: '/home/u/proj', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [],
    hostServices: [],
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

describe('uniqueSandboxName', () => {
  it('returns the base name when it is free', () => {
    expect(uniqueSandboxName('proj', [])).toBe('proj')
    expect(uniqueSandboxName('proj', ['other'])).toBe('proj')
  })
  it('appends the first free numeric suffix when taken', () => {
    expect(uniqueSandboxName('proj', ['proj'])).toBe('proj-2')
    expect(uniqueSandboxName('proj', ['proj', 'proj-2', 'proj-3'])).toBe('proj-4')
  })
})

describe('hashedSandboxName', () => {
  it('appends the generated hash suffix', () => {
    expect(hashedSandboxName('proj', [], () => '3323dc52')).toBe('proj-3323dc52')
  })
  it('regenerates on the (rare) collision', () => {
    const hashes = ['aaaa1111', 'bbbb2222']
    let i = 0
    const name = hashedSandboxName('proj', ['proj-aaaa1111'], () => hashes[i++])
    expect(name).toBe('proj-bbbb2222')
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
      'create', AGENT_PROFILES.claude.keyword, '/home/u/proj',
      '--name', 'my-project',
      '--template', 'docker.io/docker/sandbox-templates:claude-code'
    ])
  })
  it('uses the opencode keyword for an opencode-agent definition', () => {
    const args = specToCreateArgs(spec({ definition: { ...spec().definition, agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode' } }))
    expect(args).toEqual([
      'create', 'opencode', '/home/u/proj',
      '--name', 'my-project',
      '--template', 'docker.io/docker/sandbox-templates:opencode'
    ])
  })
  it('never adds --clone (primary workspace is always direct)', () => {
    const args = specToCreateArgs(spec({ mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }] }))
    expect(args).not.toContain('--clone')
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
  it('honors an explicit name override', () => {
    const args = specToCreateArgs(spec(), 'my-project-2')
    expect(args).toContain('my-project-2')
    expect(args).not.toContain('my-project')
  })
})

describe('portIntentToPublishSpec', () => {
  it('formats host:container', () => {
    expect(portIntentToPublishSpec({ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' })).toBe('3000:8080/tcp')
  })
})

describe('shell command builders', () => {
  it('quotes names and builds run/exec commands', () => {
    expect(shellQuote('a b')).toBe("'a b'")
    expect(agentAttachCommand('my-project', 'claude')).toBe("sbx run --name 'my-project' -- agents")
    expect(hostShellCommand('my-project')).toBe("sbx exec -it 'my-project' bash")
  })
  it('agentAttachCommand uses the given agent\'s resumeArgs', () => {
    expect(agentAttachCommand('my-project', 'opencode')).toBe("sbx run --name 'my-project' -- --continue")
    expect(agentAttachCommand('my-project', 'codex')).toBe("sbx run --name 'my-project' -- resume --last")
    expect(agentAttachCommand('my-project', 'copilot')).toBe("sbx run --name 'my-project' -- --resume")
  })
  it('agentAttachCommand opens the session dashboard for claude (regression guard)', () => {
    expect(agentAttachCommand('my-project', 'claude')).toBe("sbx run --name 'my-project' -- agents")
  })
  it('agentAttachCommand quotes resumeArgs tokens that need it, like every other arg path', () => {
    const original = AGENT_PROFILES.codex.resumeArgs
    AGENT_PROFILES.codex.resumeArgs = ['--continue', 'a b']
    try {
      expect(agentAttachCommand('my-project', 'codex')).toBe("sbx run --name 'my-project' -- --continue 'a b'")
    } finally {
      AGENT_PROFILES.codex.resumeArgs = original
    }
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
      `sbx create claude /home/u/proj --name my-project --template docker.io/docker/sandbox-templates:claude-code && ${sshHostKeySetupCommand('my-project')} && sbx run --name my-project`
    )
  })
  it('inserts a policy step and quotes the wildcard for the open tier', () => {
    const cmd = launchCommand(spec({ definition: { ...spec().definition, tier: 'open' } }))
    expect(cmd).toContain("sbx policy allow network --sandbox my-project '**'")
    expect(cmd).toMatch(/&& sbx run --name my-project$/)
  })
  it('adds a ports step per intent', () => {
    const cmd = launchCommand(spec({ ports: [{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }] }))
    expect(cmd).toContain('sbx ports my-project --publish 3000:8080/tcp')
    expect(cmd).toMatch(/&& sbx run --name my-project$/)
  })
  it('uses an explicit name override throughout the chain', () => {
    const cmd = launchCommand(spec(), 'my-project-2')
    expect(cmd).toContain('--name my-project-2')
    expect(cmd).toMatch(/&& sbx run --name my-project-2$/)
  })
  it('appends the session name as claude --name after the -- separator', () => {
    const cmd = launchCommand(spec(), 'my-project', 'Refactor auth')
    expect(cmd).toMatch(/&& sbx run --name my-project -- --name 'Refactor auth'$/)
  })
  it('appends the session name using the opencode --session flag for an opencode definition', () => {
    const s = spec({ definition: { ...spec().definition, agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode' } })
    const cmd = launchCommand(s, 'my-project', 'Refactor auth')
    expect(cmd).toMatch(/&& sbx run --name my-project -- --session 'Refactor auth'$/)
  })
  it('omits the session args when no session name is given', () => {
    expect(launchCommand(spec(), 'my-project', '  ')).toMatch(/&& sbx run --name my-project$/)
  })
  it('emits no dangling -- separator for an agent with no session-name flag (codex), even with a session name given', () => {
    const s = spec({ definition: { ...spec().definition, agent: 'codex', baseImage: 'docker.io/docker/sandbox-templates:codex' } })
    const cmd = launchCommand(s, 'my-project', 'Refactor auth')
    // The command must end exactly at "--name my-project" with nothing after — no trailing
    // "--" separator and no sign of the (silently dropped) session name.
    expect(cmd).toMatch(/&& sbx run --name my-project$/)
    expect(cmd).not.toMatch(/\s--(\s|$)/)
  })
})
