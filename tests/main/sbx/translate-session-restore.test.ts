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

const ARCHIVE = { archivePath: '/home/u/archives/xray-2026/claude-backup.tgz' }

describe('sessionRestoreSteps', () => {
  it('copies the archive in and unpacks it over the Claude dir', () => {
    const steps = sessionRestoreSteps('my-project', ARCHIVE)

    expect(steps).toHaveLength(3)
    expect(steps[0]).toContain('sbx cp /home/u/archives/xray-2026/claude-backup.tgz my-project:/tmp/claude-backup.tgz')
    expect(steps[1]).toContain('tar xzf /tmp/claude-backup.tgz -C /home/agent/.claude')
  })

  it('deletes the copied-in tarball after unpacking', () => {
    // Regression (#92): `sbx cp` writes into the sandbox AS ROOT, so a leftover tarball at a
    // shared path made the next capture (which runs as `agent`) fail with Permission denied.
    // It also holds the whole ~/.claude including .credentials.json, so leaving it
    // world-readable in /tmp exposes an auth token to anything in the sandbox.
    const steps = sessionRestoreSteps('my-project', ARCHIVE)

    expect(steps.some((s) => s.includes('rm -f') && s.includes('claude-backup'))).toBe(true)
  })

  it('deletes the tarball even when unpacking fails', () => {
    // The cleanup must not hang off the untar's success, or a failed restore strands a
    // credential-bearing file in /tmp.
    const steps = sessionRestoreSteps('my-project', ARCHIVE)
    const rm = steps.findIndex((s) => s.includes('rm -f'))
    const untar = steps.findIndex((s) => s.includes('tar xzf'))

    expect(rm).toBeGreaterThan(untar)
    expect(steps[rm].startsWith('{ ')).toBe(true) // wrapped, so it runs regardless
  })

  it('unpacks only after the archive has been copied in', () => {
    const steps = sessionRestoreSteps('my-project', ARCHIVE)

    expect(steps[0]).toContain('sbx cp')
    expect(steps[1]).toContain('tar xzf')
  })

  it('lets a failed restore warn without breaking the launch chain', () => {
    // Same guard copyFileStep uses: a sandbox that comes up without its history is far
    // better than one that fails to come up at all.
    for (const step of sessionRestoreSteps('my-project', ARCHIVE)) {
      expect(step.startsWith('{ ')).toBe(true)
      expect(step).toContain('||')
      expect(step.trimEnd().endsWith('; }')).toBe(true)
    }
  })

  it('quotes archive paths containing spaces', () => {
    const [cp] = sessionRestoreSteps('my-project', { archivePath: '/home/u/My Archives/claude-backup.tgz' })

    expect(cp).toContain(`'/home/u/My Archives/claude-backup.tgz'`)
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
      " && sbx run --name my-project -- agents"
    )
  })

  it('injects the restore steps when an archive is supplied', () => {
    const cmd = launchCommand(spec(), 'my-project', undefined, undefined, undefined, ARCHIVE)

    expect(cmd).toContain('sbx cp /home/u/archives/xray-2026/claude-backup.tgz my-project:/tmp/claude-backup.tgz')
    expect(cmd).toContain('tar xzf /tmp/claude-backup.tgz -C /home/agent/.claude')
  })

  it('restores every subdirectory BEFORE the agent starts', () => {
    // The whole point of restoring in the chain: transcripts must be on disk before
    // `sbx run` attaches the agent, or Claude will not see them and may overwrite them.
    const cmd = launchCommand(spec(), 'my-project', undefined, undefined, undefined, ARCHIVE)

    const runAt = cmd.indexOf('sbx run')
    expect(runAt).toBeGreaterThan(-1)
    expect(cmd.lastIndexOf('sbx cp ')).toBeLessThan(runAt)
  })

  it('restores after the sandbox exists', () => {
    const cmd = launchCommand(spec(), 'my-project', undefined, undefined, undefined, ARCHIVE)

    expect(cmd.indexOf('sbx create')).toBeLessThan(cmd.indexOf('sbx cp '))
  })
})
