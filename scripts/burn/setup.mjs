#!/usr/bin/env node
// Idempotent per-repository setup for the agent burn queue.
//
//   node scripts/burn/setup.mjs
//
// Safe to re-run. Creates nothing that already exists.
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { loadConfig } from './config.mjs'

const FIX_CI_WORKFLOW = '.github/workflows/agent-fix-ci.yml'

function gh(args, { allowFail = false } = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    if (allowFail) return null
    throw new Error(`gh ${args.join(' ')} failed: ${err.stderr || err.message}`)
  }
}

const todo = []
const ok = (m) => console.log(`  ok    ${m}`)
const warn = (m) => { console.log(`  TODO  ${m}`); todo.push(m) }

async function main() {
  let raw = {}
  try {
    raw = JSON.parse(await readFile('.github/agent-burn.json', 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`.github/agent-burn.json is not valid JSON: ${err.message}`)
  }
  const config = loadConfig(raw)
  console.log('config valid\n')

  console.log('labels')
  const existing = new Set(
    JSON.parse(gh(['label', 'list', '--limit', '200', '--json', 'name'])).map((l) => l.name)
  )
  const wanted = [
    [config.readyLabel, '0e8a16', 'Fully specified, ready for an AFK agent'],
    [config.wipLabel, 'fbca04', 'Claimed by the burn queue'],
    [config.needsHumanLabel, 'd93f0b', 'Agent gave up; needs a human'],
    ...Array.from({ length: config.maxCiRetries }, (_, i) => [
      `agent-retry-${i + 1}`, 'c5def5', `CI retry attempt ${i + 1}`
    ])
  ]
  for (const [name, color, description] of wanted) {
    if (existing.has(name)) { ok(`label ${name}`); continue }
    gh(['label', 'create', name, '--color', color, '--description', description])
    ok(`label ${name} (created)`)
  }

  console.log('\ncredentials')
  const secrets = gh(['secret', 'list'], { allowFail: true })
  if (secrets === null) warn('could not list secrets — check `gh auth status` and repo admin rights')
  else if (secrets.includes('AGENT_PAT')) ok('AGENT_PAT present')
  else warn(
    'AGENT_PAT missing. PRs opened with GITHUB_TOKEN do not trigger CI or review ' +
    'workflows, so the queue would stall silently. Create a fine-grained PAT with ' +
    'Contents, Pull requests, and Issues read+write, then: gh secret set AGENT_PAT'
  )
  if (secrets && secrets.includes('CLAUDE_CODE_OAUTH_TOKEN')) ok('CLAUDE_CODE_OAUTH_TOKEN present')
  else warn('CLAUDE_CODE_OAUTH_TOKEN missing — the agent cannot run without it')

  console.log('\nbranch protection')
  const branch = gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'])
  const protection = gh(['api', `repos/{owner}/{repo}/branches/${branch}/protection`], { allowFail: true })
  if (protection) ok(`${branch} is protected`)
  else warn(`${branch} has no branch protection — recommended: require ${config.ciWorkflow} to pass before merge`)

  // Workflow `on:` triggers and `if:` conditions cannot read a config file, so two
  // values are literal in agent-fix-ci.yml. Catch drift here rather than letting a
  // ported repository fail silently.
  console.log('\nworkflow wiring')
  try {
    const yml = await readFile(FIX_CI_WORKFLOW, 'utf8')

    const named = /workflows:\s*\[\s*["']([^"']+)["']/.exec(yml)?.[1]
    const expected = config.ciWorkflow.replace(/\.ya?ml$/, '')
    if (!named) warn(`could not find a workflow_run name in ${FIX_CI_WORKFLOW}`)
    else if (named === expected || named === config.ciWorkflow) ok(`watches CI workflow "${named}"`)
    else warn(
      `${FIX_CI_WORKFLOW} watches "${named}" but ciWorkflow is "${config.ciWorkflow}". ` +
      'workflow_run cannot take an expression, so update that line by hand.'
    )

    const BRANCH_REF = /github\.event\.(?:workflow_run\.head_branch|pull_request\.head\.ref)/
    const prefixes = new Set(
      [...yml.matchAll(/startsWith\(([^,]+),\s*'([^']+)'\)/g)]
        .filter((m) => BRANCH_REF.test(m[1]))
        .map((m) => m[2])
    )
    if (prefixes.size === 0) warn(`could not find a branch-prefix guard in ${FIX_CI_WORKFLOW}`)
    else if (prefixes.size === 1 && prefixes.has(config.branchPrefix)) ok(`guards branch prefix "${config.branchPrefix}"`)
    else warn(
      `${FIX_CI_WORKFLOW} guards on [${[...prefixes].join(', ')}] but branchPrefix is ` +
      `"${config.branchPrefix}". Job \`if:\` conditions cannot take config, so update those by hand.`
    )
  } catch (err) {
    if (err.code === 'ENOENT') warn(`${FIX_CI_WORKFLOW} not found`)
    else throw err
  }

  console.log(todo.length === 0 ? '\nAll set.' : `\n${todo.length} item(s) need attention:`)
  for (const t of todo) console.log(`  - ${t}`)
}

main().catch((err) => { console.error(`error: ${err.message}`); process.exit(1) })
