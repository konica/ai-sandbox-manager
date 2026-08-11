// Idempotent per-repository setup for the agent burn queue.
//
// No shebang: this module is imported by tests, and vitest's module runner does
// not strip shebangs the way node does — a leading `#!` makes the whole import
// fail with a SyntaxError misreported against the importing test file. The
// script is always invoked as `node scripts/burn/setup.mjs`, so it never needed
// one.
//
//   node scripts/burn/setup.mjs
//
// Safe to re-run. Creates nothing that already exists.
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { loadConfig } from './config.mjs'

const FIX_CI_WORKFLOW = '.github/workflows/agent-fix-ci.yml'

// Workflow `on:` triggers and `if:` conditions cannot read a config file, so two
// values are literal in agent-fix-ci.yml. These two checks are the entire
// portability safety net for that, which is why they are exported and tested
// rather than buried in main().

/** Does agent-fix-ci.yml's `workflow_run.workflows` still name `config.ciWorkflow`? */
export function checkCiWorkflowName(yml, config) {
  const named = /workflows:\s*\[\s*["']([^"']+)["']/.exec(yml)?.[1]
  const expected = config.ciWorkflow.replace(/\.ya?ml$/, '')
  if (!named) {
    return { ok: false, message: `could not find a workflow_run name in ${FIX_CI_WORKFLOW}` }
  }
  if (named === expected || named === config.ciWorkflow) {
    return { ok: true, message: `watches CI workflow "${named}"` }
  }
  return {
    ok: false,
    message:
      `${FIX_CI_WORKFLOW} watches "${named}" but ciWorkflow is "${config.ciWorkflow}". ` +
      'workflow_run cannot take an expression, so update that line by hand.'
  }
}

// Only a startsWith() whose *first argument* is a branch-ref expression is a
// branch-prefix guard. Anchoring on the expression matters: agent-fix-ci.yml
// also compares `head_repository.full_name`, and a naive scan for any
// startsWith() would happily accept that as the branch guard and report `ok`
// while the real guard had drifted.
const BRANCH_REF = /github\.event\.(?:workflow_run\.head_branch|pull_request\.head\.ref)\s*$/

/** Do agent-fix-ci.yml's job `if:` guards still use `config.branchPrefix`? */
export function checkBranchPrefixGuard(yml, config) {
  const prefixes = new Set(
    [...yml.matchAll(/startsWith\(([^,]+),\s*'([^']+)'\)/g)]
      .filter((m) => BRANCH_REF.test(m[1]))
      .map((m) => m[2])
  )
  if (prefixes.size === 0) {
    return { ok: false, message: `could not find a branch-prefix guard in ${FIX_CI_WORKFLOW}` }
  }
  if (prefixes.size === 1 && prefixes.has(config.branchPrefix)) {
    return { ok: true, message: `guards branch prefix "${config.branchPrefix}"` }
  }
  return {
    ok: false,
    message:
      `${FIX_CI_WORKFLOW} guards on [${[...prefixes].join(', ')}] but branchPrefix is ` +
      `"${config.branchPrefix}". Job \`if:\` conditions cannot take config, so update those by hand.`
  }
}

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

  // Catch drift in the two hard-coded literals rather than letting a ported
  // repository fail silently. See checkCiWorkflowName / checkBranchPrefixGuard.
  console.log('\nworkflow wiring')
  try {
    const yml = await readFile(FIX_CI_WORKFLOW, 'utf8')
    for (const check of [checkCiWorkflowName(yml, config), checkBranchPrefixGuard(yml, config)]) {
      ;(check.ok ? ok : warn)(check.message)
    }
  } catch (err) {
    if (err.code === 'ENOENT') warn(`${FIX_CI_WORKFLOW} not found`)
    else throw err
  }

  console.log(todo.length === 0 ? '\nAll set.' : `\n${todo.length} item(s) need attention:`)
  for (const t of todo) console.log(`  - ${t}`)
}

// Importing this module (from tests) must not run the CLI, which shells out to `gh`.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((err) => { console.error(`error: ${err.message}`); process.exit(1) })
}
