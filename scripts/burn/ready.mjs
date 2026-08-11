// Computes the ready frontier and emits it as JSON.
//
// No shebang: this module is imported by tests, and vitest's module runner does
// not strip shebangs the way node does — a leading `#!` makes the whole import
// fail with a SyntaxError misreported against the importing test file. The
// script is always invoked as `node scripts/burn/ready.mjs`, so it never needed
// one.
//
//   GITHUB_REPOSITORY=owner/name GITHUB_TOKEN=... node scripts/burn/ready.mjs
//
// stdout: JSON result. stderr: human-readable diagnostics. Never mix the two —
// the dispatcher pipes stdout straight into a workflow matrix.
import { readFile as fsReadFile, appendFile as fsAppendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { loadConfig } from './config.mjs'
import { computeFrontier, parseBlockers } from './frontier.mjs'
import { createClient } from './github.mjs'

const CONFIG_PATH = '.github/agent-burn.json'

export async function readConfigFile({ readFile = fsReadFile } = {}) {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw new Error(`Could not read ${CONFIG_PATH}: ${err.message}`)
  }
}

/**
 * Lines for stderr. Never stdout — the dispatcher consumes stdout verbatim.
 *
 * The stall line is deliberately loud and differently shaped from the rest: a
 * frozen queue produces `ready: []`, exactly like an empty backlog, and the
 * only difference a human can act on is this message.
 */
export function diagnosticLines(result, config, { candidateCount } = {}) {
  const lines = [
    `candidates: ${candidateCount ?? '?'}  in-flight: ${result.inFlight.length}  slots: ${result.slots}`
  ]
  for (const s of result.skipped) lines.push(`  skip #${s.number}: ${s.reason}`)
  for (const r of result.ready) lines.push(`  ready #${r.number}: ${r.title} -> ${r.branch}`)
  if (result.stalled) {
    lines.push(
      `STALLED: all ${config.maxConcurrent} slot(s) are held by ticket(s) ` +
      `${result.handedOver.map((n) => `#${n}`).join(', ')}, every one of them labelled ` +
      `"${config.needsHumanLabel}". The backlog is not empty — the queue is blocked on you. ` +
      'Fix or close those pull requests to free the slots.'
    )
  }
  return lines
}

/**
 * The exact text appended to GITHUB_OUTPUT.
 *
 * `frontier` MUST stay on one line: the dispatcher reads it back with fromJSON
 * into a matrix, and GitHub's `key=value` output format has no multi-line form
 * without a heredoc delimiter. Hence JSON.stringify with no spacing argument.
 */
export function outputLines(result) {
  return (
    `frontier=${JSON.stringify(result.ready)}\n` +
    `count=${result.ready.length}\n` +
    `slots=${result.slots}\n` +
    `stalled=${result.stalled ? 'true' : 'false'}\n`
  )
}

export async function writeGithubOutput(
  result,
  { env = process.env, appendFile = fsAppendFile } = {}
) {
  if (!env.GITHUB_OUTPUT) return false
  await appendFile(env.GITHUB_OUTPUT, outputLines(result))
  return true
}

export async function main({ env = process.env, log = console.log, error = console.error } = {}) {
  const repo = env.GITHUB_REPOSITORY
  const token = env.AGENT_PAT || env.GITHUB_TOKEN
  if (!repo) throw new Error('GITHUB_REPOSITORY is required (owner/name)')
  if (!token) throw new Error('AGENT_PAT or GITHUB_TOKEN is required')

  const config = loadConfig(await readConfigFile())
  const gh = createClient({ token, repo })

  const candidates = await gh.listOpenIssuesWithLabel(config.readyLabel)

  // Resolve only the blockers actually referenced, so this scales to large repos.
  const blockerNumbers = new Set()
  for (const issue of candidates) {
    for (const n of parseBlockers(issue.body, config.blockedByHeading)) blockerNumbers.add(n)
  }
  const issueStates = new Map()
  for (const n of blockerNumbers) {
    const state = await gh.getIssueState(n)
    if (state === null) {
      error(`warning: blocker #${n} could not be resolved; treating dependents as blocked`)
      continue // leaving it out of the map makes computeFrontier fail safe
    }
    issueStates.set(n, state)
  }

  const openAgentBranches = await gh.listOpenAgentBranches(config.branchPrefix)
  const result = computeFrontier({ candidates, issueStates, openAgentBranches, config })

  for (const line of diagnosticLines(result, config, { candidateCount: candidates.length })) {
    error(line)
  }

  log(JSON.stringify(result, null, 2))

  await writeGithubOutput(result, { env })
}

// Importing this module (from tests) must not run the CLI.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`error: ${err.message}`)
    process.exit(1)
  })
}
