#!/usr/bin/env node
// Computes the ready frontier and emits it as JSON.
//
//   GITHUB_REPOSITORY=owner/name GITHUB_TOKEN=... node scripts/burn/ready.mjs
//
// stdout: JSON result. stderr: human-readable diagnostics. Never mix the two —
// the dispatcher pipes stdout straight into a workflow matrix.
import { readFile } from 'node:fs/promises'
import { appendFile } from 'node:fs/promises'
import { loadConfig } from './config.mjs'
import { computeFrontier, parseBlockers } from './frontier.mjs'
import { createClient } from './github.mjs'

const CONFIG_PATH = '.github/agent-burn.json'

async function readConfigFile() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw new Error(`Could not read ${CONFIG_PATH}: ${err.message}`)
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.AGENT_PAT || process.env.GITHUB_TOKEN
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
      console.error(`warning: blocker #${n} could not be resolved; treating dependents as blocked`)
      continue // leaving it out of the map makes computeFrontier fail safe
    }
    issueStates.set(n, state)
  }

  const openAgentBranches = await gh.listOpenAgentBranches(config.branchPrefix)
  const result = computeFrontier({ candidates, issueStates, openAgentBranches, config })

  console.error(`candidates: ${candidates.length}  in-flight: ${result.inFlight.length}  slots: ${result.slots}`)
  for (const s of result.skipped) console.error(`  skip #${s.number}: ${s.reason}`)
  for (const r of result.ready) console.error(`  ready #${r.number}: ${r.title} -> ${r.branch}`)

  console.log(JSON.stringify(result, null, 2))

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `frontier=${JSON.stringify(result.ready)}\n` +
      `count=${result.ready.length}\n` +
      `slots=${result.slots}\n`
    )
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`)
  process.exit(1)
})
