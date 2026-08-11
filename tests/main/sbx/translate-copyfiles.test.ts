import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { expandSandboxPath, expandHostPath, copyFileStep, launchCommand, SANDBOX_HOME, agentAttachCommand } from '@main/sbx/translate'
import type { DefinitionSpec } from '@shared/types'

describe('expandSandboxPath', () => {
  it('expands ~/ to the sandbox home', () => {
    expect(expandSandboxPath('~/.claude/x.sh')).toBe(`${SANDBOX_HOME}/.claude/x.sh`)
  })
  it('expands bare ~ to the sandbox home', () => {
    expect(expandSandboxPath('~')).toBe(SANDBOX_HOME)
  })
  it('leaves absolute paths unchanged', () => {
    expect(expandSandboxPath('/home/agent/foo')).toBe('/home/agent/foo')
  })
})

describe('expandHostPath', () => {
  it('expands ~/ to the given host home', () => {
    expect(expandHostPath('~/.claude/x.sh', '/Users/me')).toBe('/Users/me/.claude/x.sh')
  })
  it('expands bare ~ to the host home', () => {
    expect(expandHostPath('~', '/Users/me')).toBe('/Users/me')
  })
  it('leaves absolute paths unchanged', () => {
    expect(expandHostPath('/Users/me/foo', '/Users/me')).toBe('/Users/me/foo')
  })
  it('defaults to the real homedir', () => {
    expect(expandHostPath('~/x')).toBe(`${homedir()}/x`)
  })
})

describe('copyFileStep', () => {
  it('renders a best-effort sbx cp with name:dest and warning', () => {
    const step = copyFileStep('sbx-x', { hostPath: '/Users/me/a.sh', sandboxPath: '~/.claude/a.sh' })
    expect(step).toContain('sbx cp /Users/me/a.sh sbx-x:/home/agent/.claude/a.sh')
    expect(step.startsWith('{ ')).toBe(true)
    expect(step.trimEnd().endsWith('}')).toBe(true)
    expect(step).toContain('|| ')
  })
  it('expands a ~ host source before the quoting decision is made (the lstat ~ bug)', () => {
    // The historical bug: `~` (unexpanded) isn't a SAFE_ARG char, so shellCommand single-quoted
    // it and the shell never performed tilde-expansion — 'sbx cp' then failed with "lstat ~: no
    // such file or directory". The fix expands `~` to the real home dir *before* the quoting
    // decision, so the invariant is "the literal `~` never reaches the rendered command" — not
    // "the expanded path is never quoted". A Windows home dir (e.g. C:\Users\dtrun) contains
    // backslashes, which legitimately are not SAFE_ARG chars and get single-quoted like any
    // other path with special characters (see the "quotes paths containing spaces" case below);
    // that's correct shell-quoting, not a recurrence of the bug.
    const step = copyFileStep('sbx-x', { hostPath: '~/.claude/statusline-command.sh', sandboxPath: '~/.claude/statusline-command.sh' })
    // Only the `sbx cp` clause matters here — the `||` fallback intentionally echoes the
    // original, unexpanded hostPath for a human-readable warning, so check that clause alone.
    const cpClause = step.split(' || ')[0]
    expect(cpClause).not.toContain('~')
    const expandedHostPath = `${homedir()}/.claude/statusline-command.sh`
    expect(cpClause).toContain(expandedHostPath)
    expect(cpClause).toContain('sbx cp')
    expect(cpClause).toContain('sbx-x:/home/agent/.claude/statusline-command.sh')
  })
  it('quotes paths containing spaces', () => {
    const step = copyFileStep('sbx-x', { hostPath: '/Users/me/my file.sh', sandboxPath: '~/dst' })
    expect(step).toContain(`'/Users/me/my file.sh'`)
  })
})

const spec = (copyFiles: { hostPath: string; sandboxPath: string }[]): DefinitionSpec => ({
  definition: { id: 'd1', name: 'proj', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: [],
  ssh: { forwardAgent: false, commitSigning: false },
  copyFiles
})

describe('launchCommand copyFiles', () => {
  it('inserts a cp step after create and before run', () => {
    const cmd = launchCommand(spec([{ hostPath: '/a.sh', sandboxPath: '~/a.sh' }]), 'sbx-x')
    const iCreate = cmd.indexOf('sbx create')
    const iCp = cmd.indexOf('sbx cp /a.sh sbx-x:/home/agent/a.sh')
    const iRun = cmd.indexOf('sbx run --name sbx-x')
    expect(iCreate).toBeGreaterThanOrEqual(0)
    expect(iCp).toBeGreaterThan(iCreate)
    expect(iRun).toBeGreaterThan(iCp)
  })
  it('emits no cp step when copyFiles is empty', () => {
    expect(launchCommand(spec([]), 'sbx-x')).not.toContain('sbx cp')
  })
  it('attach command never copies', () => {
    expect(agentAttachCommand('sbx-x', 'claude')).not.toContain('sbx cp')
  })
})
