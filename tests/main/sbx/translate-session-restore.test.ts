import { describe, it, expect } from 'vitest'
import { launchCommand, sessionRestoreSteps } from '@main/sbx/translate'
import type { DefinitionSpec } from '@shared/types'

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

const ARCHIVE = { dir: '/home/u/archives/xray-2026', subdirs: ['projects', 'todos'] as const }

describe('sessionRestoreSteps', () => {
  it('copies each archived subdirectory into the sandbox Claude dir', () => {
    const steps = sessionRestoreSteps('my-project', ARCHIVE)

    expect(steps).toHaveLength(2)
    expect(steps[0]).toContain('sbx cp /home/u/archives/xray-2026/projects my-project:/home/agent/.claude/')
    expect(steps[1]).toContain('sbx cp /home/u/archives/xray-2026/todos my-project:/home/agent/.claude/')
  })

  it('lets a failed restore warn without breaking the launch chain', () => {
    // Same guard copyFileStep uses: a sandbox that comes up without its history is far
    // better than one that fails to come up at all.
    const [step] = sessionRestoreSteps('my-project', { dir: '/a', subdirs: ['projects'] })

    expect(step.startsWith('{ ')).toBe(true)
    expect(step).toContain('||')
    expect(step.trimEnd().endsWith('; }')).toBe(true)
  })

  it('quotes archive paths containing spaces', () => {
    const [step] = sessionRestoreSteps('my-project', { dir: '/home/u/My Archives/x', subdirs: ['projects'] })

    expect(step).toContain(`'/home/u/My Archives/x/projects'`)
  })

  it('emits nothing for an archive with no subdirectories', () => {
    expect(sessionRestoreSteps('my-project', { dir: '/a', subdirs: [] })).toEqual([])
  })
})

describe('launchCommand session restore', () => {
  it('adds no restore steps when there is no archive', () => {
    // Regression guard: launches that preserve nothing must be untouched. Asserted against
    // the literal pre-restore command rather than against launchCommand's own output, so a
    // change that affected BOTH sides could not slip through unnoticed.
    const cmd = launchCommand(spec(), 'my-project')

    expect(cmd).not.toContain('sbx cp')
    expect(cmd).toBe(
      "sbx create claude /home/u/proj --name my-project --template docker.io/docker/sandbox-templates:claude-code" +
      " && " + `sbx exec my-project bash -lc 'mkdir -p ~/.ssh && chmod 700 ~/.ssh; grep -qs "StrictHostKeyChecking accept-new" ~/.ssh/config || printf "Host *\\n\\tStrictHostKeyChecking accept-new\\n" >> ~/.ssh/config; chmod 600 ~/.ssh/config'` +
      " && sbx run --name my-project"
    )
  })

  it('injects the restore steps when an archive is supplied', () => {
    const cmd = launchCommand(spec(), 'my-project', undefined, undefined, undefined, undefined, ARCHIVE)

    expect(cmd).toContain('sbx cp /home/u/archives/xray-2026/projects my-project:/home/agent/.claude/')
    expect(cmd).toContain('sbx cp /home/u/archives/xray-2026/todos my-project:/home/agent/.claude/')
  })

  it('restores every subdirectory BEFORE the agent starts', () => {
    // The whole point of restoring in the chain: transcripts must be on disk before
    // `sbx run` attaches the agent, or Claude will not see them and may overwrite them.
    const cmd = launchCommand(spec(), 'my-project', undefined, undefined, undefined, undefined, ARCHIVE)

    const runAt = cmd.indexOf('sbx run')
    expect(runAt).toBeGreaterThan(-1)
    expect(cmd.lastIndexOf('sbx cp ')).toBeLessThan(runAt)
  })

  it('restores after the sandbox exists', () => {
    const cmd = launchCommand(spec(), 'my-project', undefined, undefined, undefined, undefined, ARCHIVE)

    expect(cmd.indexOf('sbx create')).toBeLessThan(cmd.indexOf('sbx cp '))
  })
})
