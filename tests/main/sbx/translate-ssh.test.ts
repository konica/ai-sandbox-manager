import { describe, it, expect } from 'vitest'
import { launchCommand, commitSigningExecCommand, sshHostKeySetupCommand } from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '../../../src/shared/types'

const base: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: []
}

describe('launchCommand ssh', () => {
  it('default (forward on, no signing) does not touch SSH_AUTH_SOCK or run git config', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: true, commitSigning: false } }, 'my-project')
    expect(cmd).not.toContain('unset SSH_AUTH_SOCK')
    expect(cmd).not.toContain('git config')
  })
  it('forward off prepends unset SSH_AUTH_SOCK', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: false, commitSigning: false } }, 'my-project')
    expect(cmd.startsWith('unset SSH_AUTH_SOCK ; ')).toBe(true)
  })
  it('commit signing inserts the git-config exec right after create', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: true, commitSigning: true } }, 'my-project')
    expect(cmd).toContain(commitSigningExecCommand('my-project'))
    const createIdx = cmd.indexOf('sbx create')
    const execIdx = cmd.indexOf('sbx exec my-project')
    const runIdx = cmd.indexOf('sbx run')
    expect(createIdx).toBeLessThan(execIdx)
    expect(execIdx).toBeLessThan(runIdx)
  })
  it('commitSigningExecCommand emits the exact documented git config', () => {
    expect(commitSigningExecCommand('my-project')).toBe(
      `sbx exec my-project bash -lc 'git config --global gpg.format ssh && git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"'`
    )
  })
  it('forward on inserts the SSH host-key setup after create, before run', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: true, commitSigning: false } }, 'my-project')
    expect(cmd).toContain(sshHostKeySetupCommand('my-project'))
    const createIdx = cmd.indexOf('sbx create')
    const setupIdx = cmd.indexOf('StrictHostKeyChecking accept-new')
    const runIdx = cmd.indexOf('sbx run')
    expect(createIdx).toBeLessThan(setupIdx)
    expect(setupIdx).toBeLessThan(runIdx)
  })
  it('forward off does not set up SSH host keys', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: false, commitSigning: false } }, 'my-project')
    expect(cmd).not.toContain('StrictHostKeyChecking')
  })
  it('sshHostKeySetupCommand emits accept-new config idempotently with correct perms', () => {
    expect(sshHostKeySetupCommand('my-project')).toBe(
      `sbx exec my-project bash -lc 'mkdir -p ~/.ssh && chmod 700 ~/.ssh; grep -qs "StrictHostKeyChecking accept-new" ~/.ssh/config || printf "Host *\\n\\tStrictHostKeyChecking accept-new\\n" >> ~/.ssh/config; chmod 600 ~/.ssh/config'`
    )
  })
})
