import { describe, it, expect, vi } from 'vitest'
import { buildCodeWorkspace, codeCliPresent, openInVSCode } from '../../../src/main/vscode'

describe('buildCodeWorkspace', () => {
  const json = buildCodeWorkspace('/home/u/alpha', 'my-project', 'sbx create claude /home/u/alpha && sbx run --name my-project')
  const obj = JSON.parse(json)
  it('points at the workspace folder', () => {
    expect(obj.folders).toEqual([{ path: '/home/u/alpha' }])
  })
  it('allows automatic tasks so the folderOpen task runs without a prompt', () => {
    expect(obj.settings['task.allowAutomaticTasks']).toBe('on')
  })
  it('runs the sbx chain via a folderOpen task', () => {
    const task = obj.tasks.tasks[0]
    expect(task.runOptions.runOn).toBe('folderOpen')
    expect(task.command).toContain('sbx run --name my-project')
    expect(task.label).toBe('AI Sandbox: my-project')
  })
})

describe('codeCliPresent', () => {
  it('true when `code --version` exits 0', () => {
    expect(codeCliPresent(() => ({ status: 0 }))).toBe(true)
  })
  it('false when it errors or is missing', () => {
    expect(codeCliPresent(() => ({ status: 1 }))).toBe(false)
    expect(codeCliPresent(() => { throw new Error('ENOENT') })).toBe(false)
  })
})

describe('openInVSCode', () => {
  it('spawns `code <workspaceFile>`', () => {
    const spawn = vi.fn()
    openInVSCode('/home/u/alpha/.sandbox/my-project.code-workspace', spawn)
    expect(spawn).toHaveBeenCalledWith('code', ['/home/u/alpha/.sandbox/my-project.code-workspace'])
  })
})
