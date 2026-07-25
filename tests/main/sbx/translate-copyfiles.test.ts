import { describe, it, expect } from 'vitest'
import { expandSandboxPath, copyFileStep, launchCommand, SANDBOX_HOME, agentAttachCommand } from '@main/sbx/translate'
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

describe('copyFileStep', () => {
  it('renders a best-effort sbx cp with name:dest and warning', () => {
    const step = copyFileStep('sbx-x', { hostPath: '/Users/me/a.sh', sandboxPath: '~/.claude/a.sh' })
    expect(step).toContain('sbx cp /Users/me/a.sh sbx-x:/home/agent/.claude/a.sh')
    expect(step.startsWith('{ ')).toBe(true)
    expect(step.trimEnd().endsWith('}')).toBe(true)
    expect(step).toContain('|| ')
  })
  it('quotes paths containing spaces', () => {
    const step = copyFileStep('sbx-x', { hostPath: '/Users/me/my file.sh', sandboxPath: '~/dst' })
    expect(step).toContain(`'/Users/me/my file.sh'`)
  })
})

const spec = (copyFiles: { hostPath: string; sandboxPath: string }[]): DefinitionSpec => ({
  definition: { id: 'd1', name: 'proj', description: '', baseImage: 'img', tier: 'locked', createdAt: 't' },
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
    expect(agentAttachCommand('sbx-x')).not.toContain('sbx cp')
  })
})
