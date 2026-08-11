// The three literals across agent-fix-ci.yml and agent-burn.yml are the whole
// portability story: workflow triggers and job `if:` conditions are evaluated
// before any step runs, so none of them can read config. These three drift
// checks are the only thing standing between a ported repository and a queue
// that silently never fires — and the branch-prefix one already shipped
// broken once.
import { describe, it, expect } from 'vitest'
import {
  checkCiWorkflowName,
  checkBranchPrefixGuard,
  checkReadyLabelGuard
} from '../../scripts/burn/setup.mjs'
import { loadConfig } from '../../scripts/burn/config.mjs'

const cfg = loadConfig()

describe('checkCiWorkflowName', () => {
  it('accepts the configured workflow named without its extension', () => {
    const r = checkCiWorkflowName('  on:\n    workflows: ["build-check"]\n', cfg)
    expect(r.ok).toBe(true)
    expect(r.message).toContain('build-check')
  })

  it('accepts the configured workflow named with its extension', () => {
    expect(checkCiWorkflowName(`workflows: ["${cfg.ciWorkflow}"]`, cfg).ok).toBe(true)
  })

  it('accepts single quotes and surrounding whitespace', () => {
    expect(checkCiWorkflowName("workflows: [ 'build-check' ]", cfg).ok).toBe(true)
  })

  it('reports drift, naming both sides', () => {
    const r = checkCiWorkflowName('workflows: ["ci"]', cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('"ci"')
    expect(r.message).toContain(cfg.ciWorkflow)
  })

  it('reports a workflow_run name it cannot find at all', () => {
    const r = checkCiWorkflowName('on:\n  push:\n', cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/could not find/)
  })

  it('follows a renamed ciWorkflow', () => {
    const custom = loadConfig({ ciWorkflow: 'tests.yml' })
    expect(checkCiWorkflowName('workflows: ["tests"]', custom).ok).toBe(true)
    expect(checkCiWorkflowName('workflows: ["build-check"]', custom).ok).toBe(false)
  })
})

describe('checkBranchPrefixGuard', () => {
  const workflowRunGuard = (p) => `startsWith(github.event.workflow_run.head_branch, '${p}')`
  const pullRequestGuard = (p) => `startsWith(github.event.pull_request.head.ref, '${p}')`

  it('accepts both job guards using the configured prefix', () => {
    const yml = [workflowRunGuard('agent/'), pullRequestGuard('agent/')].join('\n')
    const r = checkBranchPrefixGuard(yml, cfg)
    expect(r.ok).toBe(true)
    expect(r.message).toContain('agent/')
  })

  it('reports drift, naming every prefix it found and the configured one', () => {
    const yml = [workflowRunGuard('agent/'), pullRequestGuard('bot/')].join('\n')
    const r = checkBranchPrefixGuard(yml, cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('agent/')
    expect(r.message).toContain('bot/')
  })

  it('reports a single guard that drifted away from the configured prefix', () => {
    const r = checkBranchPrefixGuard(workflowRunGuard('bot/'), cfg)
    expect(r.ok).toBe(false)
  })

  it('reports a workflow with no branch guard at all', () => {
    const r = checkBranchPrefixGuard('jobs:\n  promote:\n    if: always()\n', cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/could not find/)
  })

  // The regression this check exists for: agent-fix-ci.yml also calls
  // startsWith() on things that are not branch refs. Accepting one of those as
  // "the branch guard" would report ok while the real guard had drifted — the
  // exact failure mode that shipped once already.
  it('does not accept a startsWith on the head repository as the branch guard', () => {
    const yml = "startsWith(github.event.workflow_run.head_repository.full_name, 'agent/')"
    const r = checkBranchPrefixGuard(yml, cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/could not find/)
  })

  it('does not accept an expression merely beginning with a branch ref', () => {
    const yml = "startsWith(github.event.workflow_run.head_branch_name, 'agent/')"
    expect(checkBranchPrefixGuard(yml, cfg).message).toMatch(/could not find/)
  })

  it('ignores unrelated startsWith calls alongside a correct branch guard', () => {
    const yml = [
      "startsWith(github.event.workflow_run.head_repository.full_name, 'someone/')",
      "startsWith(github.event.workflow_run.name, 'nightly-')",
      workflowRunGuard('agent/')
    ].join('\n')
    expect(checkBranchPrefixGuard(yml, cfg).ok).toBe(true)
  })

  it('follows a renamed branchPrefix', () => {
    const custom = loadConfig({ branchPrefix: 'bot/' })
    expect(checkBranchPrefixGuard(workflowRunGuard('bot/'), custom).ok).toBe(true)
    expect(checkBranchPrefixGuard(workflowRunGuard('agent/'), custom).ok).toBe(false)
  })
})

describe('checkReadyLabelGuard', () => {
  const labelGuard = (l) => `github.event.label.name == '${l}'`

  it('accepts the job `if:` using the configured ready label', () => {
    const yml = `if: >-\n  github.event_name != 'issues' ||\n  ${labelGuard('ready-for-agent')}\n`
    const r = checkReadyLabelGuard(yml, cfg)
    expect(r.ok).toBe(true)
    expect(r.message).toContain('ready-for-agent')
  })

  it('reports drift, naming both the found label and the configured one', () => {
    const r = checkReadyLabelGuard(labelGuard('go-agent'), cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('go-agent')
    expect(r.message).toContain(cfg.readyLabel)
  })

  it('reports a workflow with no label guard at all', () => {
    const r = checkReadyLabelGuard('jobs:\n  plan:\n    if: always()\n', cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/could not find/)
  })

  // The same failure mode the branch-prefix check guards against: a quoted
  // comparison on an unrelated field must not be accepted as the label guard.
  it('does not accept a quoted == comparison on an unrelated field', () => {
    const yml = "github.event.action == 'labeled'"
    const r = checkReadyLabelGuard(yml, cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/could not find/)
  })

  it('does not accept an unquoted == comparison', () => {
    const yml = "github.event.pull_request.head.repo.full_name == github.repository"
    const r = checkReadyLabelGuard(yml, cfg)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/could not find/)
  })

  it('does not accept a comparison merely ending in a similar property name', () => {
    const yml = "github.event.label.nickname == 'ready-for-agent'"
    expect(checkReadyLabelGuard(yml, cfg).message).toMatch(/could not find/)
  })

  it('ignores unrelated == comparisons alongside a correct label guard', () => {
    const yml = [
      "github.event.pull_request.head.repo.full_name == github.repository",
      labelGuard('ready-for-agent')
    ].join('\n')
    expect(checkReadyLabelGuard(yml, cfg).ok).toBe(true)
  })

  it('follows a renamed readyLabel', () => {
    const custom = loadConfig({ readyLabel: 'go-agent' })
    expect(checkReadyLabelGuard(labelGuard('go-agent'), custom).ok).toBe(true)
    expect(checkReadyLabelGuard(labelGuard('ready-for-agent'), custom).ok).toBe(false)
  })
})
